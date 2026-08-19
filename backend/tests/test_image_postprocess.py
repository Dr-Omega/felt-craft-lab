"""RGBA matte: remove backdrop, keep white subject parts near dark cores."""

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

from services.image_postprocess import normalize_rgba_png, remove_plain_background  # noqa: E402


class ImageMatteTests(unittest.TestCase):
    def test_keeps_white_subject_attached_to_dark_cores(self):
        # White canvas + black panda ears + white belly between them + far white bg.
        image = Image.new("RGB", (120, 120), (255, 255, 255))
        for y in range(40, 80):
            for x in range(35, 50):
                image.putpixel((x, y), (20, 20, 20))
            for x in range(70, 85):
                image.putpixel((x, y), (20, 20, 20))
        # White belly between the dark patches (must remain opaque after matte).
        for y in range(48, 72):
            for x in range(50, 70):
                image.putpixel((x, y), (252, 252, 252))

        matted = remove_plain_background(image, protect_radius=41)
        self.assertEqual(matted.getpixel((2, 2))[3], 0, "far background should be clear")
        self.assertEqual(matted.getpixel((42, 55))[3], 255, "dark core stays")
        self.assertEqual(matted.getpixel((60, 55))[3], 255, "white belly near cores stays")

    def test_jpeg_bytes_normalize_to_png_with_alpha(self):
        image = Image.new("RGB", (80, 80), (210, 210, 210))
        for y in range(25, 55):
            for x in range(25, 55):
                image.putpixel((x, y), (40, 120, 200))
        jpeg = io.BytesIO()
        image.save(jpeg, format="JPEG", quality=90)
        result = normalize_rgba_png(jpeg.getvalue(), width=64, height=64)
        self.assertTrue(result.get("ok"))
        decoded = Image.open(io.BytesIO(result["image_bytes"]))
        self.assertEqual(decoded.format, "PNG")
        self.assertEqual(decoded.mode, "RGBA")
        self.assertEqual(decoded.getpixel((2, 2))[3], 0)

    def test_solid_colored_mock_is_not_wiped(self):
        image = Image.new("RGB", (32, 32), (244, 162, 97))
        matted = remove_plain_background(image)
        opaque = sum(1 for pixel in matted.getdata() if pixel[3] > 0)
        self.assertEqual(opaque, 32 * 32)


if __name__ == "__main__":
    unittest.main()
