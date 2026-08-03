"""Fail-closed APP_ENV / HMAC / ready regressions."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Ensure app import path sees explicit development for shared Flask tests in this process.
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AI_SESSION_HMAC_SECRET", "test-session-hmac-secret-not-for-prod")

from services.guards import is_dev_mode  # noqa: E402
from services.session_auth import session_hmac_secret, session_secret_status  # noqa: E402


class FailClosedUnitTests(unittest.TestCase):
    def test_missing_app_env_is_not_dev(self):
        with mock.patch.dict(os.environ, {"APP_ENV": ""}, clear=False):
            os.environ.pop("APP_ENV", None)
            self.assertFalse(is_dev_mode())

    def test_unknown_app_env_is_not_dev(self):
        with mock.patch.dict(os.environ, {"APP_ENV": "staging"}):
            self.assertFalse(is_dev_mode())

    def test_explicit_development_is_dev(self):
        with mock.patch.dict(os.environ, {"APP_ENV": "development"}):
            self.assertTrue(is_dev_mode())

    def test_production_missing_hmac_raises(self):
        with mock.patch.dict(
            os.environ,
            {"APP_ENV": "production", "AI_SESSION_HMAC_SECRET": ""},
        ):
            with self.assertRaises(RuntimeError):
                session_hmac_secret()

    def test_production_placeholder_hmac_rejected(self):
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "AI_SESSION_HMAC_SECRET": "change-me-to-a-long-random-string",
            },
        ):
            with self.assertRaises(RuntimeError):
                session_hmac_secret()
            status = session_secret_status()
            self.assertFalse(status["usable"])

    def test_missing_app_env_rejects_ephemeral_secret(self):
        env = {k: v for k, v in os.environ.items() if k not in {"APP_ENV", "AI_SESSION_HMAC_SECRET"}}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError):
                session_hmac_secret()


class ReadyEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["APP_ENV"] = "development"
        os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
        from app import app  # noqa: WPS433

        cls.client = app.test_client()

    def test_ready_dev_usable_without_provider_keys(self):
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "AI_SESSION_HMAC_SECRET": "test-session-hmac-secret-not-for-prod",
            },
        ):
            r = self.client.get("/api/ready")
            self.assertEqual(r.status_code, 200)
            body = r.get_json()
            self.assertTrue(body.get("sessionAuth"))
            self.assertTrue(body.get("ready"))
            self.assertNotIn("secret", str(body).lower())

    def test_ready_production_missing_hmac_is_503(self):
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "AI_SESSION_HMAC_SECRET": "",
                "QWEN_ASR_API_KEY": "k",
                "DEEPSEEK_API_KEY": "k",
                "MINIMAX_API_KEY": "k",
                "MINIMAX_GROUP_ID": "g",
            },
            clear=False,
        ):
            r = self.client.get("/api/ready")
            self.assertEqual(r.status_code, 503)
            body = r.get_json()
            self.assertFalse(body.get("ready"))
            self.assertFalse(body.get("sessionAuth"))
            self.assertNotIn("secret", str(body).lower())

    def test_ready_production_missing_provider_keys_is_503(self):
        strong = "prod-hmac-secret-value-at-least-32-chars-ok"
        with mock.patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "AI_SESSION_HMAC_SECRET": strong,
                "QWEN_ASR_API_KEY": "",
                "DASHSCOPE_API_KEY": "",
                "DEEPSEEK_API_KEY": "",
                "MINIMAX_API_KEY": "",
                "MINIMAX_GROUP_ID": "",
            },
            clear=False,
        ):
            r = self.client.get("/api/ready")
            self.assertEqual(r.status_code, 503)
            body = r.get_json()
            self.assertFalse(body.get("ready"))
            self.assertTrue(body.get("sessionAuth"))
            self.assertFalse(body.get("asr"))
            self.assertFalse(body.get("qa"))
            self.assertFalse(body.get("tts"))
            self.assertNotIn("secret", str(body).lower())


if __name__ == "__main__":
    unittest.main()
