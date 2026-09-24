"""Actual quality-path integration and persisted semantic tamper rejection."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from algorithm_runtime import run_algorithm
from m1_adapter import canonical_bytes, build_input
from m4_runtime import run_runtime, REPOSITORY_ROOT
from quality_binding import verify_quality_design


def read(path):
    return json.loads(path.read_text('utf-8'))


def circle_ring():
    y, x = np.mgrid[:40, :40]
    radius = np.hypot(x - 19.5, y - 19.5)
    rgba = np.full((40, 40, 4), [255, 255, 255, 0], np.uint8)
    rgba[radius < 17] = [210, 45, 45, 255]
    rgba[radius < 10] = [35, 70, 215, 255]
    rgba[radius < 4, 3] = 0
    return rgba


class QualityPipelineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / 'ring.png'
        cls.source_rgba = circle_ring()
        Image.fromarray(cls.source_rgba).save(cls.source)
        cls.source_bytes = cls.source.read_bytes()
        cls.runs = {}
        for mode in ('baseline', 'selection', 'contour', 'combined'):
            target = cls.root / mode
            summary = run_algorithm(image_path=cls.source, output_root=target,
                                    foreground_source='DEVELOPMENT_SYNTHETIC explicit ring',
                                    quality_mode=mode)
            cls.runs[mode] = (target, summary)

    def cloned_m4(self, suffix):
        target = self.root / ('mutation-' + suffix)
        shutil.copytree(self.runs['combined'][0] / 'm4', target)
        return target

    def rewrite_design_manifest(self, root, design):
        data = canonical_bytes(design)
        (root / 'experimental-design.json').write_bytes(data)
        report = read(root / 'report.json')
        digest = hashlib.sha256(data).hexdigest()
        report['experimentalDesign']['sha256'] = digest
        report['configuration']['experimentalDesign']['sha256'] = digest
        for name in report['artifactSha256']:
            report['artifactSha256'][name] = hashlib.sha256((root / name).read_bytes()).hexdigest()
        (root / 'report.json').write_bytes(canonical_bytes(report))

    def test_four_actual_modes_complete_and_keep_original_alpha_and_hole(self):
        self.assertEqual(self.source.read_bytes(), self.source_bytes)
        for mode, (root, summary) in self.runs.items():
            with self.subTest(mode=mode):
                self.assertIn('M7_PLAN_AND_M6_REVIEW', summary['completedStages'])
                self.assertIn('INDEPENDENT_PIECE_RERENDER', summary['completedStages'])
                self.assertEqual(summary['rerenderChecks']['renderBackStatus'], 'PASS')
                self.assertEqual(summary['rerenderChecks']['mismatchPixelCount'], 0)
                self.assertFalse(summary['productionExportEligible'])
                self.assertTrue(read(root / 'shared-validation.json')['ok'])
                for name in ('input-foreground.png', 'purified.png'):
                    with Image.open(root / 'm4' / name) as image:
                        np.testing.assert_array_equal(np.array(image)[..., 3], self.source_rgba[..., 3])
                with Image.open(root / 'rerender.png') as image:
                    self.assertEqual(image.convert('RGBA').getpixel((19, 19))[3], 0)
                self.assertEqual((root / 'm4/source-snapshot.png').read_bytes(), self.source_bytes)
                if mode == 'baseline':
                    self.assertFalse((root / 'm4/experimental-design.json').exists())
                else:
                    self.assertEqual(verify_quality_design(root / 'm4')['status'], 'PASS')
                    self.assertEqual(summary['qualityAcceptance']['AtoB'], 'PENDING_MANUAL_REVIEW')

    def test_actual_new_design_identity_flows_through_input_and_piece_result(self):
        identities = []
        for mode in ('selection', 'contour', 'combined'):
            root, _ = self.runs[mode]
            design = read(root / 'm4/experimental-design.json')
            digest = hashlib.sha256((root / 'm4/experimental-design.json').read_bytes()).hexdigest()
            supplied = read(root / 'fabrication-input.json')
            final = read(root / 'fabrication-result.json')['payload']['input']
            self.assertEqual(supplied['assetVersionId'], 'sha256:' + digest)
            self.assertEqual(final['assetVersionId'], supplied['assetVersionId'])
            self.assertEqual(supplied['source']['adapter']['id'], 'm4-experimental-application-design')
            self.assertFalse(design['frozenEvidence'])
            self.assertEqual(design['humanConfirmation'], 'PENDING_REVIEW')
            self.assertEqual(design['selection']['enabled'], mode in {'selection', 'combined'})
            self.assertEqual(design['contours']['enabled'], mode in {'contour', 'combined'})
            artifacts = {a['id']: a for a in final['artifacts']}
            for name in ('experimental-design.json', 'structural_label_map.npz', 'pixel_label_map.npz',
                         'baseline-analysis.npz', 'baseline-regions.json'):
                self.assertEqual(artifacts[name]['sha256'], hashlib.sha256((root / 'm4' / name).read_bytes()).hexdigest())
            identities.append(supplied['assetVersionId'])
        self.assertEqual(len(set(identities)), 3)

    def test_shared_edge_display_contains_actual_control_points_once_per_edge(self):
        import re
        import xml.etree.ElementTree as ET
        for mode in ('selection', 'contour', 'combined'):
            root, _ = self.runs[mode]
            vector = read(root / 'm4/vector-result.json')
            svg = ET.parse(root / 'shared-edges.svg').getroot()
            paths = svg.findall('.//{http://www.w3.org/2000/svg}path')
            self.assertEqual(len(paths), len(vector['geometry']))
            by_id = {p.attrib['data-edge-id']:p.attrib['d'] for p in paths}
            self.assertEqual(len(by_id), len(paths))
            for edge in vector['geometry']:
                commands = re.findall(r'[MLC]', by_id[edge['edgeId']])
                expected_commands, expected_values = [], []
                for segment in edge['segments']:
                    expected_commands += ['M', 'C' if segment['type']=='CUBIC' else 'L']
                    points = ('p0','c1','c2','p1') if segment['type']=='CUBIC' else ('p0','p1')
                    expected_values.extend(float(v) for key in points for v in segment[key])
                values = [float(v) for v in re.findall(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', by_id[edge['edgeId']])]
                self.assertEqual(commands, expected_commands)
                self.assertEqual(values, expected_values)

    def test_direct_public_options_reject_before_any_write(self):
        bad_options = ({'quality_mode': 'unknown'}, {'seam_strategy': 'unknown'},
                       {'foreground_cleanup': True}, {'quality_mode': 'combined', 'foreground_cleanup': 1})
        for index, options in enumerate(bad_options):
            output = self.root / ('invalid-' + str(index))
            with self.assertRaises(ValueError):
                run_algorithm(image_path=self.source, output_root=output,
                              foreground_source='DEVELOPMENT_SYNTHETIC', **options)
            self.assertFalse(output.exists())
        for index, options in enumerate(({'quality_mode': 'bad'}, {'foreground_cleanup': True},
                                         {'quality_mode': 'combined', 'foreground_cleanup': 'true'})):
            output = self.root / ('invalid-m4-' + str(index))
            with self.assertRaises(ValueError):
                run_runtime(image_path=self.source, output_root=output, mode='embedded-alpha', mask_path=None,
                            foreground_source='DEVELOPMENT_SYNTHETIC', manual_confirmation='PENDING_REVIEW',
                            runtime_id='quality-direct', profile='aggressive', **options)
            self.assertFalse(output.exists())

    def test_experimental_options_do_not_bypass_output_isolation(self):
        occupied = self.root / 'occupied'; occupied.mkdir(); (occupied / 'keep.txt').write_bytes(b'keep\x00')
        protected = REPOSITORY_ROOT / 'benchmarks/background-removal/quality-pipeline-must-not-exist'
        self.assertFalse(protected.exists())
        for output in (occupied, protected, self.root):
            with self.assertRaises(ValueError):
                run_algorithm(image_path=self.source, output_root=output,
                              foreground_source='DEVELOPMENT_SYNTHETIC', quality_mode='combined')
        self.assertEqual((occupied / 'keep.txt').read_bytes(), b'keep\x00')
        self.assertEqual([p.name for p in occupied.iterdir()], ['keep.txt'])
        self.assertFalse(protected.exists())

    def test_persisted_changed_label_rejected_even_when_map_and_manifest_hashes_recomputed(self):
        root = self.cloned_m4('label')
        with np.load(root / 'structural_label_map.npz') as arrays:
            labels = arrays['labels'].copy()
        y, x = np.argwhere(labels > 0)[0]
        labels[y, x] = 0
        np.savez_compressed(root / 'structural_label_map.npz', labels=labels)
        design = read(root / 'experimental-design.json')
        design['newStructuralSha256'] = hashlib.sha256(labels.astype('<i4').tobytes()).hexdigest()
        self.rewrite_design_manifest(root, design)
        with self.assertRaises(ValueError):
            verify_quality_design(root)

    def test_persisted_mapping_lie_rejected_with_recomputed_manifest_identity(self):
        root = self.cloned_m4('mapping')
        design = read(root / 'experimental-design.json')
        design['selection']['componentMappings'][0]['newRegionId'] = 999999
        self.rewrite_design_manifest(root, design)
        with self.assertRaises(ValueError):
            verify_quality_design(root)

    def test_explicit_cleanup_reenters_actual_pipeline_with_separate_alpha_domain(self):
        source = self.root / 'cleanup-input.png'
        rgba = np.full((32, 32, 4), [255, 255, 255, 0], np.uint8)
        rgba[8:28, 8:28] = [20, 20, 20, 255]
        rgba[6, 15] = [220, 220, 220, 255]
        Image.fromarray(rgba).save(source)
        before = source.read_bytes()
        output = self.root / 'cleanup-run'
        summary = run_algorithm(image_path=source, output_root=output,
                                foreground_source='DEVELOPMENT_SYNTHETIC explicit cleanup counterexample',
                                quality_mode='selection', foreground_cleanup=True)
        self.assertEqual(source.read_bytes(), before)
        design = read(output / 'm4/experimental-design.json')
        self.assertEqual(design['cleanup']['changedPixelsXY'], [[15, 6]])
        self.assertEqual(design['cleanup']['manualConfirmation'], 'NOT_CONFIRMED')
        self.assertEqual(design['derivedAlphaChangedPixels'], 1)
        with Image.open(output / 'm4/original-effective-foreground.png') as image:
            np.testing.assert_array_equal(np.array(image), rgba)
        with Image.open(output / 'm4/input-foreground.png') as image:
            derived = np.array(image)
        expected = rgba.copy(); expected[6, 15, 3] = 0
        np.testing.assert_array_equal(derived, expected)
        self.assertEqual(verify_quality_design(output / 'm4')['status'], 'PASS')
        self.assertEqual(summary['rerenderChecks']['mismatchPixelCount'], 0)

    def test_fake_approval_is_semantically_rejected_after_manifest_rehash(self):
        root = self.cloned_m4('approval')
        design = read(root / 'experimental-design.json'); design['frozenEvidence'] = True
        self.rewrite_design_manifest(root, design)
        with self.assertRaisesRegex(ValueError, 'frozen|approval'):
            build_input(root)

    def test_report_descriptor_cannot_forge_approval_or_reference_on_first_adapter_call(self):
        original = self.root / 'unadapted-design'
        run_runtime(image_path=self.source, output_root=original, mode='embedded-alpha', mask_path=None,
                    foreground_source='DEVELOPMENT_SYNTHETIC descriptor test', manual_confirmation='PENDING_REVIEW',
                    runtime_id='quality-unadapted', profile='aggressive', quality_mode='combined')
        self.assertFalse((original / 'm1-coordinates.json').exists())
        changes = [('frozenEvidence', True), ('humanConfirmation', 'CONFIRMED'),
                   ('artifact', 'other-design.json'), ('mode', 'selection'),
                   ('foregroundCleanupEnabled', True), ('frozenEvidence', 0),
                   ('foregroundCleanupEnabled', 0)]
        for placement in ('report', 'configuration', 'both'):
            for index, (key, value) in enumerate(changes):
                with self.subTest(placement=placement, field=key):
                    root = self.root / ('descriptor-' + placement + '-' + str(index))
                    shutil.copytree(original, root)
                    # A fresh adapter call must reject before it could propagate
                    # a forged report descriptor into M1 provenance.
                    before = {p.name:p.read_bytes() for p in root.iterdir() if p.is_file()}
                    report = read(root / 'report.json')
                    if placement in ('report', 'both'):
                        report['experimentalDesign'][key] = value
                    if placement in ('configuration', 'both'):
                        report['configuration']['experimentalDesign'][key] = value
                    (root / 'report.json').write_bytes(canonical_bytes(report))
                    with self.assertRaisesRegex(ValueError, 'descriptor|approval'):
                        build_input(root)
                    self.assertFalse((root / 'm1-coordinates.json').exists())
                    for name, data in before.items():
                        if name != 'report.json':
                            self.assertEqual((root / name).read_bytes(), data)

    def test_coherently_rehashed_purified_rgb_still_rejects_against_actual_rc_a(self):
        root = self.cloned_m4('purified-rgb')
        with Image.open(root / 'purified.png') as image:
            changed = np.array(image.convert('RGBA'))
        y, x = np.argwhere(changed[..., 3] > 0)[0]
        changed[y, x, 0] = (int(changed[y, x, 0]) + 31) % 256
        Image.fromarray(changed).save(root / 'purified.png')
        design = read(root / 'experimental-design.json')
        design['newPurifiedRgbaSha256'] = hashlib.sha256(changed.tobytes()).hexdigest()
        self.rewrite_design_manifest(root, design)
        with self.assertRaisesRegex(ValueError, 'RC-A|purified'):
            verify_quality_design(root)

    def test_coherently_rehashed_original_effective_cannot_replace_source_snapshot(self):
        root = self.cloned_m4('original-effective')
        with Image.open(root / 'original-effective-foreground.png') as image:
            changed = np.array(image.convert('RGBA'))
        y, x = np.argwhere(changed[..., 3] > 0)[0]
        changed[y, x, 0] = (int(changed[y, x, 0]) + 41) % 256
        Image.fromarray(changed).save(root / 'original-effective-foreground.png')
        design = read(root / 'experimental-design.json')
        design['originalEffectiveRgbaSha256'] = hashlib.sha256(changed.tobytes()).hexdigest()
        self.rewrite_design_manifest(root, design)
        with self.assertRaisesRegex(ValueError, 'source|snapshot'):
            verify_quality_design(root)

    def test_contour_budget_lie_rejected_after_manifest_rehash(self):
        root = self.cloned_m4('contour-budget')
        design = read(root / 'experimental-design.json')
        design['contours']['designDeviationBudgetsPx'] = [9999.0]
        self.rewrite_design_manifest(root, design)
        with self.assertRaisesRegex(ValueError, 'contour|budget'):
            verify_quality_design(root)

    def test_external_mask_replay_uses_mask_snapshot_in_new_design_domain(self):
        source = self.root / 'masked-source.png'
        mask = self.root / 'explicit-mask.png'
        # Embedded alpha intentionally disagrees. External-mask normalization
        # must be replayed, rather than comparing original-effective to source.
        opaque = self.source_rgba.copy(); opaque[..., 3] = 255
        Image.fromarray(opaque).save(source)
        Image.fromarray(self.source_rgba[..., 3]).save(mask)
        source_before, mask_before = source.read_bytes(), mask.read_bytes()
        output = self.root / 'external-mask-run'
        summary = run_algorithm(image_path=source, output_root=output,
                                foreground_source='DEVELOPMENT_SYNTHETIC explicit external mask',
                                quality_mode='combined', mode='external-mask', mask_path=mask)
        self.assertEqual(source.read_bytes(), source_before)
        self.assertEqual(mask.read_bytes(), mask_before)
        self.assertEqual((output / 'm4/external-mask-snapshot.png').read_bytes(), mask_before)
        with Image.open(output / 'm4/original-effective-foreground.png') as image:
            np.testing.assert_array_equal(np.array(image)[..., 3], self.source_rgba[..., 3])
        self.assertEqual(verify_quality_design(output / 'm4')['status'], 'PASS')
        self.assertEqual(summary['rerenderChecks']['mismatchPixelCount'], 0)


class QualityManyRegionReplayTests(unittest.TestCase):
    def test_double_digit_region_map_keys_replay_as_persisted_json_not_integer_sort_order(self):
        # Numeric Region IDs are keys in live frozen topology dictionaries.
        # JSON turns them into strings: numeric 1,2,10 ordering differs from
        # lexicographic "1","10","2" without any algorithmic disagreement.
        import m4_runtime as kernel
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'eleven-separated-disks.png'
            y, x = np.mgrid[:28, :72]
            rgba = np.full((28, 72, 4), [255, 255, 255, 0], np.uint8)
            for i in range(11):
                cx, cy = 6 + 12 * (i % 6), 7 + 14 * (i // 6)
                disk = (x-cx)**2 + (y-cy)**2 <= 9
                rgba[disk] = [35 + 17*i, 220 - 13*i, 50 + 11*i, 255]
            Image.fromarray(rgba).save(source)
            output = root / 'm4'
            report = run_runtime(image_path=source, output_root=output, mode='embedded-alpha', mask_path=None,
                                 foreground_source='DEVELOPMENT_SYNTHETIC eleven separated colored disks',
                                 manual_confirmation='PENDING_REVIEW', runtime_id='quality-many-regions',
                                 profile='aggressive', quality_mode='selection')
            with np.load(output / 'structural_label_map.npz') as arrays:
                labels = arrays['labels']
            region_ids = sorted(int(v) for v in np.unique(labels) if v > 0)
            self.assertEqual(region_ids, list(range(1, 12)))
            config = report['configuration']
            _, live_vector, _ = kernel._vectorize(labels, rgba[..., 3], report['runtimeId'],
                                                  config['runtimeProfileId'], config['effectiveVectorConfig'])
            persisted = read(output / 'vector-result.json')
            self.assertNotEqual(canonical_bytes(live_vector), canonical_bytes(persisted))
            self.assertEqual(json.loads(canonical_bytes(live_vector)), persisted)
            self.assertEqual(verify_quality_design(output)['status'], 'PASS')


if __name__ == '__main__':
    unittest.main()
