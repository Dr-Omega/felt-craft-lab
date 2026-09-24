"""Selection-B ownership and opt-in foreground hypotheses preserve hard domains."""
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "candidates" / "color-purification" / "src"))
from color_purification import assign_fringe_pixels, apply_representatives
from quality_fragments import refine_selection, propose_foreground_cleanup


CONFIG = json.loads((Path(__file__).resolve().parents[2] / "candidates" / "color-purification" / "configs" / "profiles.json").read_text())["balanced"]


def fixture():
    rgba = np.full((26, 26, 4), 255, np.uint8)
    rgba[..., 3] = 0
    rgba[4:22, 4:22] = [20, 20, 20, 255]
    labels = np.zeros((26, 26), np.int32)
    labels[4:22, 4:22] = 1
    return rgba, labels


def run(rgba, labels, **kwargs):
    pixels, _ = assign_fringe_pixels(rgba, labels, CONFIG)
    return refine_selection(rgba, labels, pixels, CONFIG, **kwargs)


class QualityFragmentsTests(unittest.TestCase):
    def test_actual_exterior_transition_reassignment_without_source_or_alpha_change(self):
        rgba, labels = fixture()
        rgba[10, 4, :3] = 200
        labels[10, 4] = 2
        original, oldlabels = rgba.copy(), labels.copy()
        new, pixels, report = run(rgba, labels)
        self.assertEqual(new[10, 4], 1)
        self.assertEqual(report["changedComponentCount"], 1)
        self.assertEqual(report["changedPixelsXY"], [[4, 10]])
        self.assertEqual(report["before"]["components"], 2)
        self.assertEqual(report["after"]["components"], 1)
        np.testing.assert_array_equal(original, rgba)
        np.testing.assert_array_equal(oldlabels, labels)
        np.testing.assert_array_equal(new > 0, labels > 0)
        purified, metadata = apply_representatives(rgba, new, "RC-A", CONFIG, pixels)
        np.testing.assert_array_equal(purified[..., 3], rgba[..., 3])
        self.assertEqual({x["regionId"] for x in metadata}, {1})

    def test_disabled_path_is_exact_and_reports_are_deterministic(self):
        rgba, labels = fixture(); rgba[10, 4, :3] = 200; labels[10, 4] = 2
        new, pixels, disabled = run(rgba, labels, enabled=False)
        np.testing.assert_array_equal(new, labels)
        self.assertEqual(disabled["changedComponentCount"], 0)
        self.assertEqual(run(rgba, labels)[2], run(rgba, labels)[2])
        json.dumps(run(rgba, labels)[2], allow_nan=False)

    def test_intentional_enclosed_decorations_and_different_color_interiors_stay(self):
        rgba, labels = fixture()
        rgba[12, 12, :3] = [200, 200, 200]; labels[12, 12] = 2
        rgba[16:18, 16:18, :3] = [255, 0, 0]; labels[16:18, 16:18] = 3
        np.testing.assert_array_equal(run(rgba, labels)[0], labels)

    def test_colored_high_contrast_edge_detail_is_not_neutral_transition(self):
        rgba, labels = fixture()
        rgba[10, 4, :3] = [255, 20, 20]; labels[10, 4] = 2
        np.testing.assert_array_equal(run(rgba, labels)[0], labels)

    def test_thin_black_stroke_is_preserved(self):
        rgba, labels = fixture(); rgba[labels == 1, :3] = 180
        labels[8:17, 10] = 2; rgba[8:17, 10, :3] = 5
        new, _, report = run(rgba, labels)
        np.testing.assert_array_equal(new, labels)
        self.assertIn("DARK_DETAIL_PROTECTED", report["componentMappings"][1]["reasons"])

    def test_unsupported_tip_remains_and_silhouette_never_changes(self):
        rgba, labels = fixture()
        labels[1:4, 12] = 1; rgba[1:4, 12] = [20, 20, 20, 255]
        labels[1, 12] = 2; rgba[1, 12, :3] = 200
        np.testing.assert_array_equal(run(rgba, labels)[0], labels)

    def test_true_alpha_hole_boundary_is_protected(self):
        rgba, labels = fixture()
        rgba[11:14, 11:14, 3] = 0; labels[11:14, 11:14] = 0
        rgba[12, 10, :3] = 200; labels[12, 10] = 2
        new, _, report = run(rgba, labels)
        np.testing.assert_array_equal(new, labels)
        self.assertIn("TRUE_ALPHA_HOLE_BOUNDARY_PROTECTED", report["componentMappings"][1]["reasons"])

    def test_disconnected_target_cannot_be_joined_through_a_fragment(self):
        rgba = np.full((4, 40, 4), [180, 180, 180, 255], np.uint8)
        labels = np.ones((4, 40), np.int32); labels[:, 20] = 2
        new, _, report = run(rgba, labels)
        np.testing.assert_array_equal(new, labels)
        self.assertIn("WOULD_JOIN_DISCONNECTED_TARGET_COMPONENTS", report["componentMappings"][-1]["reasons"])

    def test_diagonal_contact_is_not_an_adjacency_merge(self):
        rgba, labels = fixture()
        rgba[3, 3] = [200, 200, 200, 255]; labels[3, 3] = 2
        new, _, report = run(rgba, labels)
        np.testing.assert_array_equal(new, labels)
        self.assertEqual(report["componentMappings"][-1]["classification"], "INPUT_ISLAND")

    def test_weak_interior_junction_merges_but_single_neighbour_dot_does_not(self):
        rgba = np.full((20, 20, 4), [160, 160, 160, 255], np.uint8)
        labels = np.ones((20, 20), np.int32); labels[:, 11:] = 3
        rgba[:, 11:, :3] = 166
        labels[9, 10] = 2; rgba[9, 10, :3] = 163
        new, _, report = run(rgba, labels)
        self.assertEqual(new[9, 10], 1)
        self.assertEqual(report["changedComponentCount"], 1)
        labels[9, 5] = 4; rgba[9, 5, :3] = 163
        self.assertEqual(run(rgba, labels)[0][9, 5], 4)

    def test_fringe_is_recomputed_and_stale_pixel_labels_rejected(self):
        rgba, labels = fixture()
        rgba[10, 4, :3] = 200; labels[10, 4] = 2
        rgba[10, 3] = [200, 200, 200, 100]  # Structural at threshold 64.
        labels[10, 3] = 2
        rgba[10, 2] = [200, 200, 200, 12]
        new, pixels, _ = run(rgba, labels)
        expected, _ = assign_fringe_pixels(rgba, new, CONFIG)
        np.testing.assert_array_equal(pixels, expected)
        wrong = expected.copy(); wrong[10, 2] = -1
        with self.assertRaisesRegex(ValueError, "fringe"):
            refine_selection(rgba, labels, wrong, CONFIG)

    def test_cleanup_is_independent_explicit_unconfirmed_and_not_area_only(self):
        rgba = np.full((40, 40, 4), [255, 255, 255, 0], np.uint8)
        rgba[10:30, 10:30] = [20, 20, 20, 255]
        rgba[8, 15] = [220, 220, 220, 255]
        rgba[8, 20] = [255, 0, 0, 255]
        rgba[8, 25] = [0, 0, 0, 255]
        rgba[1, 1] = [220, 220, 220, 255]
        rgba[32, 12:17] = [220, 220, 220, 255]
        original = rgba.copy()
        off, offreport = propose_foreground_cleanup(rgba)
        np.testing.assert_array_equal(off, original)
        self.assertEqual(offreport["changedAlphaPixelCount"], 0)
        derived, report = propose_foreground_cleanup(rgba, enabled=True)
        self.assertEqual(report["changedPixelsXY"], [[15, 8]])
        self.assertEqual(report["manualConfirmation"], "NOT_CONFIRMED")
        self.assertEqual(derived[8, 15, 3], 0)
        np.testing.assert_array_equal(rgba, original)
        np.testing.assert_array_equal(derived[..., :3], original[..., :3])
        self.assertEqual(report, propose_foreground_cleanup(rgba, enabled=True)[1])

    def test_cleanup_preserves_tiny_ring_hole(self):
        rgba = np.full((30, 30, 4), [255, 255, 255, 0], np.uint8)
        rgba[10:28, 5:25] = [0, 0, 0, 255]
        rgba[5:8, 10:13] = [220, 220, 220, 255]; rgba[6, 11, 3] = 0
        np.testing.assert_array_equal(propose_foreground_cleanup(rgba, enabled=True)[0], rgba)

    def test_invalid_input_coverage_and_dtype_rejected(self):
        rgba, labels = fixture()
        pixels, _ = assign_fringe_pixels(rgba, labels, CONFIG)
        wrong = labels.copy(); wrong[10, 10] = 0
        with self.assertRaisesRegex(ValueError, "coverage"):
            refine_selection(rgba, wrong, pixels, CONFIG)
        with self.assertRaisesRegex(ValueError, "int32"):
            refine_selection(rgba, labels.astype(np.int64), pixels, CONFIG)


if __name__ == "__main__":
    unittest.main()
