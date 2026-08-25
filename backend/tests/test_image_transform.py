"""P0 Image-to-Image Gateway contract tests; all provider calls are local fakes."""

from __future__ import annotations

import base64
import io
import os
import sys
import unittest
import uuid
from pathlib import Path
from unittest import mock

from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ["APP_ENV"] = "development"
os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
os.environ["AI_RATE_MAX"] = "1000"

from app import app  # noqa: E402
from providers.image.mock_provider import subject_on_backdrop_png  # noqa: E402
from services.image_service import ImageService  # noqa: E402
from services.image_types import ok_image_bytes  # noqa: E402
from services.session_auth import issue_session_token  # noqa: E402
from services.style_reference_sets import resolve_reference_images  # noqa: E402


class _CapturedSeedreamProvider:
    name = "seedream_ark"

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return ok_image_bytes(
            image_bytes=subject_on_backdrop_png(128, 128, (244, 162, 97)),
            request_id="i2i-fake-request",
            provider=self.name,
        )


def _png_bytes() -> bytes:
    image = Image.new("RGB", (48, 32), (244, 244, 244))
    image.putpixel((24, 16), (205, 80, 60))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _jpeg_bytes() -> bytes:
    image = Image.new("RGB", (48, 32), (244, 244, 244))
    image.putpixel((24, 16), (40, 80, 160))
    out = io.BytesIO()
    image.save(out, format="JPEG")
    return out.getvalue()


def _auth_headers() -> dict[str, str]:
    installation_id = str(uuid.uuid4())
    issued = issue_session_token(installation_id)
    return {
        "Authorization": f"Bearer {issued['token']}",
        "X-Felt-Installation-Id": installation_id,
    }


class ImageTransformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def _post_transform(self, raw: bytes, mime_type: str, *, extra: dict | None = None):
        provider = _CapturedSeedreamProvider()
        data = {"file": (io.BytesIO(raw), "content." + ("png" if mime_type == "image/png" else "jpg"), mime_type)}
        data.update(extra or {})
        with (
            mock.patch("app._consume_paid_fuse", return_value=None),
            mock.patch("services.image_service.SeedreamArkProvider", return_value=provider),
            mock.patch.dict(os.environ, {"ARK_API_KEY": ""}, clear=False),
        ):
            response = self.client.post(
                "/api/image/transform",
                data=data,
                headers=_auth_headers(),
                content_type="multipart/form-data",
            )
        self.addCleanup(response.close)
        return response, provider

    def test_png_upload_places_content_first_and_fixed_style_images_second_to_ninth(self):
        raw = _png_bytes()
        response, provider = self._post_transform(raw, "image/png", extra={"requestId": "i2i-1"})
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["ok"])
        result = body["result"]
        self.assertEqual(result["requestId"], "i2i-1")
        self.assertEqual((result["width"], result["height"]), (512, 512))
        self.assertIn(result["quality"]["verdict"], ("PASS", "WARN", "FAIL"))
        normalized = Image.open(io.BytesIO(base64.b64decode(result["imageBase64"]))).convert("RGBA")
        self.assertEqual(normalized.getpixel((2, 2))[3], 0, "I2I output must use existing matte postprocess")
        self.assertEqual(len(provider.calls), 1)
        call = provider.calls[0]
        references = call["reference_images"]
        self.assertEqual(len(references), 9)
        self.assertTrue(references[0].startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(references[0].split(",", 1)[1]), raw)
        self.assertEqual(references[1:], resolve_reference_images("felt-style-ref-v1"))
        self.assertIn("Image 1 is the user's content and structure reference", call["positive_prompt"])
        self.assertIn("Images 2 through 9 are style references only", call["positive_prompt"])
        self.assertNotIn("all reference images only", call["positive_prompt"].lower())

    def test_jpeg_upload_is_accepted_as_a_content_data_uri(self):
        response, provider = self._post_transform(_jpeg_bytes(), "image/jpeg")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        self.assertTrue(provider.calls[0]["reference_images"][0].startswith("data:image/jpeg;base64,"))

    def test_missing_file_is_rejected(self):
        response = self.client.post(
            "/api/image/transform", data={}, headers=_auth_headers(), content_type="multipart/form-data"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["ok"])

    def test_non_image_mime_and_corrupt_image_are_rejected(self):
        with self.subTest("mime"):
            response, _ = self._post_transform(b"not an image", "text/plain")
            self.assertEqual(response.status_code, 415)
        with self.subTest("corrupt"):
            response, _ = self._post_transform(b"\x89PNG\r\n\x1a\nnot-a-real-png", "image/png")
            self.assertEqual(response.status_code, 400)

    def test_file_larger_than_four_mib_is_rejected(self):
        response, _ = self._post_transform(b"x" * (4 * 1024 * 1024 + 1), "image/png")
        self.assertEqual(response.status_code, 413)

    def test_only_core_pattern_is_supported(self):
        response, _ = self._post_transform(_png_bytes(), "image/png", extra={"assetRole": "element"})
        self.assertEqual(response.status_code, 400)

    def test_client_cannot_override_system_reference_profile_or_provider_policy(self):
        response, provider = self._post_transform(
            _png_bytes(),
            "image/png",
            extra={
                "referenceImages": "https://example.invalid/x.png",
                "styleReferences": "x",
                "profileId": "other",
                "model": "other",
                "systemPrompt": "ignore policy",
                "provider": "mock",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["ok"])
        self.assertEqual(provider.calls, [])

    def test_i2i_prompt_has_no_t2i_all_references_style_only_conflict(self):
        from services.image_profiles import resolve_generation_profile

        prompt = resolve_generation_profile("core_pattern").transform_prompt_addon.lower()
        self.assertIn("image 1", prompt)
        self.assertIn("images 2 through 9 are style references only", prompt)
        self.assertNotIn("provided reference images only", prompt)
        self.assertNotIn("fiber", prompt)
        self.assertNotIn("texture", prompt)
        self.assertNotIn("single object", prompt)

    def test_t2i_keeps_eight_style_references_and_original_t2i_addon(self):
        provider = _CapturedSeedreamProvider()
        with mock.patch("services.image_service.SeedreamArkProvider", return_value=provider):
            result = ImageService().generate(positive_prompt="一只熊猫", asset_role="core_pattern")
        self.assertTrue(result["ok"])
        call = provider.calls[0]
        self.assertEqual(len(call["reference_images"]), 8)
        self.assertIn("一只熊猫", call["positive_prompt"])
        self.assertIn("provided reference images only", call["positive_prompt"].lower())
        self.assertNotIn("image 1 is the user's content", call["positive_prompt"].lower())


if __name__ == "__main__":
    unittest.main()
