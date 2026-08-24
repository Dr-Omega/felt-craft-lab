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

from providers.image.seedream_ark import SeedreamArkImageProvider  # noqa: E402
from services.image_types import ImageProviderError  # noqa: E402

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/z8lK6QAAAABJRU5ErkJggg==")
REFS = ["data:image/png;base64,AA=="] * 8


class FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body if body is not None else {
            "data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]
        }
        self.headers = {"X-Request-Id": "ark-request-1"}

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response = response or FakeResponse()
        self.error = error
        self.calls = []

    def post(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if self.error:
            raise self.error
        return self.response


class SeedreamArkProviderTests(unittest.TestCase):
    def test_payload_is_seedream_single_image_without_sd_knobs(self):
        session = FakeSession()
        provider = SeedreamArkImageProvider(session=session)
        with mock.patch.dict(os.environ, {"ARK_API_KEY": "not-a-real-key"}, clear=False):
            result = provider.generate(positive_prompt="panda felt", model="doubao-seedream-4.5", width=1024, height=1024, reference_images=REFS)
        self.assertEqual(result.image_bytes, PNG)
        self.assertEqual(result.request_id, "ark-request-1")
        _, call = session.calls[0]
        payload = call["json"]
        self.assertEqual(payload["model"], "doubao-seedream-4.5")
        self.assertEqual(payload["prompt"], "panda felt")
        self.assertEqual(payload["image"], REFS)
        self.assertEqual(len(payload["image"]), 8)
        self.assertEqual(payload["sequential_image_generation"], "disabled")
        self.assertFalse(payload["watermark"])
        self.assertNotIn("guidance_scale", payload)
        self.assertNotIn("steps", payload)
        self.assertNotIn("sampler", payload)
        self.assertNotIn("lora", {key.lower() for key in payload})
        self.assertEqual(call["timeout"], 90.0)
        self.assertNotIn("not-a-real-key", repr(payload))

    def test_provider_errors_are_normalized(self):
        with mock.patch.dict(os.environ, {"ARK_API_KEY": "not-a-real-key"}, clear=False):
            with self.assertRaisesRegex(ImageProviderError, "IMAGE_TIMEOUT"):
                SeedreamArkImageProvider(session=FakeSession(error=requests.Timeout())).generate(
                    positive_prompt="p", model="m", width=1024, height=1024, reference_images=REFS
                )
            with self.assertRaisesRegex(ImageProviderError, "IMAGE_UPSTREAM_ERROR"):
                SeedreamArkImageProvider(session=FakeSession(response=FakeResponse(status_code=500, body={"error": {"message": "nope"}}))).generate(
                    positive_prompt="p", model="m", width=1024, height=1024, reference_images=REFS
                )

    def test_missing_key_and_bad_reference_count_fail_closed(self):
        with mock.patch.dict(os.environ, {"ARK_API_KEY": ""}, clear=False):
            with self.assertRaisesRegex(ImageProviderError, "IMAGE_MISSING_API_KEY"):
                SeedreamArkImageProvider().generate(positive_prompt="p", model="m", width=1024, height=1024, reference_images=REFS)
        with mock.patch.dict(os.environ, {"ARK_API_KEY": "test"}, clear=False):
            with self.assertRaisesRegex(ImageProviderError, "IMAGE_REFERENCE_INVALID"):
                SeedreamArkImageProvider().generate(positive_prompt="p", model="m", width=1024, height=1024, reference_images=REFS[:-1])


if __name__ == "__main__":
    unittest.main()
