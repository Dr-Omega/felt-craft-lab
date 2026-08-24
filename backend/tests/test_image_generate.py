from __future__ import annotations

import base64
import copy
import os
import sys
import unittest
import uuid
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from providers.image.mock_provider import MockImageProvider  # noqa: E402
from providers.image.sd_local import SdLocalImageProvider  # noqa: E402
from providers.image.wan_dashscope import WanDashscopeImageProvider  # noqa: E402
from services.image_service import ImageService  # noqa: E402
from services.image_types import ImageProviderError  # noqa: E402


class ImageServiceTests(unittest.TestCase):
    def test_seedream_result_runs_through_normalize_and_quality_gate(self):
        captured = {}
        provider = MockImageProvider()

        def pick_provider(name):
            captured["provider"] = name
            return provider

        with mock.patch("services.image_service._provider", side_effect=pick_provider):
            body = ImageService().generate(
                canonical_prompt="我想要一只熊猫抱着红色皮球",
                asset_role="core_pattern",
            )
        self.assertTrue(body["ok"])
        self.assertEqual(captured["provider"], "seedream_ark")
        result = body["result"]
        self.assertEqual(result["contentType"], "image/png")
        self.assertEqual(result["qualityVerdict"], "accepted")
        self.assertTrue(base64.b64decode(result["imageBase64"]).startswith(b"\x89PNG\r\n\x1a\n"))

    def test_non_core_role_does_not_fallback_to_seedream(self):
        body = ImageService().generate(canonical_prompt="a tree", asset_role="background")
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "INVALID_ARGUMENT")

    def test_existing_provider_contracts_accept_optional_references(self):
        mock_result = MockImageProvider().generate(
            positive_prompt="felt rabbit", model="mock", width=512, height=512, reference_images=[]
        )
        self.assertTrue(mock_result.image_bytes.startswith(b"\x89PNG"))
        for provider in (WanDashscopeImageProvider(), SdLocalImageProvider()):
            with self.assertRaisesRegex(ImageProviderError, "IMAGE_PROVIDER_NOT_READY"):
                provider.generate(positive_prompt="x", model="m", width=512, height=512, reference_images=[])


class ImageGatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["APP_ENV"] = "development"
        os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
        from app import app  # noqa: WPS433

        cls.client = app.test_client()

    def _auth_headers(self):
        installation_id = str(uuid.uuid4())
        response = self.client.post("/api/session/token", json={"installationId": installation_id})
        self.assertEqual(response.status_code, 200)
        token = response.get_json()["result"]["token"]
        return {"Authorization": f"Bearer {token}", "X-Felt-Installation-Id": installation_id}

    def test_renderer_cannot_send_profile_or_reference_strategy(self):
        request_body = {
            "canonicalPrompt": "panda holding a red ball",
            "assetRole": "core_pattern",
            "provider": "mock",
            "referenceImages": ["https://attacker.example/ref.png"],
        }
        original = copy.deepcopy(request_body)
        response = self.client.post("/api/image/generate", json=request_body, headers=self._auth_headers())
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["ok"])
        self.assertEqual(request_body, original)

    def test_health_reveals_only_safe_profile_metadata(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["selected"]["image"], "seedream_ark")
        profile = body["imageProfile"]
        self.assertEqual(profile["activeCorePatternProfileId"], "felt-seedream45-ref8-v1")
        self.assertEqual(profile["referenceSetId"], "felt-style-ref-v1")
        self.assertEqual(profile["referenceCount"], 8)
        serialised = str(body).lower()
        self.assertNotIn("data:image", serialised)
        self.assertNotIn("ark_api_key", serialised)
        self.assertNotIn("hidden_prompt", serialised)


if __name__ == "__main__":
    unittest.main()
