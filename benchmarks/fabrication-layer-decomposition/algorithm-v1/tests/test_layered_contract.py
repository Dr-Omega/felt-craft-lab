import copy
import json
from pathlib import Path
import sys
import unittest

from shapely.geometry import box, mapping, shape, Polygon, GeometryCollection
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from layered_contract import (LayeredContractError, build_layered_result,
                              verify_layered_result, run_shared_layered_validation)


def fixture(depth=4):
    """Synthetic known stack used only by tests, not by completion search."""
    full = [box(i, i, 12-i, 12-i) for i in range(depth)]
    colors = [[230, 80, 40], [240, 220, 100], [40, 60, 180], [10, 10, 10]][:depth]
    observed, pieces = [], []
    for i, polygon in enumerate(full):
        above = unary_union(full[i+1:])
        visible = polygon.difference(above)
        component, region, slot = f'R{i}-C1', f'R{i}', f'RGB-{i}'
        observed.append({'componentId': component, 'regionId': region, 'colorSlotId': slot,
                         'rgb': colors[i], 'polygon': visible, 'boundaryProvenance': {'test': 'EXACT_GRID'}})
        pieces.append({'id': f'P{i}', 'colorSlotId': slot, 'rgb': colors[i], 'polygon': polygon,
                       'visiblePolygon': visible, 'hiddenPolygon': polygon.intersection(above),
                       'sourceComponentIds': [component], 'sourceRegionIds': [region],
                       'completionEvidence': [{'method': 'foreground-supported-hole-completion' if i+1 < depth else 'observed-domain', 'inferredHiddenGeometry': i+1 < depth}],
                       'occluderIds': [f'P{j}' for j in range(i+1, depth)]})
    artifact = {'id': 'source.json', 'sha256': 'a'*64, 'identityMode': 'EXACT_BYTES', 'byteLength': 100, 'mediaType': 'application/json'}
    frames = [{'id': name, 'space': space, 'unit': unit, 'bounds': [0, 0, 12, 12], 'xDirection': 'RIGHT', 'yDirection': 'DOWN',
               'sampleConvention': 'PIXEL_CELL_BOUNDARY' if name in ('source', 'analysis') else 'CONTINUOUS', 'sourceArtifactId': artifact['id']}
              for name, space, unit in [('source', 'source-native', 'native-unit'), ('analysis', 'analysis-raster', 'px'), ('p004c', 'p0-04c', 'px'), ('canonical', 'fabrication-canonical', 'canonical-unit')]]
    inp = {'schemaVersion': 'b2.input/1', 'assetVersionId': 'sha256:'+'a'*64, 'artifacts': [artifact],
           'source': {'mediaType': 'application/json', 'sourceKind': 'FLAT', 'artifactId': artifact['id'], 'normalizedLayerEvidenceId': None,
                      'adapter': {'id': 'test-exact-vector', 'version': '1', 'status': 'SUPPORTED'}},
           'coordinates': {'frames': frames, 'sourceFrameId': 'source', 'analysisFrameId': 'analysis', 'p004cFrameId': 'p004c', 'canonicalFrameId': 'canonical',
                           'transforms': [{'id': a+'-'+b, 'fromFrameId': a, 'toFrameId': b, 'matrix': [1,0,0,1,0,0], 'evidenceArtifactIds': [artifact['id']]}
                                          for a,b in [('source','analysis'),('analysis','p004c'),('p004c','canonical')]]},
           'frozenRegionArtifactId': artifact['id'], 'frozenVectorArtifactId': artifact['id'],
           'colorSlots': [{'id': s['colorSlotId'], 'purificationArtifactId': artifact['id'], 'paletteEntryId': s['colorSlotId'], 'rgb': s['rgb'], 'skinFamily': None} for s in observed],
           'observedRegions': [{'id': s['regionId'], 'componentIds': [s['componentId']], 'colorSlotId': s['colorSlotId'],
                                'geometry': {'artifactId': artifact['id'], 'objectId': s['regionId'], 'frameId': 'canonical'}} for s in observed]}
    plan = {'pieces': pieces, 'bottomToTop': [p['id'] for p in pieces], 'physicalSeams': [],
            'occlusionEdges': [{'belowPieceId': f'P{i}', 'abovePieceId': f'P{j}'} for i in range(depth) for j in range(i+1, depth)]}
    return inp, plan, observed


