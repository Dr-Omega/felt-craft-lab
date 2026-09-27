"""Versioned layered wire and independent persisted geometry verification.

The caller rebuilds ``observed`` from actual persisted labels, unsmoothed
component binding and selected shared contours. No plan PASS, declared source
mapping, old identity, or generation cache is accepted as geometric evidence.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np
from shapely.geometry import mapping, shape, GeometryCollection
from shapely.ops import unary_union

from m1_adapter import ROOT, HERE
from solid_plans import _sources, _tolerance, _lines, _parts
from rerender import _render_closed

VERSION = 'fabrication.layered-result/1'


class LayeredContractError(ValueError):
    pass


def run_shared_layered_validation(result, sign_result=False):
    """Compile/call real TypeScript contract and existing shared M1 validator."""
    candidates = [Path(os.environ['TYPESCRIPT_TSC'])] if 'TYPESCRIPT_TSC' in os.environ else []
    candidates += [base / 'node_modules/typescript/lib/tsc.js' for base in (ROOT, ROOT.parent, ROOT.parent / 'felt-craft-lab')]
    tsc = next((p for p in candidates if p.is_file()), None)
    node = shutil.which('node')
    if tsc is None or node is None:
        raise RuntimeError('Layered shared validation requires actual Node and TypeScript')
    sources = [HERE / 'layered_contract.ts', *sorted((ROOT / 'src/shared/contracts').glob('*.ts'))]
    key = hashlib.sha256(str(ROOT).encode() + b''.join(p.read_bytes() for p in sources)).hexdigest()
    cache = Path(tempfile.gettempdir()) / 'felt-craft-layered-validator' / key
    bridge = cache / 'benchmarks/fabrication-layer-decomposition/algorithm-v1/layered_contract.js'
    if not bridge.is_file():
        command = [node, str(tsc), str(HERE / 'layered_contract.ts'), '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--strict', '--skipLibCheck', '--noEmitOnError', '--rootDir', str(ROOT), '--outDir', str(cache)]
        compiled = subprocess.run(command, capture_output=True, text=True)
        if compiled.returncode:
            raise RuntimeError('Layered validator compilation failed: ' + compiled.stdout + compiled.stderr)
    response = subprocess.run([node, str(bridge)], input=json.dumps({'result': result, 'sign_result': sign_result}, allow_nan=False), capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(response.stdout)


def build_layered_result(input_object, plan, observed):
    pieces = []
    for item in plan['pieces']:
        piece = {k: copy.deepcopy(item[k]) for k in ('id', 'colorSlotId', 'rgb', 'sourceComponentIds', 'sourceRegionIds', 'occluderIds')}
        piece.update(inferredHiddenGeometry=item['hiddenPolygon'].area > 0,
                     sourceDomainRole='OBSERVED_VISIBLE_ONLY',
                     completionEvidence=copy.deepcopy(item['completionEvidence']),
                     completionEvidenceStatus='GENERATION_HYPOTHESIS_NOT_OBSERVED_SOURCE')
        piece.update(full=mapping(item['polygon']), visible=mapping(item['visiblePolygon']), hidden=mapping(item['hiddenPolygon']))
        pieces.append(piece)
    seams = [{'id': s['id'], 'pieceIds': list(s['pieceIds']), 'geometry': mapping(s['polyline']), 'lengthCanonical': s['lengthCanonical'], 'visibleLengthCanonical': s['visibleLengthCanonical']} for s in plan['physicalSeams']]
    wire = {'schemaVersion': VERSION, 'identity': {'contractVersion': VERSION, 'identityMode': 'CANONICAL_JSON_LF_UTF8', 'sha256': '0' * 64},
            'payload': {'input': copy.deepcopy(input_object), 'pieces': pieces, 'bottomToTop': list(plan['bottomToTop']), 'occlusionEdges': copy.deepcopy(plan['occlusionEdges']), 'physicalSeams': seams,
                        'orderSemantics': 'PROPOSED_FABRICATION_NOT_ORIGINAL_LAYER_HISTORY',
                        'recipe': {'id': 'bounded-piece-completion-order', 'version': '1'}, 'manufacturing': 'NOT_EVALUATED', 'productionExportEligible': 'NO', 'userVisualAcceptance': 'PENDING'}}
    response = run_shared_layered_validation(wire, sign_result=True)
    if not response['ok']:
        raise LayeredContractError('Shared layered contract rejected: ' + str(response))
    wire = response['signedResult']
    # Construction itself must not serialize a physically invalid proposal.
    _verify_geometry(wire, observed)
    return wire


def _geometry(value, label, *, solid=False):
    try:
        geometry = shape(value)
    except Exception as exc:
        raise LayeredContractError(label + ': malformed geometry') from exc
    if not geometry.is_valid or (not geometry.is_empty and not all(math.isfinite(x) for x in geometry.bounds)):
        raise LayeredContractError(label + ': invalid geometry')
    if solid and (geometry.geom_type != 'Polygon' or geometry.is_empty or geometry.area <= 0 or geometry.interiors):
        raise LayeredContractError(label + ': full Piece must be connected positive hole-free Polygon')
    if not solid and geometry.geom_type not in ('Polygon', 'MultiPolygon', 'GeometryCollection'):
        raise LayeredContractError(label + ': expected polygonal domain')
    if geometry.geom_type == 'GeometryCollection' and any(g.geom_type not in ('Polygon', 'MultiPolygon') for g in geometry.geoms):
        raise LayeredContractError(label + ': nonpolygonal domain')
    return geometry


def _equal(a, b, tolerance, label):
    # Area alone would accept a geometrically shifted thin boundary. Exact
    # topology is preferred, with both boundary and symmetric difference gates
    # for floating overlay roundoff (same scale as the existing solid gate).
    if a.equals(b):
        return
    if a.is_empty or b.is_empty:
        raise LayeredContractError(label + ': domain differs')
    scale = max(1., *(abs(x) for x in (*a.bounds, *b.bounds)))
    if a.symmetric_difference(b).area > tolerance or a.boundary.hausdorff_distance(b.boundary) > scale * 1e-10:
        raise LayeredContractError(label + ': full domain/boundary differs')


def _verify_geometry(wire, observed):
    sources, foreground = _sources(observed)
    tolerance = _tolerance(foreground)
    payload = wire['payload']
    # The shared M1 shape validation is necessary, but it cannot prove that
    # these declarations refer to the independently reconstructed domains.
    declared_sources = {}
    for region in payload['input']['observedRegions']:
        for component in region['componentIds']:
            if component in declared_sources:
                raise LayeredContractError('Duplicate Component in embedded input')
            declared_sources[component] = (region['id'], region['colorSlotId'])
    if declared_sources != {s['componentId']: (s['regionId'], s['colorSlotId']) for s in sources}:
        raise LayeredContractError('Embedded input does not bind actual observed Components')
    colors = {c['id']: tuple(c['rgb']) for c in payload['input']['colorSlots']}
    if any(colors.get(s['colorSlotId']) != tuple(s['rgb']) for s in sources):
        raise LayeredContractError('Embedded input exact palette differs from actual sources')
    order = payload['bottomToTop']
    raw = payload['pieces']
    ids = [p['id'] for p in raw]
    if len(set(ids)) != len(ids) or len(order) != len(ids) or set(order) != set(ids):
        raise LayeredContractError('Piece order is not a bijection')
    pieces = {p['id']: dict(p, polygon=_geometry(p['full'], p['id'], solid=True), visiblePolygon=_geometry(p['visible'], p['id'] + ':visible'), hiddenPolygon=_geometry(p['hidden'], p['id'] + ':hidden')) for p in raw}
    collected = {s['componentId']: [] for s in sources}
    above = GeometryCollection()
    actual_edges = set()
    for index in range(len(order)-1, -1, -1):
        item = pieces[order[index]]
        full = item['polygon']
        if full.difference(foreground).area > tolerance:
            raise LayeredContractError('Hidden/full piece crosses actual foreground transparency')
        visible = full.difference(above)
        # A shared cut edge is not hidden material: retain only polygonal
        # positive-area intersection domains, not 1-D contact lines/points.
        hidden = unary_union(_parts(full.intersection(above)))
        if visible.is_empty or visible.area <= 0:
            raise LayeredContractError('Useless fully hidden piece is forbidden')
        _equal(visible, item['visiblePolygon'], tolerance, 'Declared visible')
        _equal(hidden, item['hiddenPolygon'], tolerance, 'Declared hidden')
        if item.get('inferredHiddenGeometry') is not (hidden.area > 0) or item.get('sourceDomainRole') != 'OBSERVED_VISIBLE_ONLY':
            raise LayeredContractError('Inferred hidden material cannot claim observed Component source domain')
        evidence = item.get('completionEvidence')
        if (not isinstance(evidence, list) or not evidence
                or any(not isinstance(e, dict) or not isinstance(e.get('method'), str) or not e['method'] or type(e.get('inferredHiddenGeometry')) is not bool for e in evidence)
                or (hidden.area > 0 and not any(e['inferredHiddenGeometry'] for e in evidence))):
            raise LayeredContractError('Missing explicit completion hypothesis evidence')
        actual_sources = [s for s in sources if visible.intersection(s['polygon']).area > 0]
        if set(item['sourceComponentIds']) != {s['componentId'] for s in actual_sources} or len(item['sourceComponentIds']) != len(set(item['sourceComponentIds'])):
            raise LayeredContractError('Visible Component binding differs from actual persisted domain')
        if set(item['sourceRegionIds']) != {s['regionId'] for s in actual_sources}:
            raise LayeredContractError('Region binding differs from actual visible sources')
        for source in actual_sources:
            if item['colorSlotId'] != source['colorSlotId'] or tuple(item['rgb']) != tuple(source['rgb']):
                raise LayeredContractError('Visible source exact ColorSlot/RGB differs')
            collected[source['componentId']].append(visible.intersection(source['polygon']))
        _equal(visible, unary_union([s['polygon'].intersection(full) for s in actual_sources]), tolerance, 'Visible source conservation')
        occluders = {other for other in order[index+1:] if full.intersection(pieces[other]['polygon']).area > 0}
        if set(item['occluderIds']) != occluders or len(item['occluderIds']) != len(occluders):
            raise LayeredContractError('Actual occluder declaration differs')
        actual_edges.update((item['id'], other) for other in occluders)
        above = unary_union([above, full])
    _equal(above, foreground, tolerance, 'Final foreground coverage and genuine holes')
    for source in sources:
        _equal(unary_union(collected[source['componentId']]), source['polygon'], tolerance, 'Complete source coverage')
    declared_edges = [(e['belowPieceId'], e['abovePieceId']) for e in payload['occlusionEdges']]
    if len(set(declared_edges)) != len(declared_edges) or set(declared_edges) != actual_edges:
        raise LayeredContractError('Piece DAG differs from actual overlapping geometry')
    _verify_seams(payload['physicalSeams'], pieces, tolerance)
    return pieces, sources, foreground


def _verify_seams(seams, pieces, tolerance):
    actual = {}
    items = list(pieces.values())
    for i, a in enumerate(items):
        for b in items[i+1:]:
            if a['colorSlotId'] != b['colorSlotId']:
                continue
            if a['polygon'].intersection(b['polygon']).area > 0:
                continue
            lines = _lines(a['polygon'].boundary.intersection(b['polygon'].boundary))
            if lines:
                actual[tuple(sorted((a['id'], b['id'])))] = unary_union(lines)
    declared = {}
    seam_ids = set()
    for s in seams:
        if s['id'] in seam_ids:
            raise LayeredContractError('Duplicate physical seam identity')
        seam_ids.add(s['id'])
        pair = tuple(sorted(s['pieceIds']))
        line = shape(s['geometry'])
        if pair not in actual or line.geom_type not in ('LineString', 'MultiLineString') or not line.is_valid or line.is_empty or abs(line.length-s['lengthCanonical']) > 1e-8:
            raise LayeredContractError('Invalid actual physical seam/measurement')
        a, b = (pieces[pid] for pid in pair)
        visible_length = line.intersection(a['visiblePolygon'].boundary.intersection(b['visiblePolygon'].boundary)).length
        if not math.isfinite(s.get('visibleLengthCanonical', float('nan'))) or abs(visible_length-s['visibleLengthCanonical']) > 1e-8:
            raise LayeredContractError('Physical seam exposed length differs')
        declared.setdefault(pair, []).append(line)
    if set(actual) != set(declared):
        raise LayeredContractError('Missing/extra physical seam record')
    for pair, line in actual.items():
        saved = unary_union(declared[pair])
        if not line.equals(saved) and (line.symmetric_difference(saved).length > 1e-8 or line.hausdorff_distance(saved) > 1e-8):
            raise LayeredContractError('Physical seam geometry differs')
        if abs(sum(x.length for x in declared[pair])-saved.length) > 1e-8:
            raise LayeredContractError('Duplicated physical seam segment')


def verify_layered_result(result, observed, shape_hw):
    """Recompute all domains/order from saved wire plus freshly bound sources."""
    if len(shape_hw) != 2 or any(type(v) is not int or v <= 0 for v in shape_hw):
        raise LayeredContractError('Invalid actual canvas shape')
    response = run_shared_layered_validation(result)
    if not response['ok']:
        raise LayeredContractError('Shared layered contract rejected: ' + str(response))
    pieces, sources, foreground = _verify_geometry(result, observed)
    coordinates = result['payload']['input']['coordinates']
    frames = [f for f in coordinates['frames'] if f['id'] == coordinates['canonicalFrameId']]
    if len(frames) != 1 or frames[0]['bounds'] != [0, 0, shape_hw[1], shape_hw[0]] or frames[0]['xDirection'] != 'RIGHT' or frames[0]['yDirection'] != 'DOWN':
        raise LayeredContractError('Actual canvas differs from persisted canonical frame')
    if foreground.bounds[0] < 0 or foreground.bounds[1] < 0 or foreground.bounds[2] > shape_hw[1] or foreground.bounds[3] > shape_hw[0]:
        raise LayeredContractError('Actual source geometry outside canvas')
    rgba = _render_closed([pieces[pid] for pid in result['payload']['bottomToTop']], shape_hw)
    expected = _render_closed(sources, shape_hw)
    mismatch = np.any(rgba != expected, axis=2)
    raw_count = int(mismatch.sum())
    # Exact vector domains are the primary gate. Raster centers precisely on a
    # shared source boundary can legitimately have either adjacent exact color.
    from shapely import intersects_xy
    for y, x in zip(*np.nonzero(mismatch)):
        legal = [(*s['rgb'], 255) for s in sources if intersects_xy(s['polygon'].boundary, x+.5, y+.5)]
        if tuple(rgba[y, x]) in legal:
            mismatch[y, x] = False
    count = int(mismatch.sum())
    if count:
        raise LayeredContractError(f'Independent layered render differs at {count} interior pixels')
    checks = {'fullSolidGeometry': 'PASS', 'visibleSourceConservation': 'PASS', 'hiddenActuallyOccluded': 'PASS', 'pieceDAG': 'PASS', 'genuineTransparency': 'PASS', 'physicalSeams': 'PASS', 'independentRender': 'PASS'}
    # Consumers use these independently reconstructed, checked wire geometries
    # for numbered/hidden/exploded previews, never the generator's memory plan.
    plan = {'strategy': 'layered-completion/1', 'id': result['identity']['sha256'],
            'pieces': [pieces[pid] for pid in sorted(pieces)],
            'bottomToTop': list(result['payload']['bottomToTop']),
            'occlusionEdges': copy.deepcopy(result['payload']['occlusionEdges']),
            'physicalSeams': [dict(s, polyline=shape(s['geometry'])) for s in result['payload']['physicalSeams']]}
    depth = {pid: 1 for pid in plan['bottomToTop']}
    for pid in plan['bottomToTop']:
        for above in pieces[pid]['occluderIds']:
            depth[above] = max(depth[above], depth[pid]+1)
    hidden_area = sum(p['hiddenPolygon'].area for p in pieces.values())
    metrics = {'appearanceAreaErrorCanonical': 0.0, 'pieceCount': len(pieces),
               'microPieceCountAreaLe4': sum(p['polygon'].area <= 4 for p in pieces.values()),
               'visibleSeamLengthCanonical': float(sum(s['visibleLengthCanonical'] for s in plan['physicalSeams'])),
               'physicalSeamRecordCount': len(plan['physicalSeams']),
               'totalSeamLengthCanonical': float(sum(s['lengthCanonical'] for s in plan['physicalSeams'])),
               'overlapBoundaryLengthCanonical': float(sum(p['hiddenPolygon'].boundary.intersection(p['visiblePolygon'].boundary).length for p in pieces.values() if not p['hiddenPolygon'].is_empty)),
               'hiddenAreaCanonical': float(hidden_area), 'hiddenAreaToForegroundRatio': float(hidden_area/foreground.area),
               'layerDepth': max(depth.values()), 'occlusionEdgeCount': len(plan['occlusionEdges']),
               'vertexCount': sum(len(p['polygon'].exterior.coords)-1 for p in pieces.values()),
               'proxyStatus': 'EXPERIMENTAL_NOT_HUMAN_ACCEPTANCE'}
    normalized_seam = metrics['visibleSeamLengthCanonical'] / math.sqrt(foreground.area)
    metrics['normalizedVisibleSeamLength'] = normalized_seam
    metrics['decisionCostVersion'] = 'layered-balanced-cost/1'
    metrics['decisionCost'] = (metrics['pieceCount'] + 4*metrics['microPieceCountAreaLe4']
                               + 12*normalized_seam + 0.2*metrics['hiddenAreaToForegroundRatio']
                               + 0.02*metrics['vertexCount'] + 0.5*(metrics['layerDepth']-1))
    plan['score'] = metrics
    return {'checks': checks, 'rgba': rgba, 'expectedRgba': expected, 'mismatchPixelCount': count,
            'rawRasterMismatchPixelCount': raw_count, 'sharedBoundaryTiePixelCount': raw_count-count,
            'interiorMismatchPixelCount': count,
            'rasterTiePolicy': 'ONLY_EXACT_SHARED_SOURCE_BOUNDARY_CENTERS_MAY_USE_EITHER_ADJACENT_EXACT_COLOR',
            'metrics': metrics, 'resultSha256': result['identity']['sha256'], 'contractVersion': VERSION, 'plan': plan}
