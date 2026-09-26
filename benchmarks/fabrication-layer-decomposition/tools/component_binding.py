"""Exact raster-support/raw-grid bijection at the non-frozen runtime boundary.

Graph IDs remain the runtime namespace. Raster scan ordinals are explicitly
separate: matching uses every directed unit boundary edge, never those names,
area, boxes, list order, selected curves, or a previously declared PASS.
"""
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

SCHEMA = 'runtime-component-domain-binding/1'


def _bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                       allow_nan=False) + '\n').encode('utf-8')


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _boundary_key(edges):
    return tuple(sorted(edges.items()))


def raster_domains(labels):
    """Return scan ordinals, complete pixel support and exact directed borders."""
    if labels.ndim != 2 or labels.dtype.kind not in 'iu' or np.any(labels < 0):
        raise ValueError('Component binding requires nonnegative integer structural labels')
    height, width = labels.shape
    domains = {}
    for region in sorted(int(v) for v in np.unique(labels) if v > 0):
        count, connected = cv2.connectedComponents((labels == region).astype(np.uint8), connectivity=4)
        indices = np.flatnonzero(connected)
        order = np.argsort(connected.ravel()[indices], kind='stable')
        grouped = np.split(indices[order], np.flatnonzero(np.diff(connected.ravel()[indices[order]])) + 1)
        grouped.sort(key=lambda ids: int(ids[0]))
        borders = defaultdict(Counter)
        padded = np.pad(connected, 1)
        neighbours = (padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:])
        for side, neighbour in enumerate(neighbours):
            ys, xs = np.where((connected > 0) & (neighbour != connected))
            for y, x in zip(ys.tolist(), xs.tolist()):
                edge = ((x+1,y,x,y), (x,y+1,x+1,y+1), (x,y,x,y+1), (x+1,y+1,x+1,y))[side]
                borders[int(connected[y,x])][edge] += 1
        assert len(grouped) == count - 1
        rows = []
        for ordinal, support in enumerate(grouped, 1):
            ys, xs = np.divmod(support, width)
            boundary = borders[int(connected.ravel()[support[0]])]
            rows.append({'rasterScanOrdinal': ordinal, 'area': len(support),
                         'bbox': [int(xs.min()), int(ys.min()), int(xs.max()-xs.min()+1), int(ys.max()-ys.min()+1)],
                         'pixelDomainSha256': _sha(np.asarray([height,width,region],dtype='<u8').tobytes()
                                                   + support.astype('<u8').tobytes()),
                         'boundary': boundary})
        domains[region] = rows
    return domains


def graph_boundary(component, edges, region, width, height):
    result = Counter()
    for ring in [component['outerRing'], *component.get('innerRings', [])]:
        if int(ring['regionId']) != region:
            raise ValueError('Component binding cross-Region ring')
        first = previous = None
        for ref in ring['edgeReferences']:
            if type(ref['direction']) is not int or ref['direction'] not in (-1, 1):
                raise ValueError('Component binding invalid edge direction')
            edge = edges.get(ref['edgeId'])
            if edge is None:
                raise ValueError('Component binding missing raw edge')
            points = edge['geometry'][::ref['direction']]
            if len(points) < 2:
                raise ValueError('Component binding empty raw edge')
            for point in points:
                if (len(point) != 2 or any(type(v) is not int for v in point)
                        or not 0 <= point[0] <= width or not 0 <= point[1] <= height):
                    raise ValueError('Component binding requires original integer grid boundary')
            if previous is not None and previous != points[0]:
                raise ValueError('Component binding disconnected raw ring')
            first = points[0] if first is None else first
            for a, b in zip(points, points[1:]):
                dx, dy = b[0]-a[0], b[1]-a[1]
                if (dx == 0) == (dy == 0):
                    raise ValueError('Component binding requires nonzero axis-aligned grid edges')
                length = abs(dx)+abs(dy)
                sx, sy = dx//length, dy//length
                for step in range(length):
                    x, y = a[0]+step*sx, a[1]+step*sy
                    result[x,y,x+sx,y+sy] += 1
            previous = points[-1]
        if first is None or previous != first:
            raise ValueError('Component binding open raw ring')
    return result