class LayeredContractTests(unittest.TestCase):
    def setUp(self):
        self.inp, self.plan, self.observed = fixture()
        self.wire = build_layered_result(self.inp, self.plan, self.observed)

    def resign(self, wire):
        return run_shared_layered_validation(wire, sign_result=True)['signedResult']

    def test_actual_shared_contract_and_saved_four_layer_replay(self):
        persisted = json.loads(json.dumps(self.wire))
        checked = verify_layered_result(persisted, self.observed, (12, 12))
        self.assertEqual(checked['mismatchPixelCount'], 0)
        self.assertEqual(tuple(checked['rgba'][5, 5]), (10, 10, 10, 255))
        self.assertEqual(len(persisted['payload']['bottomToTop']), 4)
        self.assertTrue(run_shared_layered_validation(persisted)['ok'])

    def test_real_three_layer_replay(self):
        inp, plan, observed = fixture(3)
        result = build_layered_result(inp, plan, observed)
        self.assertEqual(verify_layered_result(result, observed, (12, 12))['mismatchPixelCount'], 0)

    def test_rehashed_hidden_geometry_declaration_rejected(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][0]['hidden'] = mapping(GeometryCollection())
        with self.assertRaisesRegex(LayeredContractError, 'hidden'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_coherently_rehashed_wrong_order_and_claims_rejected(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['bottomToTop'] = list(reversed(bad['payload']['bottomToTop']))
        for p in bad['payload']['pieces']:
            p['occluderIds'] = []
        bad['payload']['occlusionEdges'] = []
        # Rehashing and internally consistent declarations cannot make the
        # new top's unsupported color replace freshly observed source domains.
        with self.assertRaises(LayeredContractError):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_rehashed_missing_actual_occluder_rejected(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][0]['occluderIds'].pop()
        with self.assertRaisesRegex(LayeredContractError, 'occluder'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_rehashed_swapped_component_sources_rejected(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][0]['sourceComponentIds'] = ['R1-C1']
        with self.assertRaisesRegex(LayeredContractError, 'Component|cross-region'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_rehashed_geometry_crosses_transparent_foreground_gap(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][0]['full'] = mapping(box(-1, 0, 12, 12))
        with self.assertRaisesRegex(LayeredContractError, 'transparency'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_intermediate_holes_permitted_but_final_piece_hole_rejected(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][0]['full'] = mapping(self.observed[0]['polygon'])
        with self.assertRaisesRegex(LayeredContractError, 'hole-free'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_rehashed_missing_piece_and_coverage_rejected(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'].pop()
        bad['payload']['bottomToTop'].pop()
        for p in bad['payload']['pieces']:
            p['occluderIds'] = [i for i in p['occluderIds'] if i != 'P3']
        bad['payload']['occlusionEdges'] = [e for e in bad['payload']['occlusionEdges'] if e['abovePieceId'] != 'P3']
        with self.assertRaises(LayeredContractError):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_same_color_cannot_silently_change_exact_rgb(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][1]['rgb'][0] += 1
        with self.assertRaisesRegex(LayeredContractError, 'palette|ColorSlot'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_rehashed_input_metadata_cannot_replace_actual_source_binding(self):
        bad = copy.deepcopy(self.wire)
        # Update both wire source and embedded source: valid shared structure,
        # but still inconsistent with fresh actual Component domains.
        bad['payload']['input']['observedRegions'][0]['componentIds'] = ['FORGED-C1']
        bad['payload']['pieces'][0]['sourceComponentIds'] = ['FORGED-C1']
        with self.assertRaisesRegex(LayeredContractError, 'actual observed'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_actual_canvas_is_not_a_caller_option(self):
        with self.assertRaisesRegex(LayeredContractError, 'canonical frame'):
            verify_layered_result(self.wire, self.observed, (20, 20))

    def test_rehashed_piece_cycle_is_rejected_by_shared_contract(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['occlusionEdges'].append({'belowPieceId': 'P3', 'abovePieceId': 'P0'})
        self.assertFalse(run_shared_layered_validation(bad, sign_result=True)['ok'])

    def test_hidden_only_useless_piece_cannot_be_inserted(self):
        bad = copy.deepcopy(self.wire)
        duplicate = copy.deepcopy(bad['payload']['pieces'][0])
        duplicate['id'] = 'EXTRA'
        duplicate['visible'] = mapping(GeometryCollection())
        duplicate['hidden'] = duplicate['full']
        duplicate['occluderIds'] = list(bad['payload']['bottomToTop'])
        bad['payload']['bottomToTop'].insert(0, 'EXTRA')
        bad['payload']['pieces'].append(duplicate)
        bad['payload']['occlusionEdges'] += [{'belowPieceId': 'EXTRA', 'abovePieceId': f'P{i}'} for i in range(4)]
        with self.assertRaisesRegex(LayeredContractError, 'fully hidden'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_no_unsigned_payload_mutation(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['userVisualAcceptance'] = 'PASS'
        self.assertFalse(run_shared_layered_validation(bad)['ok'])

    def test_real_shared_input_validation_not_python_replacement(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['input']['artifacts'] = []
        self.assertFalse(run_shared_layered_validation(bad, sign_result=True)['ok'])

    def test_actual_engine_candidate_serializes_and_independent_metrics_match(self):
        from layered_completion import propose_layered_plans
        plan = propose_layered_plans(self.observed)[0]
        wire = build_layered_result(self.inp, plan, self.observed)
        verified = verify_layered_result(wire, self.observed, (12, 12))
        self.assertEqual(verified['metrics'], plan['score'])
        self.assertEqual(verified['rawRasterMismatchPixelCount'], 0)
        self.assertEqual(verified['sharedBoundaryTiePixelCount'], 0)
        self.assertEqual(verified['interiorMismatchPixelCount'], 0)

    def test_true_transparent_hole_uses_actual_full_piece_seams(self):
        from layered_completion import propose_layered_plans
        inp, _, _ = fixture(1)
        observed = [dict(self.observed[0], polygon=box(0, 0, 12, 12).difference(box(4, 4, 8, 8)))]
        plan = propose_layered_plans(observed)[0]
        self.assertGreater(len(plan['physicalSeams']), 0)
        wire = build_layered_result(inp, plan, observed)
        checked = verify_layered_result(wire, observed, (12, 12))
        self.assertEqual(int(checked['rgba'][5, 5, 3]), 0)
        self.assertEqual(checked['metrics'], plan['score'])
        bad = copy.deepcopy(wire)
        bad['payload']['physicalSeams'].pop()
        with self.assertRaisesRegex(LayeredContractError, 'seam'):
            verify_layered_result(self.resign(bad), observed, (12, 12))

    def test_rehashed_fabricated_seam_length_is_rejected(self):
        from layered_completion import propose_layered_plans
        inp, _, _ = fixture(1)
        observed = [dict(self.observed[0], polygon=box(0, 0, 12, 12).difference(box(4, 4, 8, 8)))]
        wire = build_layered_result(inp, propose_layered_plans(observed)[0], observed)
        wire['payload']['physicalSeams'][0]['lengthCanonical'] += 1
        with self.assertRaisesRegex(LayeredContractError, 'seam'):
            verify_layered_result(self.resign(wire), observed, (12, 12))

    def test_rehashed_hidden_material_cannot_claim_observed_source(self):
        for field, value in [('inferredHiddenGeometry', False), ('sourceDomainRole', 'FULL_OBSERVED')]:
            with self.subTest(field=field):
                bad = copy.deepcopy(self.wire)
                bad['payload']['pieces'][0][field] = value
                with self.assertRaisesRegex(LayeredContractError, 'hidden|Hidden'):
                    verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_rehashed_hidden_material_requires_explicit_hypothesis(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['pieces'][0]['completionEvidence'] = [{'method': 'observed-domain', 'inferredHiddenGeometry': False}]
        with self.assertRaisesRegex(LayeredContractError, 'hypothesis'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))

    def test_malformed_public_shared_contract_fails_closed_without_crash(self):
        cases = [None, {}, {'schemaVersion': 'bad'}, copy.deepcopy(self.wire), copy.deepcopy(self.wire), copy.deepcopy(self.wire)]
        cases[3]['payload']['pieces'] = [None]
        cases[4]['payload']['pieces'][0].pop('occluderIds')
        cases[5]['payload']['occlusionEdges'] = [None]
        for bad in cases:
            with self.subTest(value=bad):
                self.assertFalse(run_shared_layered_validation(bad, sign_result=True)['ok'])

    def test_rehashed_fabrication_order_cannot_claim_original_author_layers(self):
        bad = copy.deepcopy(self.wire)
        bad['payload']['orderSemantics'] = 'CONFIRMED_AUTHOR_LAYER_HISTORY'
        self.assertFalse(run_shared_layered_validation(bad, sign_result=True)['ok'])

    def test_nonorthogonal_fractional_completion_persisted_domain_replay(self):
        # General fractional, non-axis-aligned boundaries, not coordinates or
        # an extracted contour from a real image. Visible rings are legitimate
        # intermediate domains; final actual pieces are complete solid layers.
        from layered_completion import propose_layered_plans
        outer = Polygon([(0.2, 1.7), (9.3, 0.4), (11.6, 8.9), (6.7, 11.2), (1.1, 9.8)])
        middle = Polygon([(2.23, 3.18), (7.47, 1.91), (9.37, 7.86), (5.13, 8.73)])
        upper = Polygon([(4.39, 4.67), (6.23, 3.41), (7.59, 6.17), (5.11, 7.03)])
        inp, _, sources = fixture(3)
        observed = [dict(sources[0], polygon=outer.difference(middle)),
                    dict(sources[1], polygon=middle.difference(upper)),
                    dict(sources[2], polygon=upper)]
        plan = propose_layered_plans(observed)[0]
        wire = build_layered_result(inp, plan, observed)
        # A real JSON round trip prevents relying on generated Shapely objects.
        persisted = json.loads(json.dumps(wire))
        verified = verify_layered_result(persisted, observed, (12, 12))
        self.assertEqual(verified['metrics']['layerDepth'], 3)
        self.assertEqual(verified['metrics']['pieceCount'], 3)
        self.assertEqual(verified['interiorMismatchPixelCount'], 0)
        by_id = {p['id']: p for p in persisted['payload']['pieces']}
        above = GeometryCollection()
        from solid_plans import _parts
        for pid in reversed(persisted['payload']['bottomToTop']):
            piece = by_id[pid]
            full = shape(piece['full'])
            hidden = unary_union(_parts(full.intersection(above)))
            self.assertTrue(hidden.equals(shape(piece['hidden'])))
            above = unary_union([above, full])

    def test_rehashed_negligible_area_cannot_hide_remote_hidden_boundary(self):
        bad = copy.deepcopy(self.wire)
        actual = shape(bad['payload']['pieces'][0]['hidden'])
        # Much smaller than the existing numerical area tolerance and smaller
        # than a raster pixel, but a new boundary far from the true hidden set.
        # Area, bbox or rerender-only acceptance must not authorize this claim.
        sliver = Polygon([(0.5, 0.5), (0.5000001, 0.5), (0.5, 0.5000001)])
        forged = actual.union(sliver)
        self.assertLess(actual.symmetric_difference(forged).area, 144e-9)
        self.assertGreater(actual.boundary.hausdorff_distance(forged.boundary), 0.1)
        bad['payload']['pieces'][0]['hidden'] = mapping(forged)
        with self.assertRaisesRegex(LayeredContractError, 'hidden: full domain/boundary differs'):
            verify_layered_result(self.resign(bad), self.observed, (12, 12))


if __name__ == '__main__':
    unittest.main()
