"""Cross-image properties, without material names, coordinates or answers in code."""
import copy
from pathlib import Path
import sys
import unittest

import numpy as np
from shapely.geometry import Polygon, box

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),
               str(Path(__file__).resolve().parents[2] / 'tools')]
from m4_checks import render_polygons
from design_color_regions import cleanup_foreground, estimate_palette, validate_request
from design_color_controls import control
from test_design_color_regions import CONFIG, rebuild


class SharedBoundaryPreviewTests(unittest.TestCase):
    def test_pixel_centers_on_shared_diagonal_have_no_false_transparent_seam(self):
        objects = [dict(id='a', polygon=Polygon([(0, 0), (20, 0), (20, 20)]), rgb=[40, 80, 120]),
                   dict(id='b', polygon=Polygon([(0, 0), (20, 20), (0, 20)]), rgb=[40, 80, 120])]
        before = copy.deepcopy(objects)
        for numbered in (False, True):
            for order in (objects, objects[::-1]):
                image = render_polygons(order, (20, 20), numbered=numbered)
                self.assertTrue(np.all(image[..., 3] == 255))
        self.assertEqual(objects, before)

    def test_real_hole_remains_empty_while_shared_boundary_is_closed(self):
        polygon = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)],
                          [[(7, 7), (7, 13), (13, 13), (13, 7)]])
        image = render_polygons([dict(id='a', polygon=polygon, rgb=[90, 50, 20])], (20, 20))
        self.assertTrue(np.all(image[7:13, 7:13, 3] == 0))
        self.assertTrue(np.all(image[:7, :, 3] == 255))

    def test_different_colors_use_declared_paint_order_only_on_shared_boundary(self):
        objects = [dict(id='a', polygon=box(0, 0, 5.5, 10), rgb=[200, 20, 20]),
                   dict(id='b', polygon=box(5.5, 0, 10, 10), rgb=[20, 20, 200])]
        image = render_polygons(objects, (10, 10))
        self.assertTrue(np.all(image[..., 3] == 255))
        np.testing.assert_array_equal(image[:, 5, :3], np.tile([20, 20, 200], (10, 1)))
        np.testing.assert_array_equal(image[:, 4, :3], np.tile([200, 20, 20], (10, 1)))


class InvisibleRgbTests(unittest.TestCase):
    def test_invisible_rgb_is_not_foreground_cleanup_evidence(self):
        rgba, _, _ = control(6)
        rgba[10, 70] = [220, 220, 220, 255]
        results = []
        for value in (0, 255, None):
            source = rgba.copy()
            hidden = source[..., 3] == 0
            source[hidden, :3] = value if value is not None else np.random.default_rng(73).integers(0, 256, (hidden.sum(), 3), dtype=np.uint8)
            before = source.copy()
            output, report = cleanup_foreground(source, CONFIG, validate_request(), enabled=True)
            results.append((output[..., 3], report['records']))
            np.testing.assert_array_equal(source, before)
        for actual in results[1:]:
            np.testing.assert_array_equal(actual[0], results[0][0])
            self.assertEqual(actual[1], results[0][1])

    def test_thin_detail_palette_and_reconstruction_ignore_invisible_rgb(self):
        rgba = np.full((24, 32, 4), [255, 255, 255, 0], np.uint8)
        rgba[10, 4:28] = [30, 100, 160, 255]
        rgba[13, 4:28] = [180, 45, 30, 255]
        palette, labels = [], []
        for value in (0, 255):
            source = rgba.copy(); source[source[..., 3] == 0, :3] = value
            palette.append(estimate_palette(source, CONFIG, validate_request()))
            labels.append(rebuild(source)[0])
        self.assertEqual(palette[0], palette[1])
        np.testing.assert_array_equal(labels[0], labels[1])
        self.assertEqual(len(np.unique(labels[0][labels[0] > 0])), 2)


if __name__ == '__main__':
    unittest.main()
