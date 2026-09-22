import copy
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from shapely.geometry import box, mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from m1_adapter import artifact, canonical_bytes, run_shared_validation
from relations import assembly_relations, visual_relations
from result_wire import ResultWireError, build_result, build_assessment
from rerender import verify_and_render
from solid_plans import propose_plans, validate_plan


class ResultWireTests(unittest.TestCase):
    def fixture(self, root):
        ring = box(0, 0, 12, 10).difference(box(3, 3, 8, 7))
        center = box(3, 3, 8, 7)
        observed = [
            {'componentId': 'R00001-C001', 'regionId': 'R00001', 'colorSlotId': 'RGB-DC2823', 'rgb': [220, 40, 35], 'polygon': ring,
             'boundaryProvenance': {'source': 'SYNTHETIC_DEVELOPMENT_EXACT_VECTOR', 'edgeIds': ['outer', 'inner']}},
            {'componentId': 'R00002-C001', 'regionId': 'R00002', 'colorSlotId': 'RGB-143CE1', 'rgb': [20, 60, 225], 'polygon': center,
             'boundaryProvenance': {'source': 'SYNTHETIC_DEVELOPMENT_EXACT_VECTOR', 'edgeIds': ['inner']}},
        ]
        self.observed = observed
        source_objects = {value['regionId']: mapping(value['polygon']) for value in observed}
        (root / 'development-source.json').write_bytes(canonical_bytes({'source': 'SYNTHETIC_DEVELOPMENT', 'objects': source_objects,
            'palette': {value['colorSlotId']: value['rgb'] for value in observed}}))
        source = artifact(root / 'development-source.json')
        frames = [{'id': name, 'space': space, 'unit': unit, 'bounds': [0, 0, 12, 10], 'xDirection': 'RIGHT', 'yDirection': 'DOWN',
                   'sampleConvention': 'PIXEL_CELL_BOUNDARY' if name in ('source', 'analysis') else 'CONTINUOUS', 'sourceArtifactId': source['id']}
                  for name, space, unit in [('source', 'source-native', 'native-unit'), ('analysis', 'analysis-raster', 'px'), ('p004c', 'p0-04c', 'px'), ('canonical', 'fabrication-canonical', 'canonical-unit')]]
        input_value = {'schemaVersion': 'b2.input/1', 'assetVersionId': 'sha256:' + source['sha256'], 'artifacts': [source],
            'source': {'mediaType': 'application/json', 'sourceKind': 'FLAT', 'artifactId': source['id'], 'normalizedLayerEvidenceId': None,
                       'adapter': {'id': 'development-exact-vector', 'version': '1', 'status': 'SUPPORTED'}},
            'coordinates': {'frames': frames, 'sourceFrameId': 'source', 'analysisFrameId': 'analysis', 'p004cFrameId': 'p004c', 'canonicalFrameId': 'canonical',
                            'transforms': [{'id': a+'-'+b, 'fromFrameId': a, 'toFrameId': b, 'matrix': [1,0,0,1,0,0], 'evidenceArtifactIds': [source['id']]}
                                           for a,b in [('source','analysis'),('analysis','p004c'),('p004c','canonical')]]},
            'frozenRegionArtifactId': source['id'], 'frozenVectorArtifactId': source['id'],
            'colorSlots': [{'id': value['colorSlotId'], 'purificationArtifactId': source['id'], 'paletteEntryId': value['colorSlotId'], 'rgb': value['rgb'], 'skinFamily': None} for value in observed],
            'observedRegions': [{'id': value['regionId'], 'componentIds': [value['componentId']], 'colorSlotId': value['colorSlotId'],
                                 'geometry': {'artifactId': source['id'], 'objectId': value['regionId'], 'frameId': 'canonical'}} for value in observed]}
        plan = next(value for value in propose_plans(observed) if value['splitGroups'])
        labels = np.ones((10, 12), np.int32)
        labels[3:7, 3:8] = 2
        relations = assembly_relations(observed, plan, visual_relations(observed, labels))
        objects = {value['id']: mapping(value['polygon']) for value in plan['pieces']}
        objects.update({f'exposure:{index}': mapping(value['polygon']) for index, value in enumerate(plan['baseExposures'])})
        objects.update({seam['id']: mapping(seam['polyline']) for group in plan['splitGroups'] for seam in group['seams']})
        objects.update({'source:'+group['id']: mapping(group['sourcePolygon']) for group in plan['splitGroups']})
        (root / 'fabrication-geometry.json').write_bytes(canonical_bytes({'objects': objects}))
        (root / 'relation-evidence.json').write_bytes(canonical_bytes({'relations': relations, 'partitionChecks': validate_plan(observed, plan)}))
        result = build_result(input_value, plan, relations, artifact(root / 'fabrication-geometry.json'), artifact(root / 'relation-evidence.json'), observed=observed)
        rendered = verify_and_render(result, {'objects': objects}, observed, (10, 12))
        checks_data = {key: value for key, value in rendered.items() if not isinstance(value, np.ndarray)}
        (root / 'geometry-checks.json').write_bytes(canonical_bytes(checks_data))
        return input_value, plan, relations, artifact(root / 'fabrication-geometry.json'), artifact(root / 'relation-evidence.json'), artifact(root / 'geometry-checks.json'), checks_data

    def test_real_m7_split_plan_passes_shared_wire_and_pending_assessment(self):
        with tempfile.TemporaryDirectory() as temp:
            inp, plan, relations, geometry, evidence, checks, checks_data = self.fixture(Path(temp))
            before = copy.deepcopy(inp)
            result = build_result(inp, plan, relations, geometry, evidence, observed=self.observed)
            self.assertEqual(inp, before)
            self.assertTrue(run_shared_validation(result=result)['ok'])
            self.assertTrue(result['payload']['splitGroups'])
            self.assertGreater(sum(seam['lengthCanonical'] for group in result['payload']['splitGroups'] for seam in group['seams']), 0)
            persisted = __import__('json').loads((Path(temp) / geometry['id']).read_text())['objects']
            for piece in result['payload']['pieces']:
                self.assertIn(piece['geometry']['objectId'], persisted)
            assessment = build_assessment(result, checks, checks_data)
            self.assertEqual(assessment['status'], 'REVIEW_REQUIRED')
            self.assertEqual(assessment['checks']['purification']['status'], 'REVIEW_REQUIRED')
            self.assertEqual(assessment['checks']['sourceSemantics']['status'], 'REVIEW_REQUIRED')
            self.assertTrue(run_shared_validation(result=result, assessment=assessment)['ok'])
            self.assertEqual(result, build_result(inp, plan, relations, geometry, evidence, observed=self.observed))

    def test_missing_proof_invalid_solid_and_bad_seam_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            inp, plan, relations, geometry, evidence, _, _ = self.fixture(Path(temp))
            bad = copy.deepcopy(plan)
            bad['geometryChecks']['sourceCoverage'] = 'FAIL'
            with self.assertRaisesRegex(ResultWireError, 'not passed'):
                build_result(inp, bad, relations, geometry, evidence, observed=self.observed)
            bad = copy.deepcopy(plan)
            bad['pieces'][0]['polygon'] = box(0, 0, 12, 10).difference(box(3, 3, 8, 7))
            with self.assertRaisesRegex(ResultWireError, 'retaining an interior hole'):
                build_result(inp, bad, relations, geometry, evidence, observed=self.observed)
            bad = copy.deepcopy(plan)
            bad['splitGroups'][0]['seams'][0]['lengthCanonical'] += 1
            with self.assertRaisesRegex(ResultWireError, 'Seam measurement'):
                build_result(inp, bad, relations, geometry, evidence, observed=self.observed)

    def test_artifact_collision_dangling_reference_and_cycle_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            inp, plan, relations, geometry, evidence, _, _ = self.fixture(Path(temp))
            bad = copy.deepcopy(inp)
            bad['artifacts'].append({**geometry, 'sha256': '0'*64})
            with self.assertRaisesRegex(ResultWireError, 'Conflicting artifact'):
                build_result(bad, plan, relations, geometry, evidence, observed=self.observed)
            bad_relations = copy.deepcopy(relations)
            assembly = next(value for value in bad_relations['records'] if value['kind'] == 'ASSEMBLY_PRECEDENCE' and value['status'] == 'RESOLVED')
            bad_relations['records'].append({**assembly, 'id': 'reverse-cycle', 'direction': 'B_TO_A' if assembly['direction'] == 'A_TO_B' else 'A_TO_B'})
            with self.assertRaisesRegex(ResultWireError, 'Shared FabricationResult rejected'):
                build_result(inp, plan, bad_relations, geometry, evidence, observed=self.observed)
            bad_plan = copy.deepcopy(plan)
            bad_plan['pieces'][0]['sourceRegionIds'] = ['missing']
            with self.assertRaisesRegex(ResultWireError, 'Shared FabricationResult rejected'):
                build_result(inp, bad_plan, relations, geometry, evidence, observed=self.observed)

    def test_assessment_rejects_failed_or_unbound_independent_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            inp, plan, relations, geometry, evidence, checks, checks_data = self.fixture(root)
            result = build_result(inp, plan, relations, geometry, evidence, observed=self.observed)
            bad = copy.deepcopy(checks_data)
            bad['mismatchPixelCount'] = 1
            with self.assertRaisesRegex(ResultWireError, 'evidence artifact identity'):
                build_assessment(result, checks, bad)
            mutations = [
                lambda value: value.pop('resultSha256'),
                lambda value: value.update(renderBackStatus='FAIL'),
                lambda value: value.update(mismatchPixelCount=1),
                lambda value: value.update(relationsStatus='FAIL'),
                lambda value: value.update(topologicalOrder=list(reversed(value['topologicalOrder']))),
            ]
            mutations.extend(lambda value, gate=gate: value['geometryChecks'].update({gate: 'FAIL'})
                             for gate in ('solidGeometry', 'frozenBoundaryAndVoids', 'sourceCoverage', 'splitConservation', 'addedSeams', 'baseSupport', 'splitDeclarationCompleteness'))
            for mutate in mutations:
                bad = copy.deepcopy(checks_data)
                mutate(bad)
                (root / 'geometry-checks.json').write_bytes(canonical_bytes(bad))
                with self.assertRaises(ResultWireError):
                    build_assessment(result, artifact(root / 'geometry-checks.json'), bad)

    def test_actual_independent_checks_cannot_be_replayed_for_a_different_result(self):
        with tempfile.TemporaryDirectory() as temp:
            inp, plan, relations, geometry, evidence, checks, checks_data = self.fixture(Path(temp))
            original = build_result(inp, plan, relations, geometry, evidence, observed=self.observed)
            self.assertEqual(checks_data['resultSha256'], original['identity']['sha256'])
            altered = copy.deepcopy(original)
            next(record for record in altered['payload']['input']['artifacts']
                 if record['id'] == geometry['id'])['sha256'] = 'f' * 64
            signed = run_shared_validation(result=altered, sign_result=True)
            self.assertTrue(signed['ok'])
            altered = signed['signedResult']
            self.assertNotEqual(altered['identity']['sha256'], original['identity']['sha256'])
            # Evidence is genuine and its bytes/digest are unchanged. It only
            # proves the original geometry/result, not another valid wire result.
            with self.assertRaisesRegex(ResultWireError, 'assessed result identity'):
                build_assessment(altered, checks, checks_data)


if __name__ == '__main__':
    unittest.main()
