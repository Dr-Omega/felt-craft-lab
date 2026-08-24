from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AI_SESSION_HMAC_SECRET", "test-session-hmac-secret-not-for-prod")

from PIL import Image  # noqa: E402

from providers.image.mock_provider import solid_png  # noqa: E402
from tools import smoke_image_providers as smoke  # noqa: E402


class SeedreamSmokeTests(unittest.TestCase):
    def test_seedream_acceptance_smoke_requests_and_saves_512_candidate_pngs(self):
        calls = []

        def fake_generate(_client, provider, *, prompt, width, height):
            calls.append({"provider": provider, "prompt": prompt, "width": width, "height": height})
            return (
                {
                    "ok": True,
                    "provider": "seedream_ark",
                    "qualityVerdict": "PASS",
                    "latencyMs": 1,
                    "errorCode": None,
                },
                solid_png(width, height, (244, 162, 97)),
            )

        with tempfile.TemporaryDirectory() as raw_dir:
            output = Path(raw_dir)
            with mock.patch.object(smoke, "_generate", side_effect=fake_generate):
                records = smoke._seedream_smoke(object(), output)
            self.assertEqual(len(records), 10)
            self.assertTrue(all(call["provider"] is None for call in calls))
            self.assertTrue(all((call["width"], call["height"]) == (512, 512) for call in calls))
            self.assertTrue(all(record["referenceCount"] == 8 for record in records))
            for index in range(1, 11):
                with Image.open(output / f"seedream-{index:02d}.png") as image:
                    self.assertEqual(image.size, (512, 512))


if __name__ == "__main__":
    unittest.main()
