from __future__ import annotations

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import benchmark_lib  # noqa: E402
from benchmark_lib import BENCHMARK_ROOT, RembgAdapter, calculate_metrics, load_config, model_artifact_record, performance_record  # noqa: E402


class BenchmarkMetricTests(unittest.TestCase):
    def test_root_and_common_alpha_threshold_are_centralized(self) -> None:
        self.assertEqual(BENCHMARK_ROOT, ROOT)
        self.assertEqual(load_config()["alphaThreshold"], 128)

    def test_perfect_alpha_mask_has_perfect_binary_metrics(self) -> None:
        gt = Image.new("L", (10, 10), 0)
        ImageDraw.Draw(gt).rectangle((2, 2, 7, 7), fill=255)
        output = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
        output.putalpha(gt)

        metrics = calculate_metrics(output, gt, load_config())

        self.assertEqual(metrics["subjectRetention"], 1.0)
        self.assertEqual(metrics["backgroundClearRate"], 1.0)
        self.assertEqual(metrics["internalHoleRate"], 0.0)
        self.assertEqual(metrics["foregroundIoU"], 1.0)

    def test_internal_hole_is_counted_inside_eroded_foreground(self) -> None:
        gt = Image.new("L", (20, 20), 0)
        ImageDraw.Draw(gt).rectangle((3, 3, 16, 16), fill=255)
        alpha = gt.copy()
        ImageDraw.Draw(alpha).ellipse((8, 8, 11, 11), fill=0)
        output = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
        output.putalpha(alpha)

        metrics = calculate_metrics(output, gt, load_config())

        self.assertGreater(metrics["internalHoleRate"], 0.0)
        self.assertLess(metrics["subjectRetention"], 1.0)

    def test_performance_fields_separate_initialization_from_first_inference(self) -> None:
        output = Image.new("RGBA", (4, 5))
        record = performance_record(12.5, 34.5, [8.0, 10.0, 12.0, 14.0, 16.0], model_size_bytes=99, output=output)

        self.assertEqual(record["initializeMs"], 12.5)
        self.assertEqual(record["firstInferenceMs"], 34.5)
        self.assertNotIn("processPeakRssMb", record)
        self.assertNotIn("coldStartMs", record)
        self.assertNotIn("peakRssMb", record)
        self.assertEqual(record["warmRuns"], 5)

    def test_actual_artifact_sha_matching_manifest_is_verified(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            cache_root = Path(temporary)
            model_file = cache_root / "fixture.onnx"
            model_file.write_bytes(b"benchmark-model")
            expected = hashlib.sha256(b"benchmark-model").hexdigest()
            previous_root = benchmark_lib.MODEL_CACHE_ROOT
            benchmark_lib.MODEL_CACHE_ROOT = cache_root
            try:
                metadata = {"cacheFile": "fixture.onnx", "modelSha256": expected, "exactModelRevision": "rev-1", "weightLicenseVerificationStatus": "VERIFIED"}
                record = model_artifact_record("isnet-anime", metadata)
            finally:
                benchmark_lib.MODEL_CACHE_ROOT = previous_root

        self.assertEqual(record["actualSha256"], expected)
        self.assertEqual(record["actualModelSha256"], expected)
        self.assertTrue(record["sha256Match"])
        self.assertTrue(record["artifactVerified"])

    def test_actual_artifact_sha_mismatch_fails_adapter_before_runtime_initialization(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            cache_root = Path(temporary)
            (cache_root / "fixture.onnx").write_bytes(b"different-model")
            previous_root = benchmark_lib.MODEL_CACHE_ROOT
            benchmark_lib.MODEL_CACHE_ROOT = cache_root
            try:
                metadata = {"cacheFile": "fixture.onnx", "modelSha256": "0" * 64, "exactModelRevision": "rev-1", "weightLicenseVerificationStatus": "VERIFIED", "rembgSession": "isnet-anime"}
                adapter = RembgAdapter("isnet-anime", metadata, allow_model_download=False)
                availability = adapter.availability()
            finally:
                benchmark_lib.MODEL_CACHE_ROOT = previous_root

        self.assertFalse(availability.available)
        self.assertIn("SHA-256 mismatch", availability.reason or "")


if __name__ == "__main__":
    unittest.main()
