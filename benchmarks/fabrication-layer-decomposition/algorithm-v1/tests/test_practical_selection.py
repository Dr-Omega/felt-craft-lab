"""Objective small-design controls; no real-case coordinates or hidden answers."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT.parent / 'tools')]
import m4_runtime as runtime
from color_purification import assign_fringe_pixels
from design_color_controls import control
from design_color_regions import validate_request
from practical_selection import rebuild_regions
from quality_fragments import _summary

CONFIG = runtime.load_profile('aggressive')[0]


def run(rgba, *, reference=None, labels=None, pixels=None):
    if labels is None:
        labels = runtime.get_candidate('CP-B').propose(rgba, CONFIG).structural_label_map
    if pixels is None:
        pixels, _ = assign_fringe_pixels(rgba, labels, CONFIG)
    request = validate_request(reference, 'explicit synthetic design palette' if reference else None)
    return rebuild_regions(rgba, labels, pixels, CONFIG, request)


def draw(truth, palette):
    rgba = np.zeros((*truth.shape, 4), np.uint8)
    for label, rgb in enumerate(palette, 1):
        rgba[truth == label] = [*rgb, 255]
    return rgba


class PracticalSelectionTests(unittest.TestCase):
    def assert_exact_partition(self, labels, truth):
        np.testing.assert_array_equal(labels > 0, truth > 0)
        mapped = []
        for identity in np.unique(truth[truth > 0]):
            values = np.unique(labels[truth == identity])
            self.assertEqual(len(values), 1, f'design identity {identity} split across labels {values}')
            mapped.append(int(values[0]))
        self.assertEqual(len(set(mapped)), len(mapped), 'distinct design colors merged')
        self.assertEqual(_summary(labels)['components'], _summary(truth)['components'])

    def test_automatic_five_six_nine_color_known_domains(self):
        for count in (5, 6, 9):
            with self.subTest(colors=count):
                rgba, truth, _ = control(count)
                labels, pixels, report = run(rgba)
                self.assert_exact_partition(labels, truth)
                self.assertEqual(report['actualUsedColorCount'], count)
                self.assertFalse(report['automaticUsesReferenceAnswer'])
                np.testing.assert_array_equal(pixels > 0, rgba[..., 3] > 0)

    def test_near_color_surfaces_survive_transition_without_claiming_transition_truth(self):
        rgba = np.zeros((70, 100, 4), np.uint8)
        first, second = np.array([220, 170, 160]), np.array([240, 190, 180])
        rgba[5:65, 5:95] = [*first, 255]
        rgba[5:65, 53:95] = [*second, 255]
        for x in range(45, 53):
            rgba[5:65, x, :3] = np.rint(first+(x-44)/9*(second-first)).astype(np.uint8)
        labels, _, report = run(rgba)
        self.assertEqual(report['actualUsedColorCount'], 2)
        self.assertEqual(len(np.unique(labels[10:60, 10:40])), 1)
        self.assertEqual(len(np.unique(labels[10:60, 58:90])), 1)
        self.assertNotEqual(labels[30, 20], labels[30, 75])
        np.testing.assert_array_equal(labels > 0, rgba[..., 3] > 0)

    def test_black_rim_line_close_inks_independent_decoration_and_real_hole(self):
        palette = [[8, 8, 8], [182, 44, 48], [204, 59, 61], [254, 249, 200]]
        truth = np.zeros((64, 80), np.int32)
        truth[5:59, 5:75] = 1
        truth[6:58, 6:74] = 2
        truth[6:58, 40:74] = 3
        truth[20:30, 15:25] = 4
        truth[1:3, 15:17] = 4
        truth[12:45, 35] = 1
        truth[35:40, 50:55] = 0
        rgba = draw(truth, palette)
        for reference in (None, palette):
            with self.subTest(reference=reference is not None):
                labels, _, report = run(rgba, reference=reference)
                self.assert_exact_partition(labels, truth)
                self.assertEqual(report['actualUsedColorCount'], 4)

    def test_same_color_disconnected_motifs_share_identity_not_geometry(self):
        truth = np.zeros((64, 80), np.int32)
        truth[6:28, 5:30] = 1
        truth[37:59, 48:75] = 1
        truth[10:22, 40:53] = 2
        rgba = draw(truth, [[190, 35, 40], [245, 200, 20]])
        labels, _, report = run(rgba)
        self.assert_exact_partition(labels, truth)
        self.assertEqual(report['actualUsedColorCount'], 2)
        self.assertEqual(_summary(labels)['components'], 3)

    def test_fully_transparent_rgb_is_unobservable_source_and_baseline_immutable(self):
        rgba, _, _ = control(6)
        changed = rgba.copy()
        rng = np.random.default_rng(113)
        hidden = changed[..., 3] == 0
        changed[hidden, :3] = rng.integers(0, 256, (int(hidden.sum()), 3), dtype=np.uint8)
        original = rgba.copy()
        baseline = runtime.get_candidate('CP-B').propose(rgba, CONFIG).structural_label_map
        pixels, _ = assign_fringe_pixels(rgba, baseline, CONFIG)
        before_labels, before_pixels = baseline.copy(), pixels.copy()
        a = run(rgba, labels=baseline, pixels=pixels)
        b = run(changed, labels=baseline, pixels=pixels)
        np.testing.assert_array_equal(a[0], b[0])
        np.testing.assert_array_equal(a[1], b[1])
        self.assertEqual(a[2], b[2])
        np.testing.assert_array_equal(rgba, original)
        np.testing.assert_array_equal(baseline, before_labels)
        np.testing.assert_array_equal(pixels, before_pixels)

    def test_semialpha_coverage_and_true_transparent_hole_are_separate(self):
        rgba = np.zeros((40, 48, 4), np.uint8)
        rgba[6:34, 7:41] = [210, 40, 40, 255]
        rgba[5, 7:41] = [210, 40, 40, 90]
        rgba[34, 7:41] = [210, 40, 40, 90]
        rgba[16:23, 19:26] = 0
        labels, pixels, report = run(rgba)
        np.testing.assert_array_equal(labels > 0, rgba[..., 3] >= CONFIG['structuralAlphaThreshold'])
        np.testing.assert_array_equal(pixels > 0, rgba[..., 3] > 0)
        self.assertTrue(np.all(labels[16:23, 19:26] == 0))
        self.assertFalse(report['sourceAlphaModified'])

    def test_wrong_baseline_support_dtype_or_fringe_rejected(self):
        rgba, truth, _ = control(5)
        old = runtime.get_candidate('CP-B').propose(rgba, CONFIG).structural_label_map
        pixels, _ = assign_fringe_pixels(rgba, old, CONFIG)
        wrong_support = old.copy()
        location = tuple(np.argwhere(truth > 0)[0])
        wrong_support[location] = 0
        with self.assertRaisesRegex(ValueError, 'support'):
            run(rgba, labels=wrong_support, pixels=pixels)
        with self.assertRaisesRegex(ValueError, 'int32'):
            run(rgba, labels=old.astype(np.int64), pixels=pixels)
        bad_pixels = pixels.copy()
        bad_pixels[location] = 0
        with self.assertRaisesRegex(ValueError, 'fringe'):
            run(rgba, labels=old, pixels=bad_pixels)

    def test_baseline_partition_ids_are_not_new_design_truth(self):
        rgba, truth, _ = control(6)
        flat = np.where(truth > 0, 1, 0).astype(np.int32)
        stripes = np.where(truth > 0, np.indices(truth.shape)[1]//5+1, 0).astype(np.int32)
        a, b = run(rgba, labels=flat), run(rgba, labels=stripes)
        np.testing.assert_array_equal(a[0], b[0])
        np.testing.assert_array_equal(a[1], b[1])

    def test_opt_in_call_does_not_mutate_default_source_bytes_or_default_output(self):
        paths = [ROOT/'layered_selection.py', ROOT/'design_color_regions.py',
                 ROOT.parent/'tools'/'m4_runtime.py']
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        config_before = copy.deepcopy(CONFIG)
        rgba, _, _ = control(5)
        old_before = runtime.get_candidate('CP-B').propose(rgba, CONFIG).structural_label_map
        _, _, report = run(rgba)
        old_after = runtime.get_candidate('CP-B').propose(rgba, CONFIG).structural_label_map
        np.testing.assert_array_equal(old_before, old_after)
        self.assertEqual(CONFIG, config_before)
        self.assertEqual(before, {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
        json.dumps(report, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
