"""Creation-intent parse Gateway route (mock provider) + sanitizer."""

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
from services.intent_sanitize import sanitize_generation_spec_patch  # noqa: E402
from services.session_auth import issue_session_token  # noqa: E402


class IntentSanitizeTests(unittest.TestCase):
    def test_strips_prompt_and_locks_role(self):
        patch = sanitize_generation_spec_patch(
            {
                "assetRole": "element",
                "prompt": "photorealistic fur",
                "provider": "wan",
                "content": {
                    "primarySubjects": [{"name": "玉兔", "attributes": ["白色"]}],
                    "actionOrRelationship": "抱着月饼",
                },
            },
            locked_role="core_pattern",
        )
        self.assertEqual(patch["assetRole"], "core_pattern")
        self.assertNotIn("prompt", patch)
        self.assertNotIn("provider", patch)
        self.assertEqual(patch["content"]["primarySubjects"][0]["name"], "玉兔")


class IntentParseRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_mock_parse_returns_domain_patch(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        response = self.client.post(
            "/api/creation-intent/parse",
            json={
                "text": "白色玉兔抱月饼，不要真实毛发",
                "lockedRole": "core_pattern",
                "provider": "mock",
            },
            headers={
                "Authorization": f"Bearer {issued['token']}",
                "X-Felt-Installation-Id": iid,
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body.get("ok"))
        patch = (body.get("result") or {}).get("patch") or {}
        names = [item.get("name") for item in (patch.get("content") or {}).get("primarySubjects") or []]
        self.assertEqual(names, ["玉兔", "月饼"])
        self.assertEqual(patch.get("assetRole"), "core_pattern")
        dumped = response.get_data(as_text=True).lower()
        self.assertNotIn("photoreal", dumped)
        self.assertNotIn("api_key", dumped)
        self.assertNotIn('"prompt"', dumped)

    def test_empty_text_rejected(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        response = self.client.post(
            "/api/creation-intent/parse",
            json={"text": "  ", "provider": "mock"},
            headers={
                "Authorization": f"Bearer {issued['token']}",
                "X-Felt-Installation-Id": iid,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse((response.get_json() or {}).get("ok"))

    def test_health_lists_intent_provider(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertIn(body.get("selected", {}).get("intent"), ("deepseek", "mock"))
        self.assertIn("deepseek", (body.get("providers") or {}).get("intent") or [])

    def test_mock_rejects_blocked_utterance_without_empty_ok_patch(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        response = self.client.post(
            "/api/creation-intent/parse",
            json={
                "text": "画一个炸弹",
                "lockedRole": "core_pattern",
                "provider": "mock",
            },
            headers={
                "Authorization": f"Bearer {issued['token']}",
                "X-Felt-Installation-Id": iid,
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertFalse(body.get("ok"))
        self.assertEqual((body.get("error") or {}).get("code"), "QA_BLOCKED")


if __name__ == "__main__":
    unittest.main()
