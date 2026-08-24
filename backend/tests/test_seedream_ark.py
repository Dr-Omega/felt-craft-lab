from __future__ import annotations

import base64
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import requests

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from providers.image.mock_provider import solid_png  # noqa: E402
from providers.image.seedream_ark import SeedreamArkProvider  # noqa: E402

PNG = solid_png(16, 16, (244, 162, 97))


class _Response:
    status_code = 200
    headers = {"X-Request-Id": "ark-1"}

    def json(self):
        return {
            "data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]
        }


class SeedreamArkTests(unittest.TestCase):
    def test_seedream_payload_has_reference_images_and_no_sd_knobs(self):
        captured = {}

        def post(_url, **kwargs):
            captured.update(kwargs)
            return _Response()

        refs = ["data:image/png;base64,AA=="] * 8
        with mock.patch.dict(os.environ, {"ARK_API_KEY": "test-key"}, clear=False):
            result = SeedreamArkProvider(post=post).generate(
                positive_prompt="panda holding a red ball",
                negative_prompt="photo",
                width=1024,
                height=1024,
                reference_images=refs,
                model="doubao-seedream-4-5-251128",
            )
        self.assertTrue(result.get("ok"))
        payload = captured["json"]
        self.assertEqual(payload["model"], "doubao-seedream-4-5-251128")
        self.assertEqual(payload["prompt"], "panda holding a red ball")
        self.assertEqual(payload["image"], refs)
        self.assertEqual(len(payload["image"]), 8)
        self.assertEqual(payload["sequential_image_generation"], "disabled")
        self.assertFalse(payload["watermark"])
        for key in ("guidance_scale", "steps", "sampler", "cfg_scale", "lora"):
            self.assertNotIn(key, payload)
        self.assertEqual(captured["timeout"], 90.0)

    def test_provider_does_not_own_eight_reference_policy(self):
        captured = {}

        def post(_url, **kwargs):
            captured.update(kwargs)
            return _Response()

        with mock.patch.dict(os.environ, {"ARK_API_KEY": "test-key"}, clear=False):
            result = SeedreamArkProvider(post=post).generate(
                positive_prompt="x", reference_images=["data:image/png;base64,AA=="] * 3
            )
        self.assertTrue(result.get("ok"))
        self.assertEqual(len(captured["json"]["image"]), 3)

    def test_timeout_is_mapped_to_existing_error_envelope(self):
        def post(*_args, **_kwargs):
            raise requests.Timeout()

        with mock.patch.dict(os.environ, {"ARK_API_KEY": "test-key"}, clear=False):
            result = SeedreamArkProvider(post=post).generate(positive_prompt="x")
        self.assertFalse(result.get("ok"))
        self.assertEqual(result["error"]["code"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
