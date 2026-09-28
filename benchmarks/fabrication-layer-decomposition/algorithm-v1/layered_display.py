"""Actual complete geometries, hidden domains and piece-level assembly display.

Pure display functions: callers own protected output validation. Never paste
the source image over a fabrication result or independently smooth a piece.
"""
import html
import math

import numpy as np
from PIL import Image, ImageDraw

from m4_checks import render_polygons
from solid_plans import _parts, _lines


def _path(geometry):
    commands = []
    for polygon in _parts(geometry):
        for ring in [polygon.exterior, *polygon.interiors]:
            coordinates = list(ring.coords)
            commands.append('M' + ' L'.join(f'{x:.10g},{y:.10g}' for x, y in coordinates) + ' Z')
    return ' '.join(commands)


def exploded_svg(plan, palette):
    """Identical coordinate scale for every physical piece, independent holes."""
    pieces = {piece['id']: piece for piece in plan['pieces']}
    ordered = [pieces[key] for key in plan['bottomToTop']]
    max_width = max(p['polygon'].bounds[2] - p['polygon'].bounds[0] for p in ordered)
    max_height = max(p['polygon'].bounds[3] - p['polygon'].bounds[1] for p in ordered)
    pad = max(12, max(max_width, max_height) * .06)
    cell_width, cell_height = max_width + pad * 2, max_height + pad * 3
    columns = min(4, max(1, math.ceil(math.sqrt(len(ordered)))))
    rows = math.ceil(len(ordered) / columns)
    elements = []
    for index, piece in enumerate(ordered):
        x0, y0, _, _ = piece['polygon'].bounds
        tx = (index % columns) * cell_width + pad - x0
        ty = (index // columns) * cell_height + pad * 2 - y0
        color = ','.join(str(c) for c in palette[piece['colorSlotId']])
        label = html.escape(piece['id'])
        elements.append(f'<g transform="translate({tx:.10g} {ty:.10g})"><title>{label}</title>'
            f'<path d="{_path(piece["polygon"])}" fill="rgb({color})" fill-rule="evenodd"/>'
            f'<path d="{_path(piece["hiddenPolygon"])}" fill="#e600d8" fill-opacity=".55" fill-rule="evenodd"/>'
            f'<text x="{x0:.10g}" y="{y0-pad*.4:.10g}" font-size="{pad*.65:.10g}">{label}</text></g>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {columns*cell_width:.10g} {rows*cell_height:.10g}">'
            '<style>text{font-family:monospace;fill:#111}</style>' + ''.join(elements) + '</svg>')


def assembly_images(plan, palette, shape):
    """Sequential persisted plan order, all pieces rendered from full geometry.

    Screenshots are collected at dependency depth boundaries, not one arbitrary
    colour per layer. A colour can occur at several depths.
    """
    by_id = {piece['id']: piece for piece in plan['pieces']}
    levels = {}
    for identifier in plan['bottomToTop']:
        piece = by_id[identifier]
        lower = [key for key in levels if by_id[key]['polygon'].intersection(piece['polygon']).area > 1e-9]
        levels[identifier] = 1 + max((levels[key] for key in lower), default=0)
    images = {}
    for level in range(1, max(levels.values()) + 1):
        # render_polygons paints in this explicit bottom-to-top sequence.
        # Colours come solely from the persisted exact ColorSlots.
        items = [{**by_id[key], 'id': f'{index:08d}', 'rgb': palette[by_id[key]['colorSlotId']]}
                 for index, key in enumerate(plan['bottomToTop']) if levels[key] <= level]
        images[f'assembly-depth-{level:02d}.png'] = Image.fromarray(render_polygons(items, shape))
    return images, levels


def projected_image(plan, palette, shape, *, hidden=False):
    items = []
    for index, piece in enumerate(plan['pieces']):
        geometry = piece['hiddenPolygon'] if hidden else piece['visiblePolygon']
        for part_index, polygon in enumerate(_parts(geometry)):
            items.append({'id': f'{index:08d}-{part_index}', 'polygon': polygon,
                          'rgb': [230, 0, 216] if hidden else palette[piece['colorSlotId']]})
    if not items:
        return Image.fromarray(np.zeros((*shape, 4), np.uint8))
    return Image.fromarray(render_polygons(items, shape))


def monochrome_images(plan, palette, shape, schedule):
    """Full-piece work-step assembly; schedule must have passed geometry checks."""
    by_id = {p['id']: p for p in plan['pieces']}
    ordered, images = [], {}
    for step in schedule['steps']:
        ordered.extend(step['pieceIds'])
        items = [{**by_id[key], 'id': f'{index:08d}',
                  'rgb': palette[by_id[key]['colorSlotId']]}
                 for index, key in enumerate(ordered)]
        images[f'work-layer-{step["step"]:02d}.png'] = Image.fromarray(render_polygons(items, shape))
    return images


def reference_overlays(plan, rgba):
    """Separate actual cut seams from ordinary colour/overlap boundaries."""
    seams = Image.fromarray(rgba.copy())
    drawing = ImageDraw.Draw(seams)
    pieces = {p['id']: p for p in plan['pieces']}
    for record in plan['physicalSeams']:
        a, b = (pieces[key] for key in record['pieceIds'])
        exposed = record['polyline'].intersection(a['visiblePolygon'].boundary).intersection(b['visiblePolygon'].boundary)
        for geometry, color in ((record['polyline'].difference(exposed), '#00bbbb'), (exposed, '#dd00aa')):
            for line in _lines(geometry):
                drawing.line(list(line.coords), fill=color, width=1)
    numbered = Image.fromarray(rgba.copy())
    drawing = ImageDraw.Draw(numbered)
    number_map = {}
    for index, identifier in enumerate(plan['bottomToTop'], 1):
        piece = pieces[identifier]
        part = max(_parts(piece['visiblePolygon']), key=lambda p: p.area)
        point = part.representative_point()
        drawing.text((point.x, point.y), str(index), fill='black', stroke_width=1, stroke_fill='white')
        number_map[str(index)] = {'pieceId': identifier, 'visibleSourceComponentIds':piece['sourceComponentIds'],
            'visibleSourceRegionIds':piece['sourceRegionIds'], 'hiddenGeometryIsInferred':True}
    return seams, numbered, number_map
