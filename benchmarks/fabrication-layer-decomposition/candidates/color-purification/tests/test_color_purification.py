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
    apply_representatives,
    get_candidate,
    representative_color,
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

    def test_region_metadata_contains_configurable_core_derived_fields(self):
        source = _image()
        output = get_candidate("CP-B").propose(source, CONFIG)
        _, regions = apply_representatives(source, output.label_map, "RC-B", CONFIG)
        self.assertTrue(regions)
        self.assertEqual(set(regions[0]), {"regionId", "pixelCount", "bbox", "representativeColorRgb", "representativeColorLab", "sourceColorVariance", "outputColorVariance", "componentCount", "corePixelCount"})

    def test_run_metadata_contains_all_actual_parameters(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "fixture.png"
            Image.fromarray(_image(), mode="RGBA").save(source_path)
            fixture = {"fixtureId": "FLD-001", "sourceFile": "fixture.png"}
            with mock.patch.object(runner, "BENCHMARK_ROOT", root), mock.patch.object(runner, "OUTPUT_ROOT", root / "outputs"):
                runner._run_fixture(fixture, "CP-B", "balanced", "RC-A", CONFIG, "test-sha")
            metadata = json.loads((root / "outputs" / "cp-b-balanced_rc-a" / "FLD-001" / "run_config.json").read_text())
            self.assertEqual(metadata["parameters"], CONFIG)
            self.assertEqual(metadata["sourceSha256"], "test-sha")

    def test_unavailable_candidate_does_not_block_another_candidate(self):
        fixture = {"fixtureId": "FLD-001", "sourceFile": "fixture.png"}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            success = {"fixtureId": "FLD-001", "runId": "cp-b-balanced_rc-a", "status": "SUCCESS", "metrics": {"elapsedMs": 1.0, "region_count_after": 1, "within_region_color_variance_before": 1.0, "within_region_color_variance_after": 0.0, "boundary_shift": 0.0}}
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
