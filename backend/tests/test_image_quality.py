"""Felt quality gate: flat blocks pass; noisy photos fail."""

from __future__ import annotations

import io
import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ["APP_ENV"] = "development"

from PIL import Image  # noqa: E402

from providers.image.mock_provider import solid_png  # noqa: E402
from services.image_quality import evaluate_felt_quality  # noqa: E402


def _noise_png(size: int = 64) -> bytes:
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            pixels[x, y] = ((x * 13 + y * 7) % 256, (x * 5) % 256, (y * 11) % 256)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


class FeltQualityTests(unittest.TestCase):
    def test_flat_color_block_is_usable(self):
        report = evaluate_felt_quality(solid_png(64, 64, (244, 162, 97)), asset_role="core_pattern")
        self.assertIn(report["verdict"], ("PASS", "WARN"))
        self.assertFalse(any("铺满" in item for item in report["messages"]))

    def test_noisy_photo_fails(self):
        report = evaluate_felt_quality(_noise_png(), asset_role="element")
        self.assertEqual(report["verdict"], "FAIL")
        self.assertTrue(report["messages"])


if __name__ == "__main__":
    unittest.main()
