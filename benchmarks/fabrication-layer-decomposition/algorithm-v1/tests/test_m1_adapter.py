import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from m1_adapter import build_input, canonical_bytes, run_shared_validation


class M1AdapterTests(unittest.TestCase):
    def make_runtime(self, root):
        for name in ('source-snapshot.png', 'input-foreground.png', 'purified.png'):
            Image.new('RGBA', (4, 4), (231, 40, 11, 255)).save(root / name)
        component = {'componentId': 'R00001-C001', 'outerRing': {'regionId': 1, 'edgeReferences': [{'edgeId': 'E001', 'direction': 1}]}, 'innerRings': []}
        for name, data in {
            'regions.json': [{'regionId': 1, 'representativeColorRgb': [231, 40, 11], 'representativeColorLab': [50,60,40], 'colorGroupId': 999, 'components': [{'componentId': 'R00001-C001'}]}],
            'boundary-graph.json': {'width': 4, 'height': 4, 'edges': [{'edgeId':'E001','geometry':[[0,0],[0,4],[4,4],[4,0],[0,0]]}], 'regions': [{'regionId': 1, 'components': [component]}]},
            'vector-result.json': {'route': 'V0', 'geometry': [{'edgeId': 'E001', 'segments': [{'type': 'L', 'p0': [0, 0], 'p1': [4, 0]}]}]},
            'report.json': {'input': {'sourceImage': {'sha256': hashlib.sha256((root / 'source-snapshot.png').read_bytes()).hexdigest()}, 'foregroundMode': 'embedded-alpha', 'foregroundInterpretation': 'DECODED_EMBEDDED_ALPHA', 'manualConfirmation': 'PENDING_REVIEW'}},
        }.items():
            (root / name).write_bytes(canonical_bytes(data))
        from component_binding import bind_components, SCHEMA
        from m4_runtime import _observed_candidates
        labels=np.ones((4,4),np.int32)
        np.savez_compressed(root/'structural_label_map.npz',labels=labels)
        read=lambda name:json.loads((root/name).read_text())
        regions,proof=bind_components(labels,read('boundary-graph.json'),read('regions.json'))
        (root/'regions.json').write_bytes(canonical_bytes(regions))
        (root/'component-binding.json').write_bytes(canonical_bytes(proof))
        report=read('report.json')
        report.update(runtimeId='test',selectedVector={'attemptedRoutes':['V0']},
                      componentBinding={'artifact':'component-binding.json','schemaVersion':SCHEMA,
                                        'sha256':hashlib.sha256((root/'component-binding.json').read_bytes()).hexdigest()})
        (root/'report.json').write_bytes(canonical_bytes(report))
        (root/'observed-candidates.json').write_bytes(canonical_bytes(_observed_candidates(
            'test',read('boundary-graph.json'),read('vector-result.json'),regions,['V0'])))

    def test_real_standalone_bridge_and_artifact_reference_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_runtime(root)
            value = build_input(root)
            self.assertTrue(run_shared_validation(input=value)['ok'])
            self.assertNotIn('pieces', value)
            self.assertEqual(value['colorSlots'][0]['rgb'], [231, 40, 11])
            self.assertEqual(value['colorSlots'][0]['id'], 'RGB-E7280B')
            for record in value['artifacts']:
                self.assertEqual(record['sha256'], hashlib.sha256((root / record['id']).read_bytes()).hexdigest())
            geometry = json.loads((root / 'm1-geometry.json').read_text())
            self.assertEqual(geometry['objects']['R00001']['selectedEdges'][0]['edgeId'], 'E001')
            self.assertEqual(value, build_input(root))

    def test_identity_does_not_depend_on_output_path(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.make_runtime(Path(a))
            self.make_runtime(Path(b))
            self.assertEqual(build_input(Path(a)), build_input(Path(b)))

    def test_missing_vector_reference_rejected_before_input_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_runtime(root)
            (root / 'vector-result.json').write_bytes(canonical_bytes({'route': 'V0', 'geometry': []}))
            with self.assertRaisesRegex(ValueError, 'missing (selected )?vector'):
                build_input(root)
            self.assertFalse((root / 'm1-palette.json').exists())

    def test_layered_native_viewbox_transform_and_original_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_runtime(root)
            original = b'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="10 20 8 8"><rect x="10" y="20" width="8" height="8" fill="#e7280b"/></svg>'
            (root / 'source.svg').write_bytes(original)
            evidence = {'sourceArtifact': {'path': str(root / 'source.svg'), 'mediaType': 'image/svg+xml', 'sha256': hashlib.sha256(original).hexdigest()}, 'status': 'SUPPORTED', 'sourceFrame': {'bounds': [10, 20, 8, 8], 'matrixToAnalysis': [0.5, 0, 0, 0.5, -5, -10], 'sampleConvention': 'CONTINUOUS'}, 'layers': []}
            value = build_input(root, evidence)
            self.assertTrue(run_shared_validation(input=value)['ok'])
            self.assertEqual(value['assetVersionId'], 'sha256:' + hashlib.sha256(original).hexdigest())
            self.assertEqual(value['coordinates']['frames'][0]['bounds'], [10, 20, 8, 8])
            self.assertEqual(value['coordinates']['transforms'][0]['matrix'], [0.5, 0, 0, 0.5, -5, -10])
            self.assertNotIn(str(root), (root / 'm1-layer-evidence.json').read_text())

    def test_real_svg_meet_letterbox_preserves_native_frame_through_runtime(self):
        from layered_sources import parse_layered
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
        from m4_runtime import run_runtime
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original = root / 'letterbox.svg'
            original.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 64"><rect id="foreground" width="64" height="64" fill="#e7280b"/></svg>', encoding='utf-8')
            parsed = parse_layered(original, ['foreground'])
            self.assertEqual(parsed['status'], 'SUPPORTED')
            self.assertEqual(parsed['sourceFrame']['matrixToAnalysis'], [0.75, 0.0, 0.0, 0.75, 8.0, 0.0])
            normalized = root / 'normalized.png'
            Image.fromarray(parsed['rgba']).save(normalized)
            runtime = root / 'runtime'
            run_runtime(image_path=normalized, mode='embedded-alpha', mask_path=None,
                        foreground_source='SYNTHETIC_DEVELOPMENT_SVG_EXPLICIT_FOREGROUND',
                        manual_confirmation='PENDING_REVIEW', runtime_id='m1-letterbox-test', profile='balanced', output_root=runtime)
            evidence = {'sourceArtifact': {'path': str(original), 'mediaType': parsed['sourceMediaType'], 'sha256': parsed['sourceSha256']},
                        'status': parsed['status'], 'sourceFrame': parsed['sourceFrame'], 'selectedLayerIds': parsed['selectedLayerIds']}
            value = build_input(runtime, evidence)
            self.assertEqual(value['coordinates']['frames'][0]['bounds'], [0.0, 0.0, 64.0, 64.0])
            self.assertEqual(value['coordinates']['frames'][1]['bounds'], [0, 0, 64, 48])
            self.assertEqual(value['coordinates']['transforms'][0]['matrix'], parsed['sourceFrame']['matrixToAnalysis'])
            self.assertTrue(run_shared_validation(input=value)['ok'])
            coordinate_evidence = json.loads((runtime / 'm1-coordinates.json').read_text())
            self.assertEqual(coordinate_evidence['mappedNativeBoundsInAnalysis'], [8.0, 0.0, 56.0, 48.0])
            evidence['sourceFrame']['matrixToAnalysis'][4] = 100
            with self.assertRaisesRegex(ValueError, 'does not map'):
                build_input(runtime, evidence)

    def test_snapshot_identity_drift_and_shared_coordinate_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_runtime(root)
            value = build_input(root)
            value['coordinates']['transforms'][0]['matrix'] = [0, 0, 0, 0, 0, 0]
            self.assertFalse(run_shared_validation(input=value)['ok'])
            (root / 'source-snapshot.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'snapshot differs'):
                build_input(root)

    def test_shared_signer_uses_javascript_number_serialization(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_runtime(root)
            result = {'schemaVersion': 'b2.result/1', 'identity': {'contractVersion': 'b2.result/1', 'algorithmRecipeId': 'test-only', 'algorithmRecipeVersion': '1', 'identityMode': 'CANONICAL_JSON_LF_UTF8', 'sha256': '0' * 64}, 'payload': {'input': build_input(root), 'pieces': [], 'baseExposures': [], 'splitGroups': [], 'relations': [], 'relationCoverage': [{'kind': kind, 'status': 'NOT_EVALUATED', 'evidenceArtifactIds': []} for kind in ('VISUAL_OCCLUSION_RELATION', 'ASSEMBLY_PRECEDENCE')], 'unspecifiedRelation': 'NOT_EVALUATED'}}
            # Signing does not turn an intermediate empty candidate into a valid result.
            result['payload']['input']['coordinates']['transforms'][0]['matrix'][0] = 1.0
            checked = run_shared_validation(result=result, sign_result=True)
            self.assertFalse(checked['ok'])
            self.assertNotEqual(checked['signedResult']['identity']['sha256'], '0' * 64)
            result['payload']['input']['coordinates']['transforms'][0]['matrix'][0] = 1
            self.assertEqual(checked['signedResult']['identity']['sha256'], run_shared_validation(result=result, sign_result=True)['signedResult']['identity']['sha256'])


if __name__ == '__main__':
    unittest.main()
