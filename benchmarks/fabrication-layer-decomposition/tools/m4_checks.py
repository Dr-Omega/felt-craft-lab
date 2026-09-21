"""Independent M4 array and selected-edge diagnostics; never edits kernel data."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw


def validate_labels(rgba, purified, structural, pixels, metadata, config):
    if rgba.dtype != np.uint8 or rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError('effective RGBA must be uint8 HxWx4')
    if purified.dtype != np.uint8 or purified.shape != rgba.shape:
        raise ValueError('purified RGBA dimensions/type mismatch')
    if any(x.dtype != np.int32 or x.shape != rgba.shape[:2] for x in (structural, pixels)):
        raise ValueError('label dimensions/type mismatch; expected int32 HxW')
    alpha = rgba[..., 3]
    expected = alpha >= config['structuralAlphaThreshold']
    if not np.array_equal(structural > 0, expected) or np.any(structural < 0):
        raise ValueError('independent effective-alpha structural coverage mismatch')
    if not np.array_equal(alpha, purified[..., 3]):
        raise ValueError('effective alpha changed')
    ids = {int(x) for x in np.unique(structural) if x > 0}
    recorded = [int(x['regionId']) for x in metadata]
    if len(set(recorded)) != len(recorded) or set(recorded) != ids:
        raise ValueError('Region metadata references do not exactly match labels')
    if np.any(pixels[alpha == 0] != 0) or not np.array_equal(pixels[expected], structural[expected]):
        raise ValueError('transparent/structural pixel label assignment mismatch')
    # Independent synchronous waves implement the documented nearest-wave,
    # lowest-positive-ID tie rule, rather than trusting proposal labels.
    assigned = structural.copy()
    fringe = (alpha > 0) & ~expected
    for _ in range(int(config['fringeMaxPropagationDistancePx'])):
        padded = np.pad(assigned, 1)
        nearest = np.full(assigned.shape, np.iinfo(np.int32).max, np.int32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == dy == 0:
                    continue
                neighbour = padded[1+dy:1+dy+assigned.shape[0], 1+dx:1+dx+assigned.shape[1]]
                np.minimum(nearest, np.where(neighbour > 0, neighbour, np.iinfo(np.int32).max), out=nearest)
        take = fringe & (assigned == 0) & (nearest != np.iinfo(np.int32).max)
        assigned[take] = nearest[take]
    assigned[fringe & (assigned == 0)] = -1
    if not np.array_equal(assigned, pixels):
        raise ValueError('fringe/ORPHAN_FRINGE assignment violates propagation contract')
    if not np.array_equal(purified[pixels == -1], rgba[pixels == -1]):
        raise ValueError('ORPHAN_FRINGE source pixels changed')
    return {'status': 'PASS', 'expectedStructuralPixels': int(expected.sum()),
            'originalTransparentPixels': int((alpha == 0).sum()),
            'structuralVoidPixels': int((~expected).sum()),
            'fringePixels': int(fringe.sum()), 'orphanFringePixels': int((pixels == -1).sum())}


def candidate_polygons(candidates, graph, vector, flatness):
    """Dereference selected LINE/CUBIC edges with the P0-04C flattening rule."""
    from bezier_fit import flatten_segments
    from shapely.geometry import Polygon
    edges = {x['edgeId']: x for x in vector['geometry']}
    if len(edges) != len(vector['geometry']):
        raise ValueError('duplicate vector edge identity')
    graph_components = {(int(r['regionId']), c['componentId']): c
                        for r in graph['regions'] for c in r['components']}
    seen = set()
    candidate_ids = set()
    result = []
    for candidate in candidates:
        if not candidate.get('candidateId') or candidate['candidateId'] in candidate_ids:
            raise ValueError('missing or duplicate candidate identity')
        candidate_ids.add(candidate['candidateId'])
        if candidate['vectorRoute'] != vector['route']:
            raise ValueError('candidate route differs from selected vector route')
        key = (int(candidate['sourceRegionId']), candidate['sourceComponentId'])
        if key in seen or key not in graph_components:
            raise ValueError('candidate source component mismatch')
        seen.add(key)
        source = graph_components[key]
        geometry = candidate['observedGeometry']
        if any(geometry[k] != source.get(k, []) for k in ('outerRing', 'innerRings')):
            raise ValueError('candidate ring references/directions differ from source component')
        ring_edges = sorted({ref['edgeId'] for ring in [geometry['outerRing'], *geometry['innerRings']]
                             for ref in ring['edgeReferences']})
        if geometry['edgeIds'] != ring_edges:
            raise ValueError('candidate edge identity list differs from actual ring references')
        rings = []
        for index, ring in enumerate([geometry['outerRing'], *geometry['innerRings']]):
            points = []
            for ref in ring['edgeReferences']:
                if ref['edgeId'] not in edges or ref['direction'] not in (-1, 1):
                    raise ValueError('missing selected edge or invalid direction')
                part = list(flatten_segments(edges[ref['edgeId']]['segments'], flatness))
                if ref['direction'] == -1:
                    part.reverse()
                if not part or (points and not np.allclose(points[-1], part[0], atol=1e-9, rtol=0)):
                    raise ValueError('open or disconnected selected edge ring')
                points.extend(part if not points else part[1:])
            if len(points) < 4 or not np.allclose(points[0], points[-1], atol=1e-9, rtol=0):
                raise ValueError('open/degenerate candidate ring')
            area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:])) / 2
            if (index == 0 and area >= 0) or (index > 0 and area <= 0):
                raise ValueError('candidate ring direction/hole orientation mismatch')
            rings.append(points)
        polygon = Polygon(rings[0], rings[1:])
        if not polygon.is_valid or polygon.area <= 0:
            raise ValueError('invalid selected-vector candidate polygon')
        result.append({'id': candidate['candidateId'], 'componentId': key[1],
                       'regionId': f'R{key[0]:05d}', 'rgb': candidate['representativeColor']['rgb'],
                       'polygon': polygon, 'boundaryProvenance': {'vectorRoute': vector['route'],
                       'edgeIds': geometry['edgeIds'], 'rings': geometry,
                       'flatteningSourcePixels': flatness}})
    if seen != set(graph_components):
        raise ValueError('missing source component in candidates')
    return result


def render_polygons(objects, shape, *, numbered=False):
    """Pixel-center sampling from actual polygons, including inner rings."""
    from shapely import contains_xy
    canvas = np.zeros((*shape, 4), np.uint8)
    for obj in objects:
        polygon = obj['polygon']
        x0,y0,x1,y1 = polygon.bounds
        left,top = max(0,int(np.floor(x0))),max(0,int(np.floor(y0)))
        right,bottom = min(shape[1],int(np.ceil(x1))),min(shape[0],int(np.ceil(y1)))
        yy,xx = np.mgrid[top:bottom,left:right]
        mask = contains_xy(polygon, xx+0.5, yy+0.5)
        canvas[top:bottom,left:right][mask] = [*obj['rgb'],255]
    if numbered:
        image = Image.fromarray(canvas)
        draw = ImageDraw.Draw(image)
        for obj in objects:
            point = obj['polygon'].representative_point()
            draw.text((point.x,point.y),obj.get('componentId',obj['id']),fill='black',stroke_width=1,stroke_fill='white')
        return np.asarray(image)
    return canvas
