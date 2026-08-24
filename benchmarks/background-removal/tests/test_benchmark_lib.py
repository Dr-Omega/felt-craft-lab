from __future__ import annotations

import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from benchmark_lib import BENCHMARK_ROOT, calculate_metrics, load_config  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
