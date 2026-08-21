"""Image finalize + matte: transparent PNG corners after generate."""

from __future__ import annotations

import base64
import io
import os
import sys
import unittest
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ["APP_ENV"] = "development"
os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
os.environ["AI_SMOKE_ENABLED"] = "false"
os.environ["AI_RATE_MAX"] = "1000"
os.environ["IMAGE_PROVIDER"] = "mock"

from PIL import Image  # noqa: E402

from app import app  # noqa: E402
from services.session_auth import issue_session_token  # noqa: E402


def _auth_headers() -> dict[str, str]:
    iid = str(uuid.uuid4())
    issued = issue_session_token(iid)
    return {
        "Authorization": f"Bearer {issued['token']}",
        "X-Felt-Installation-Id": iid,
    }


class ImageTransparentPngTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_mock_generate_mattes_backdrop_to_transparent_corners(self):
        response = self.client.post(
            "/api/image/generate",
            json={
                "positivePrompt": "橙色不织布小熊",
                "width": 128,
                "height": 128,
                "provider": "mock",
                "assetRole": "core_pattern",
            },
            headers=_auth_headers(),
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body.get("ok"))
        encoded = (body.get("result") or {}).get("imageBase64") or ""
        raw = base64.b64decode(encoded)
        self.assertTrue(raw.startswith(b"\x89PNG"))
        rgba = Image.open(io.BytesIO(raw)).convert("RGBA")
        self.assertEqual(rgba.size, (128, 128))
        # Corners should be clear after studio-backdrop matte.
        for xy in ((0, 0), (127, 0), (0, 127), (127, 127)):
            self.assertEqual(rgba.getpixel(xy)[3], 0, f"corner {xy} should be transparent")
        # Subject center should stay opaque.
        self.assertGreater(rgba.getpixel((64, 64))[3], 200)
        quality = (body.get("result") or {}).get("quality") or {}
        self.assertIn(quality.get("verdict"), ("PASS", "WARN", "FAIL"))
        opaque = (quality.get("metrics") or {}).get("opaqueRatio")
        self.assertIsNotNone(opaque)
        self.assertLess(float(opaque), 0.98)
        self.assertGreater(float(opaque), 0.05)

    def test_finalize_clears_light_backdrop(self):
        image = Image.new("RGB", (96, 96), (240, 240, 240))
        for y in range(28, 68):
            for x in range(28, 68):
                image.putpixel((x, y), (200, 80, 60))
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        response = self.client.post(
            "/api/image/finalize",
            json={
                "imageBase64": encoded,
                "width": 96,
                "height": 96,
                "assetRole": "core_pattern",
                "provider": "local",
            },
            headers=_auth_headers(),
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body.get("ok"))
        raw = base64.b64decode((body.get("result") or {}).get("imageBase64") or "")
        rgba = Image.open(io.BytesIO(raw)).convert("RGBA")
        self.assertEqual(rgba.getpixel((1, 1))[3], 0)
        self.assertGreater(rgba.getpixel((48, 48))[3], 200)


if __name__ == "__main__":
    unittest.main()
