"""Image generate Gateway route (mock provider)."""

from __future__ import annotations

import os
import sys
import unittest
import uuid
import io
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ["APP_ENV"] = "development"
os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
os.environ["AI_SMOKE_ENABLED"] = "false"
os.environ["AI_RATE_MAX"] = "1000"
# Keep shared in-process abuse-limit constants deterministic when discovery loads
# this image module before test_session_auth.
os.environ["AI_INSTALL_RATE_MAX"] = "5"
os.environ["AI_INSTALL_DAY_MAX"] = "100"
os.environ["AI_GLOBAL_MAX_CALLS_PER_HOUR"] = "3"
os.environ["AI_GLOBAL_MAX_CALLS_PER_DAY"] = "100"

from app import app  # noqa: E402
from PIL import Image  # noqa: E402
from providers.image.mock_provider import subject_on_backdrop_png  # noqa: E402
from services.image_types import ok_image_bytes  # noqa: E402
from services.session_auth import issue_session_token  # noqa: E402


class _CapturedSeedreamProvider:
    name = "seedream_ark"

    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return ok_image_bytes(
            image_bytes=subject_on_backdrop_png(128, 128, (244, 162, 97)),
            request_id="seedream-test",
            provider=self.name,
        )


class ImageGenerateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_mock_generate_returns_png_base64(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        response = self.client.post(
            "/api/image/generate",
            json={"positivePrompt": "白色玉兔抱月饼", "width": 64, "height": 64, "provider": "mock"},
            headers={
                "Authorization": f"Bearer {issued['token']}",
                "X-Felt-Installation-Id": iid,
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body.get("ok"))
        encoded = (body.get("result") or {}).get("imageBase64")
        self.assertTrue(encoded)
        raw = __import__("base64").b64decode(encoded)
        self.assertTrue(raw.startswith(b"\x89PNG"))
        quality = (body.get("result") or {}).get("quality") or {}
        self.assertIn(quality.get("verdict"), ("PASS", "WARN", "FAIL"))
        self.assertTrue(quality.get("messages"))

    def test_empty_prompt_rejected(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        response = self.client.post(
            "/api/image/generate",
            json={"positivePrompt": "  "},
            headers={
                "Authorization": f"Bearer {issued['token']}",
                "X-Felt-Installation-Id": iid,
            },
        )
        self.assertEqual(response.status_code, 400)
        body = response.get_json()
        self.assertFalse(body.get("ok"))

    def test_health_reports_image_selection_without_secrets(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body.get("selected", {}).get("image"), "seedream_ark")
        self.assertIn("sd_local", (body.get("providers") or {}).get("image") or [])
        self.assertIn("seedream_ark", (body.get("providers") or {}).get("image") or [])
        self.assertIn("dashscope", (body.get("keysConfigured") or {}))
        self.assertIn("sdLocal", (body.get("keysConfigured") or {}))
        profile = body.get("imageProfile") or {}
        self.assertEqual(profile.get("profileId"), "felt-seedream45-ref8-v1")
        self.assertEqual(profile.get("referenceSetId"), "felt-style-ref-v1")
        self.assertEqual(profile.get("referenceCount"), 8)
        dumped = response.get_data(as_text=True).lower()
        self.assertNotIn("sk-", dumped)
        self.assertNotIn("api_key", dumped)

    def test_main_contract_uses_seedream_profile_and_keeps_quality_envelope(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        provider = _CapturedSeedreamProvider()
        with mock.patch("services.image_service.SeedreamArkProvider", return_value=provider):
            response = self.client.post(
                "/api/image/generate",
                json={
                    "positivePrompt": "我想要一只熊猫抱着红色皮球",
                    "negativePrompt": "照片，毛发纹理",
                    "width": 512,
                    "height": 512,
                    "assetRole": "core_pattern",
                    "requestId": "main-request-1",
                },
                headers={"Authorization": f"Bearer {issued['token']}", "X-Felt-Installation-Id": iid},
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        result = body["result"]
        self.assertEqual(result["width"], 512)
        self.assertEqual(result["height"], 512)
        self.assertIn(result["quality"]["verdict"], ("PASS", "WARN", "FAIL"))
        self.assertEqual(len(provider.calls), 1)
        call = provider.calls[0]
        self.assertEqual((call["width"], call["height"]), (1024, 1024))
        self.assertEqual(len(call["reference_images"]), 8)
        self.assertIn("我想要一只熊猫抱着红色皮球", call["positive_prompt"])
        self.assertEqual(call["positive_prompt"].count("我想要一只熊猫抱着红色皮球"), 1)
        normalized = Image.open(io.BytesIO(__import__("base64").b64decode(result["imageBase64"]))).convert("RGBA")
        self.assertEqual(normalized.getpixel((2, 2))[3], 0, "Seedream output must pass existing matte postprocess")

    def test_renderer_cannot_override_reference_or_profile_policy(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        response = self.client.post(
            "/api/image/generate",
            json={
                "positivePrompt": "熊猫",
                "assetRole": "core_pattern",
                "referenceImages": ["https://attacker.example/image.png"],
                "profileId": "other",
            },
            headers={"Authorization": f"Bearer {issued['token']}", "X-Felt-Installation-Id": iid},
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["ok"])

