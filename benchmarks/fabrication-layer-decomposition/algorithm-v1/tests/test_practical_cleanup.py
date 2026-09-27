"""Visible-only exterior hypotheses must not erase supported design details."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from practical_cleanup import cleanup_foreground


def scene():
    rgba = np.zeros((64, 64, 4), np.uint8)
    rgba[12:48, 12:44] = [30, 80, 160, 255]
    rgba[12:48, 42] = [80, 90, 130, 255]
    rgba[12:48, 43] = [150, 100, 100, 255]
    rgba[25, 46] = [151, 101, 99, 255]
    return rgba


class PracticalCleanupTests(unittest.TestCase):
    def test_compact_exterior_transition_fragment_removed_without_body_changes(self):
        rgba = scene()
        original = rgba.copy()
        derived, report = cleanup_foreground(rgba, enabled=True)
        np.testing.assert_array_equal(rgba, original)
        np.testing.assert_array_equal(derived[12:48, 12:44], original[12:48, 12:44])
        np.testing.assert_array_equal(derived[..., :3], original[..., :3])
        self.assertEqual(int(derived[25, 46, 3]), 0)
        self.assertEqual(report["changedAlphaPixelCount"], 1)
        self.assertEqual(report["trustedBodyPixelsChanged"], 0)
        self.assertEqual(report["manualConfirmation"], "NOT_CONFIRMED")

    def test_hidden_rgb_replacement_and_reference_palette_cannot_change_decision(self):
        rgba = scene()
        changed = rgba.copy()
        changed[changed[..., 3] == 0, :3] = [19, 214, 91]
        a, ra = cleanup_foreground(rgba, request={"referencePalette": [[255, 255, 255]]}, enabled=True)
        b, rb = cleanup_foreground(changed, request={"referencePalette": [[0, 0, 0]]}, enabled=True)
        self.assertEqual(ra, rb)
        np.testing.assert_array_equal(a[..., 3], b[..., 3])
        np.testing.assert_array_equal(a[a[..., 3] > 0], b[b[..., 3] > 0])

    def test_nonwhite_nonblack_visible_color_translation_preserves_decision(self):
        rgba = scene()
        changed = rgba.copy()
        changed[changed[..., 3] > 0, :3] += 20
        a, ra = cleanup_foreground(rgba, enabled=True)
        b, rb = cleanup_foreground(changed, enabled=True)
        np.testing.assert_array_equal(a[..., 3], b[..., 3])
        self.assertEqual(ra["changedPixelsXY"], rb["changedPixelsXY"])
        self.assertEqual(rb["effectiveParameters"]["matteHypothesis"], "NONE")

    def test_true_single_pixel_decoration_with_no_boundary_transition_support_preserved(self):
        rgba = scene()
        rgba[25, 46] = [20, 220, 30, 255]
        derived, report = cleanup_foreground(rgba, enabled=True)
        np.testing.assert_array_equal(derived, rgba)
        self.assertEqual(report["removedIslandCount"], 0)

    def test_same_color_independent_motif_is_supported_by_trusted_interior(self):
        rgba = scene()
        rgba[25, 46] = [30, 80, 160, 255]
        derived, report = cleanup_foreground(rgba, enabled=True)
        np.testing.assert_array_equal(derived, rgba)
        self.assertIn("SUPPORTED_INTERIOR_COLOR_OR_UNKNOWN_PROTECTED", report["records"][-1]["reasons"])

    def test_real_two_by_two_decoration_and_thin_line_are_not_area_filtered(self):
        rgba = scene()
        rgba[25:27, 46:48] = [151, 101, 99, 255]
        rgba[33:41, 46] = [151, 101, 99, 255]
        derived, report = cleanup_foreground(rgba, enabled=True)
        np.testing.assert_array_equal(derived, rgba)
        self.assertEqual(report["changedAlphaPixelCount"], 0)
        reasons = {reason for row in report["records"] for reason in row["reasons"]}
        self.assertIn("SOLID_TWO_BY_TWO_DECORATION_PROTECTED", reasons)
        self.assertIn("EXTENDED_OR_COHERENT_DETAIL_PROTECTED", reasons)

    def test_true_transparent_hole_and_its_island_decoration_preserved(self):
        rgba = scene()
        rgba[25, 46] = 0
        rgba[22:34, 22:34] = 0
        rgba[25, 25] = [151, 101, 99, 255]
        derived, report = cleanup_foreground(rgba, enabled=True)
        np.testing.assert_array_equal(derived, rgba)
        self.assertEqual(report["changedAlphaPixelCount"], 0)
        self.assertIn("ENCLOSED_HOLE_OR_INTERIOR_DECORATION_PROTECTED", report["records"][-1]["reasons"])

    def test_far_detached_motif_or_no_trusted_body_preserved(self):
        rgba = scene()
        rgba[25, 46] = 0
        rgba[25, 59] = [151, 101, 99, 255]
        derived, _ = cleanup_foreground(rgba, enabled=True)
        np.testing.assert_array_equal(derived, rgba)
        thin = np.zeros((20, 20, 4), np.uint8)
        thin[4:16, 5] = [151, 101, 99, 255]
        thin[10, 8] = [151, 101, 99, 255]
        derived, report = cleanup_foreground(thin, enabled=True)
        np.testing.assert_array_equal(derived, thin)
        self.assertEqual(report["trustedBodyPixelCount"], 0)

    def test_disabled_only_proposes_and_partial_alpha_is_reported(self):
        rgba = scene()
        rgba[25, 46, 3] = 60
        derived, report = cleanup_foreground(rgba, enabled=False)
        np.testing.assert_array_equal(derived, rgba)
        row = report["records"][-1]
        self.assertEqual(row["proposal"], "REMOVE_UNCONFIRMED")
        self.assertEqual(row["alphaRange"], [60, 60])
        enabled, enabled_report = cleanup_foreground(rgba, enabled=True)
        self.assertEqual(int(enabled[25, 46, 3]), 0)
        self.assertEqual(enabled_report["changedAlphaPixelCount"], 1)

    def test_invalid_input_or_nonboolean_enable_rejected(self):
        with self.assertRaises(ValueError):
            cleanup_foreground(scene().astype(float), enabled=True)
        with self.assertRaises(ValueError):
            cleanup_foreground(scene(), enabled="yes")


if __name__ == "__main__":
    unittest.main()
