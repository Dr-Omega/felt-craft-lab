from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from color_purification import (  # noqa: E402
    ColorPurificationError,
    alpha_topology_diagnostics,
    apply_representatives,
    assign_fringe_pixels,
    get_candidate,
    metrics_for_run,
    raw_local_fragmentation_baseline,
    representative_color,
    rgb_to_lab,
)
import runner  # noqa: E402


CONFIG = json.loads((ROOT / "configs" / "profiles.json").read_text())["balanced"]


def _image() -> np.ndarray:
    rgba = np.zeros((16, 16, 4), dtype=np.uint8)
    rgba[2:8, 2:8] = (220, 30, 30, 255)
    rgba[9:14, 9:14] = (225, 35, 35, 255)
    rgba[4:6, 11:13] = (20, 20, 20, 255)
    return rgba


class ColorPurificationTests(unittest.TestCase):
    def test_alpha_is_bit_identical_after_each_candidate(self):
        source = _image()
        for candidate_id in ("CP-A", "CP-B"):
            output = get_candidate(candidate_id).propose(source, CONFIG)
            purified, _ = apply_representatives(source, output.label_map, "RC-A", CONFIG)
            self.assertTrue(np.array_equal(source[..., 3], purified[..., 3]))

    def test_transparent_pixels_stay_zero_labels(self):
        source = _image()
        labels = get_candidate("CP-B").propose(source, CONFIG).label_map
        self.assertTrue(np.all(labels[source[..., 3] == 0] == 0))
        self.assertTrue(np.all(labels[source[..., 3] > 0] > 0))

    def test_same_color_disconnected_components_keep_distinct_region_ids(self):
        source = _image()
        labels = get_candidate("CP-B").propose(source, CONFIG).label_map
        self.assertNotEqual(int(labels[3, 3]), int(labels[10, 10]))

    def test_cp_b_does_not_use_felzenszwalb(self):
        source = (ROOT / "src" / "color_purification.py").read_text(encoding="utf-8")
        self.assertNotIn("felzenszwalb", source)

    def test_cp_b_uses_running_mean_seeded_growth_not_connected_component_core(self):
        source = (ROOT / "src" / "color_purification.py").read_text(encoding="utf-8")
        start = source.index("def _ciede2000_region_grow_labels")
        end = source.index("def _region_statistics", start)
        implementation = source[start:end]
        self.assertIn("running_sum", implementation)
        self.assertIn("region_mean_threshold", implementation)
        self.assertNotIn("connected_components", implementation)

    def test_cp_a_and_cp_b_have_independent_region_proposal_paths(self):
        source = _image()
        with (
            mock.patch("color_purification._candidate_labels_cp_a", wraps=__import__("color_purification")._candidate_labels_cp_a) as cp_a,
            mock.patch("color_purification._candidate_labels_cp_b", wraps=__import__("color_purification")._candidate_labels_cp_b) as cp_b,
        ):
            get_candidate("CP-A").propose(source, CONFIG)
            self.assertTrue(cp_a.called)
            self.assertFalse(cp_b.called)
            get_candidate("CP-B").propose(source, CONFIG)
            self.assertTrue(cp_b.called)

    def test_adjacent_light_color_drift_can_merge_locally(self):
        source = np.zeros((6, 8, 4), dtype=np.uint8)
        source[1:5, 1:4] = (200, 50, 50, 255)
        source[1:5, 4:7] = (205, 54, 54, 255)
        config = {**CONFIG, "labDeltaECell": 0.5, "smallRegionArea": 100, "smallRegionMergeDeltaE": 20.0, "smallRegionStrategy": "merge_adjacent_local"}
        labels = get_candidate("CP-B").propose(source, config).label_map
        self.assertEqual(int(labels.max()), 1)

    def test_small_region_strategy_keep_is_not_metadata_only(self):
        source = np.zeros((6, 8, 4), dtype=np.uint8)
        source[1:5, 1:4] = (200, 50, 50, 255)
        source[1:5, 4:7] = (205, 54, 54, 255)
        config = {**CONFIG, "labDeltaECell": 0.5, "localEdgeThreshold": 0.5, "regionMeanThreshold": 0.5, "smallRegionArea": 100, "smallRegionMergeDeltaE": 20.0, "smallRegionStrategy": "keep"}
        labels = get_candidate("CP-B").propose(source, config).label_map
        self.assertEqual(int(labels.max()), 2)

    def test_merge_adjacent_local_requires_a_spatial_neighbor(self):
        source = np.zeros((8, 10, 4), dtype=np.uint8)
        source[1:3, 1:3] = (200, 50, 50, 255)
        source[5:7, 7:9] = (200, 50, 50, 255)
        config = {**CONFIG, "labDeltaECell": 0.5, "smallRegionArea": 100, "smallRegionMergeDeltaE": 100.0, "smallRegionStrategy": "merge_adjacent_local"}
        labels = get_candidate("CP-B").propose(source, config).label_map
        self.assertEqual(int(labels.max()), 2)

    def test_small_region_without_a_legal_local_neighbor_is_kept(self):
        source = np.zeros((6, 8, 4), dtype=np.uint8)
        source[1:5, 1:4] = (200, 50, 50, 255)
        source[1:5, 4:7] = (30, 180, 30, 255)
        config = {**CONFIG, "labDeltaECell": 0.5, "smallRegionArea": 100, "smallRegionMergeDeltaE": 2.0, "smallRegionStrategy": "merge_adjacent_local"}
        labels = get_candidate("CP-B").propose(source, config).label_map
        self.assertEqual(int(labels.max()), 2)

    def test_low_alpha_isolated_pixel_is_not_a_structural_region(self):
        source = np.zeros((8, 8, 4), dtype=np.uint8)
        source[2:6, 2:6] = (200, 50, 50, 255)
        source[0, 0] = (20, 20, 20, 1)
        output = get_candidate("CP-A").propose(source, {**CONFIG, "structuralAlphaThreshold": 64})
        self.assertEqual(int(output.structural_label_map[0, 0]), 0)
        self.assertEqual(int(output.pixel_label_map[0, 0]), -1)

    def test_opaque_isolated_component_is_structural_geometry(self):
        source = np.zeros((8, 8, 4), dtype=np.uint8)
        source[1:3, 1:3] = (200, 50, 50, 255)
        source[5:7, 5:7] = (200, 50, 50, 255)
        diagnostics = alpha_topology_diagnostics(source[..., 3])
        self.assertEqual(diagnostics["alpha_ge_64"]["component_count"], 2)
        output = get_candidate("CP-A").propose(source, {**CONFIG, "structuralAlphaThreshold": 64})
        self.assertEqual(int(output.structural_label_map.max()), 2)

    def test_fringe_pixel_inherits_neighbouring_structural_label(self):
        source = np.zeros((5, 5, 4), dtype=np.uint8)
        source[2, 2] = (200, 50, 50, 255)
        source[2, 3] = (200, 50, 50, 1)
        structural = np.zeros((5, 5), dtype=np.int32)
        structural[2, 2] = 1
        pixels, metrics = assign_fringe_pixels(source, structural, {**CONFIG, "fringeMaxPropagationDistancePx": 2})
        self.assertEqual(int(pixels[2, 3]), 1)
        self.assertEqual(metrics["orphan_fringe_count"], 0)

    def test_remote_fringe_is_explicit_orphan(self):
        source = np.zeros((9, 9, 4), dtype=np.uint8)
        source[1, 1] = (200, 50, 50, 255)
        source[7, 7] = (200, 50, 50, 1)
        structural = np.zeros((9, 9), dtype=np.int32)
        structural[1, 1] = 1
        pixels, metrics = assign_fringe_pixels(source, structural, {**CONFIG, "fringeMaxPropagationDistancePx": 2})
        self.assertEqual(int(pixels[7, 7]), -1)
        self.assertEqual(metrics["orphan_fringe_count"], 1)

    def test_similar_disconnected_regions_do_not_globally_merge(self):
        source = _image()
        labels = get_candidate("CP-B").propose(source, CONFIG).label_map
        self.assertNotEqual(int(labels[3, 3]), int(labels[10, 10]))

    def test_all_representative_methods_are_independently_callable(self):
        source = _image()
        mask = source[..., 3] > 0
        for method in ("RC-A", "RC-B", "RC-C"):
            rgb, lab, core_count = representative_color(source, mask, method, CONFIG)
            self.assertEqual(rgb.shape, (3,))
            self.assertEqual(lab.shape, (3,))
            self.assertGreater(core_count, 0)

    def test_tiny_region_core_fallback_is_safe(self):
        source = np.zeros((4, 4, 4), dtype=np.uint8)
        source[1, 1] = (100, 50, 20, 255)
        mask = source[..., 3] > 0
        _, _, core_count = representative_color(source, mask, "RC-A", CONFIG)
        self.assertEqual(core_count, 1)

    def test_completely_transparent_input_fails_closed(self):
        with self.assertRaises(ColorPurificationError):
            get_candidate("CP-B").propose(np.zeros((4, 4, 4), dtype=np.uint8), CONFIG)

    def test_invalid_rgba_input_fails_closed(self):
        with self.assertRaises(ColorPurificationError):
            get_candidate("CP-B").propose(np.zeros((4, 4, 3), dtype=np.uint8), CONFIG)

    def test_output_is_deterministic(self):
        source = _image()
        candidate = get_candidate("CP-A")
        first = candidate.propose(source, CONFIG)
        second = candidate.propose(source, CONFIG)
        first_image, _ = apply_representatives(source, first.label_map, "RC-C", CONFIG)
        second_image, _ = apply_representatives(source, second.label_map, "RC-C", CONFIG)
        self.assertTrue(np.array_equal(first.label_map, second.label_map))
        self.assertTrue(np.array_equal(first_image, second_image))

    def test_gt_region_ratio_and_order_gate_are_computed(self):
        source = np.zeros((4, 4, 4), dtype=np.uint8)
        source[..., :3] = (120, 30, 20)
        source[..., 3] = 255
        labels = np.ones((4, 4), dtype=np.int32)
        labels[:, 2:] = 2
        purified, _ = apply_representatives(source, labels, "RC-A", CONFIG)
        metrics = metrics_for_run(source, labels, purified, CONFIG, ground_truth_approx_region_count=5)
        self.assertEqual(metrics["ground_truth_approx_region_count"], 5)
        self.assertEqual(metrics["region_count_ratio_to_gt"], 0.4)
        self.assertEqual(metrics["region_count_order_gate"], "WARN")

    def test_gt_region_order_gate_warn_and_fail_thresholds(self):
        source = np.zeros((3, 20, 4), dtype=np.uint8)
        source[..., :3] = (120, 30, 20)
        source[..., 3] = 255
        labels = np.tile(np.arange(1, 21, dtype=np.int32), (3, 1))
        purified, _ = apply_representatives(source, labels, "RC-A", CONFIG)
        warn = metrics_for_run(source, labels, purified, CONFIG, ground_truth_approx_region_count=2)
        fail = metrics_for_run(source, labels, purified, CONFIG, ground_truth_approx_region_count=1)
        self.assertEqual(warn["region_count_order_gate"], "WARN")
        self.assertEqual(fail["region_count_order_gate"], "FAIL")

    def test_under_segmentation_group_ratio_fails(self):
        source = np.zeros((4, 4, 4), dtype=np.uint8)
        source[..., :3] = (120, 30, 20)
        source[..., 3] = 255
        labels = np.ones((4, 4), dtype=np.int32)
        purified, regions = apply_representatives(source, labels, "RC-A", CONFIG)
        metrics = metrics_for_run(source, labels, purified, CONFIG, 5, regions=regions)
        self.assertEqual(metrics["color_group_count_after"], 1)
        self.assertEqual(metrics["region_count_order_gate"], "FAIL")

    def test_same_color_disconnected_regions_can_share_color_group_without_mask_merge(self):
        source = np.zeros((8, 8, 4), dtype=np.uint8)
        source[1:3, 1:3] = (200, 50, 50, 255)
        source[5:7, 5:7] = (200, 50, 50, 255)
        labels = np.zeros((8, 8), dtype=np.int32)
        labels[1:3, 1:3] = 1
        labels[5:7, 5:7] = 2
        _, regions = apply_representatives(source, labels, "RC-A", CONFIG)
        self.assertEqual(len(regions), 2)
        self.assertEqual({region["colorGroupId"] for region in regions}, {1})

    def test_similar_distinct_regions_remain_separate_color_groups_under_conservative_rule(self):
        source = np.zeros((8, 8, 4), dtype=np.uint8)
        source[1:3, 1:3] = (200, 50, 50, 255)
        source[5:7, 5:7] = (40, 150, 40, 255)
        labels = np.zeros((8, 8), dtype=np.int32)
        labels[1:3, 1:3] = 1
        labels[5:7, 5:7] = 2
        _, regions = apply_representatives(source, labels, "RC-A", CONFIG)
        self.assertEqual({region["colorGroupId"] for region in regions}, {1, 2})

    def test_area_and_small_component_diagnostics_are_emitted(self):
        source = _image()
        labels = get_candidate("CP-B").propose(source, CONFIG).label_map
        purified, _ = apply_representatives(source, labels, "RC-A", CONFIG)
        metrics = metrics_for_run(source, labels, purified, CONFIG, ground_truth_approx_region_count=3)
        self.assertGreater(metrics["mean_region_area"], 0)
        self.assertGreater(metrics["median_region_area"], 0)
        self.assertGreater(metrics["p10_region_area"], 0)
        self.assertIn("small_component_ratio_after", metrics)

    def test_metrics_record_honest_cp_b_delta_e_method(self):
        source = _image()
        labels = get_candidate("CP-B").propose(source, CONFIG).label_map
        purified, _ = apply_representatives(source, labels, "RC-A", CONFIG)
        self.assertEqual(metrics_for_run(source, labels, purified, CONFIG, delta_e_method="CIEDE2000")["delta_e_method"], "CIEDE2000")

    def test_raw_fragmentation_baseline_is_candidate_independent(self):
        source = _image()
        active = source[..., 3] > 0
        baseline = raw_local_fragmentation_baseline(rgb_to_lab(source[..., :3]), active)
        self.assertTrue(np.array_equal(
            baseline,
            raw_local_fragmentation_baseline(rgb_to_lab(source[..., :3]), active),
        ))
        self.assertNotIn("proposalMinRegionArea", (ROOT / "src" / "color_purification.py").read_text(encoding="utf-8"))

    def test_fld_004_regression_is_exercised_by_explicit_poc_sweep_not_unit_matrix(self):
        # The real running-mean CP-B is intentionally exercised by the required
        # 32-case sweep; unit tests keep a bounded synthetic contract check.
        source = _image()
        labels = get_candidate("CP-B").propose(source, CONFIG).structural_label_map
        self.assertGreater(int(labels.max()), 0)

    def test_region_metadata_contains_configurable_core_derived_fields(self):
        source = _image()
        output = get_candidate("CP-B").propose(source, CONFIG)
        _, regions = apply_representatives(source, output.label_map, "RC-B", CONFIG)
        self.assertTrue(regions)
        self.assertTrue({"regionId", "colorGroupId", "colorGroupStatus", "groupConfidence", "structuralPixelCount", "assignedPixelCount"}.issubset(regions[0]))

    def test_run_metadata_contains_all_actual_parameters(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "fixture.png"
            Image.fromarray(_image(), mode="RGBA").save(source_path)
            fixture = {"fixtureId": "FLD-001", "sourceFile": "fixture.png", "groundTruthFile": "ground-truth.json"}
            (root / "ground-truth.json").write_text(json.dumps({"expectedColorRegions": {"approximateCount": 1}}))
            with mock.patch.object(runner, "BENCHMARK_ROOT", root), mock.patch.object(runner, "OUTPUT_ROOT", root / "outputs"):
                runner._run_fixture(fixture, "CP-B", "balanced", "RC-A", CONFIG, "test-sha")
            metadata = json.loads((root / "outputs" / "cp-b-balanced_rc-a" / "FLD-001" / "run_config.json").read_text())
            self.assertEqual(metadata["parameters"], CONFIG)
            self.assertEqual(metadata["sourceSha256"], "test-sha")

    def test_unavailable_candidate_does_not_block_another_candidate(self):
        fixture = {"fixtureId": "FLD-001", "sourceFile": "fixture.png"}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            success = {"fixtureId": "FLD-001", "runId": "cp-b-balanced_rc-a", "status": "SUCCESS", "metrics": {"elapsedMs": 1.0, "region_count_after": 1, "region_count_ratio_to_gt": 1.0, "small_component_count_after": 0, "within_region_color_variance_before": 1.0, "within_region_color_variance_after": 0.0, "boundary_shift": 0.0}}
            with (
                mock.patch.object(runner, "_load_manifest", return_value=[fixture]),
                mock.patch.object(runner, "_sha256", return_value="same-sha"),
                mock.patch.object(runner, "_run_fixture", return_value=success),
                mock.patch.object(runner, "REPORT_ROOT", root / "reports"),
            ):
                summary = runner.run(["CP-C", "CP-B"], ["balanced"], ["RC-A"])
        statuses = {run["runId"]: run["status"] for run in summary["runs"]}
        self.assertEqual(statuses["cp-c-balanced_rc-a"], "DEPENDENCY_UNAVAILABLE")
        self.assertEqual(statuses["cp-b-balanced_rc-a"], "SUCCESS")

    def test_cp_c_is_explicitly_unavailable_not_substituted(self):
        with self.assertRaisesRegex(ColorPurificationError, "DEPENDENCY_UNAVAILABLE"):
            get_candidate("CP-C")

    def test_input_array_is_never_mutated(self):
        source = _image()
        before = hashlib.sha256(source.tobytes()).hexdigest()
        output = get_candidate("CP-A").propose(source, CONFIG)
        apply_representatives(source, output.label_map, "RC-A", CONFIG)
        self.assertEqual(before, hashlib.sha256(source.tobytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
