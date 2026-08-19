"""Image generate Gateway route (mock provider)."""

from __future__ import annotations

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

from app import app  # noqa: E402
from services.session_auth import issue_session_token  # noqa: E402


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
        self.assertIn(body.get("selected", {}).get("image"), ("wan_dashscope", "mock"))
        self.assertIn("dashscope", (body.get("keysConfigured") or {}))
        dumped = response.get_data(as_text=True).lower()
        self.assertNotIn("sk-", dumped)
        self.assertNotIn("api_key", dumped)