def bind_components(labels, graph, regions):
    """Construct a bijection by exact full directed-boundary equality.

    Input Region metadata is copied. Its old Component list is deliberately
    not trusted, allowing read-only migration of old materialized M4 evidence.
    Call verify_persisted_binding to validate a declared *new* runtime artifact.
    """
    height, width = labels.shape
    if (graph['width'], graph['height']) != (width, height):
        raise ValueError('Component binding frame mismatch')
    domains = raster_domains(labels)
    graph_regions = {int(r['regionId']): r for r in graph['regions']}
    metadata = {int(r['regionId']): r for r in regions}
    if (len(graph_regions) != len(graph['regions']) or len(metadata) != len(regions)
            or set(domains) != set(graph_regions) or set(domains) != set(metadata)):
        raise ValueError('Component binding duplicate/missing/cross-Region metadata')
    edges = {e['edgeId']: e for e in graph['edges']}
    if len(edges) != len(graph['edges']):
        raise ValueError('Component binding duplicate raw edge ID')
    bound, mappings, used_ids = [], [], set()
    for region in sorted(domains):
        lookup = {}
        for domain in domains[region]:
            key = _boundary_key(domain['boundary'])
            if key in lookup:
                raise ValueError('Component binding ambiguous raster domain')
            lookup[key] = domain
        components = []
        for component in sorted(graph_regions[region]['components'], key=lambda c: c['componentId']):
            identifier = component['componentId']
            if identifier in used_ids:
                raise ValueError('Component binding duplicate Component ID')
            used_ids.add(identifier)
            boundary = graph_boundary(component, edges, region, width, height)
            domain = lookup.pop(_boundary_key(boundary), None)
            if domain is None:
                raise ValueError('Component binding missing, duplicate or wrong full pixel domain')
            record = {'componentId': identifier, 'area': domain['area'], 'bbox': domain['bbox'],
                      'rasterScanOrdinal': domain['rasterScanOrdinal'], 'pixelDomainSha256': domain['pixelDomainSha256']}
            components.append(record)
            mappings.append({'regionId': region, **record,
                             'directedGridBoundarySha256': _sha(_bytes(_boundary_key(boundary)))})
        if lookup:
            raise ValueError('Component binding omitted raster domain')
        record = deepcopy(metadata[region])
        record.update(components=components, componentCount=len(components))
        bound.append(record)
    proof = {'schemaVersion': SCHEMA, 'runtimeNamespace': 'BOUNDARY_GRAPH_COMPONENT_IDS',
             'rasterNamespace': 'PER_REGION_ROW_MAJOR_4_CONNECTED_SCAN_ORDINAL',
             'matching': 'EXACT_COMPLETE_DIRECTED_UNIT_BOUNDARY_MULTISET',
             'width': width, 'height': height,
             'structuralLabelsSha256': _sha(labels.astype('<i4').tobytes()), 'components': mappings}
    return bound, proof


def verify_persisted_binding(root):
    """Recompute from actual persisted labels/raw borders, never cached PASS."""
    root = Path(root)
    read = lambda name: json.loads((root/name).read_text('utf-8'))
    with np.load(root/'structural_label_map.npz', allow_pickle=False) as data:
        labels = data['labels']
    regions, graph, report = read('regions.json'), read('boundary-graph.json'), read('report.json')
    bound, proof = bind_components(labels, graph, regions)
    if regions != bound or read('component-binding.json') != proof:
        raise ValueError('Component binding declared mapping differs from actual pixel domain')
    descriptor = {'artifact': 'component-binding.json', 'schemaVersion': SCHEMA,
                  'sha256': _sha((root/'component-binding.json').read_bytes())}
    if report.get('componentBinding') != descriptor:
        raise ValueError('Component binding missing or stale runtime declaration')
    # Rebuild observed references rather than trusting coherently rehashed IDs.
    from m4_runtime import _observed_candidates
    candidates = _observed_candidates(report['runtimeId'], graph, read('vector-result.json'), bound,
                                     report['selectedVector']['attemptedRoutes'])
    if read('observed-candidates.json') != candidates:
        raise ValueError('Component binding observed references differ from actual domain')
    return descriptor
