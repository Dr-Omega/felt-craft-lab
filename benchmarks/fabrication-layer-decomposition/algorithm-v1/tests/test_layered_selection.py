"""Spatial selection tests use no fixture identity or hidden colour answers."""
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),
               str(Path(__file__).resolve().parents[2] / 'tools')]
import m4_runtime as runtime
from color_purification import assign_fringe_pixels
from design_color_controls import control
from design_color_regions import estimate_palette, validate_request
from layered_selection import rebuild_regions
from quality_fragments import _summary

CONFIG = runtime.load_profile('aggressive')[0]


def run(rgba, reference=None, old=None, **options):
    if old is None:
        old = runtime.get_candidate('CP-B').propose(rgba, CONFIG).structural_label_map
    pixels, _ = assign_fringe_pixels(rgba, old, CONFIG)
    return rebuild_regions(rgba, old, pixels, CONFIG,
                           validate_request(reference, 'test design' if reference else None), **options)


class LayeredSelectionTests(unittest.TestCase):
    def test_coherent_near_color_plateaus_survive_smooth_separator(self):
        rgba = np.zeros((70, 100, 4), np.uint8)
        rgba[5:65, 5:95] = [220, 170, 160, 255]
        rgba[5:65, 52:95] = [240, 190, 180, 255]
        for x in range(45, 53):
            rgba[5:65, x, :3] = np.rint(np.array([220, 170, 160]) +
                                       (x-44)/9 * np.array([20, 20, 20])).astype(np.uint8)
        self.assertEqual(len(estimate_palette(rgba, CONFIG, validate_request())), 1)
        labels, _, report = run(rgba)
        self.assertEqual(report['actualUsedColorCount'], 2)
        self.assertNotEqual(labels[25, 20], labels[25, 75])
        self.assertTrue(any(item.get('coherentPlateau') and item['action'] == 'RESTORED'
                            for item in report['paletteModeDecisions']))

    def test_five_six_nine_color_designs_preserve_domains_automatically(self):
        for size in (5, 6, 9):
            rgba, truth, _ = control(size)
            labels, _, report = run(rgba)
            self.assertEqual(report['actualUsedColorCount'], size)
            correspondence = []
            for identity in np.unique(truth[truth > 0]):
                mapped = np.unique(labels[truth == identity])
                self.assertEqual(len(mapped), 1)
                correspondence.append(int(mapped[0]))
            self.assertEqual(len(set(correspondence)), size)
            self.assertEqual(_summary(labels)['components'], _summary(truth)['components'])

    def test_hidden_rgb_is_unobservable_and_source_is_immutable(self):
        rgba, _, _ = control(6)
        original = rgba.copy()
        altered = rgba.copy()
        altered[altered[..., 3] == 0, :3] = [93, 204, 6]
        first = run(rgba)
        second = run(altered)
        np.testing.assert_array_equal(first[0], second[0])
        np.testing.assert_array_equal(first[1], second[1])
        self.assertEqual(first[2], second[2])
        np.testing.assert_array_equal(rgba, original)

    def test_near_colors_thin_line_decoration_and_true_hole_survive(self):
        palette = [[8, 8, 8], [182, 44, 48], [204, 59, 61], [254, 249, 200]]
        truth = np.zeros((64, 80), np.int32)
        truth[5:59, 5:75] = 1
        truth[6:58, 6:74] = 2
        truth[6:58, 40:74] = 3
        truth[20:30, 15:25] = 4
        truth[1:3, 15:17] = 4
        truth[12:45, 35] = 1
        truth[35:40, 50:55] = 0
        rgba = np.zeros((*truth.shape, 4), np.uint8)
        for index, rgb in enumerate(palette, 1):
            rgba[truth == index] = [*rgb, 255]
        for reference in (None, palette):
            labels, _, report = run(rgba, reference)
            self.assertEqual(report['actualUsedColorCount'], 4)
            np.testing.assert_array_equal(labels > 0, truth > 0)
            self.assertEqual(_summary(labels)['components'], _summary(truth)['components'])
            self.assertEqual(len(set(int(labels[truth == i][0]) for i in range(1, 5))), 4)

    def test_supported_exterior_transition_is_reowned_without_area_cutoff(self):
        brown, cream = [229, 180, 124], [254, 249, 200]
        rgba = np.zeros((40, 64, 4), np.uint8)
        rgba[5:35, 5:59] = [*brown, 255]
        rgba[16:30, 15:37] = [*cream, 255]
        rgba[5:7, 10:43, :3] = [245, 226, 204]
        old = (rgba[..., 3] > 0).astype(np.int32)
        labels, _, report = run(rgba, [brown, cream], old)
        self.assertTrue(np.all(labels[5:7, 10:43] == labels[10, 10]))
        self.assertGreater(report['reownedPixelCount'], 16)
        np.testing.assert_array_equal(labels > 0, old > 0)

    def test_verbatim_one_pixel_mark_on_edge_is_not_deleted(self):
        brown, cream = [229, 180, 124], [254, 249, 200]
        rgba = np.zeros((32, 40, 4), np.uint8)
        rgba[5:28, 5:35] = [*brown, 255]
        rgba[14:23, 12:28] = [*cream, 255]
        rgba[5, 20, :3] = cream
        labels, _, _ = run(rgba, [brown, cream])
        self.assertEqual(labels[5, 20], labels[18, 20])
        self.assertNotEqual(labels[5, 20], labels[5, 19])

    def test_prior_partition_not_used_as_production_truth(self):
        rgba, truth, palette = control(6)
        flat = np.where(truth > 0, 1, 0).astype(np.int32)
        stripes = np.where(truth > 0, np.indices(truth.shape)[1] // 5 + 1, 0).astype(np.int32)
        np.testing.assert_array_equal(run(rgba, palette, flat)[0], run(rgba, palette, stripes)[0])

    def test_weak_quantizer_island_reowned_but_abrupt_mark_preserved(self):
        palette = [[100, 80, 60], [140, 110, 70]]
        rgba = np.zeros((40, 60, 4), np.uint8)
        rgba[3:37, 3:57] = [100, 80, 60, 255]
        rgba[12:28, 40:53] = [140, 110, 70, 255]
        # A smooth local bump crosses the colour quantizer boundary; there is
        # no matching raw-image step at the resulting one-pixel island.
        rgba[13:16, 13:16, :3] = [116, 92, 64]
        rgba[14, 14, :3] = [123, 97, 66]
        # Same location-independent rule must preserve a real abrupt mark,
        # even with modest observed RGB deviation from its material mode.
        rgba[25, 15, :3] = [145, 115, 75]
        labels, _, report = run(rgba, palette)
        self.assertEqual(labels[14, 14], labels[14, 13])
        self.assertNotEqual(labels[25, 15], labels[25, 14])
        self.assertTrue(any(item['reason'] == 'ADJACENT_SUPPORTED_OWNER_WITH_GRADUAL_RAW_BOUNDARY'
                            for item in report['spatialReownership']))

    def test_each_ablation_is_explicit_reproducible_and_serializable(self):
        rgba, _, _ = control(5)
        for options in ({'palette_merging': False}, {'prior_majority': True},
                        {'exact_color_protection': True}, {}):
            one, two = run(rgba, **options), run(rgba, **options)
            np.testing.assert_array_equal(one[0], two[0])
            self.assertEqual(one[2], two[2])
            json.dumps(one[2], allow_nan=False)
        self.assertFalse(run(rgba)[2]['effectiveParameters']['priorMajority'])

    def test_invalid_geometry_support_or_ablation_rejected(self):
        rgba, truth, _ = control(5)
        truth[20, 20] = 0
        with self.assertRaises(ValueError):
            run(rgba, old=truth)
        with self.assertRaises(ValueError):
            run(rgba, prior_majority='yes')


if __name__ == '__main__':
    unittest.main()
