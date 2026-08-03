"""Session Token 签发/校验、无 Token 拒绝、限流与全局保险丝回归。"""

from __future__ import annotations

import os
import sys
import time
import unittest
import uuid
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("APP_ENV", "development")
os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
os.environ["AI_SMOKE_ENABLED"] = "false"
# Tight limits for fuse/rate tests
os.environ["AI_INSTALL_RATE_MAX"] = "5"
os.environ["AI_INSTALL_DAY_MAX"] = "100"
os.environ["AI_GLOBAL_MAX_CALLS_PER_HOUR"] = "8"
os.environ["AI_GLOBAL_MAX_CALLS_PER_DAY"] = "100"
os.environ["AI_RATE_MAX"] = "1000"

from services.abuse_limits import reset_abuse_limits_for_tests  # noqa: E402
from services.session_auth import issue_session_token, verify_session_token  # noqa: E402


class SessionAuthUnitTests(unittest.TestCase):
    def test_issue_and_verify(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid, ttl_sec=120)
        claims = verify_session_token(issued["token"], expected_installation_id=iid)
        self.assertIsNotNone(claims)
        assert claims is not None
        self.assertEqual(claims.installation_id, iid.lower())

    def test_expired_rejected(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid, ttl_sec=60, now=time.time() - 100)
        self.assertIsNone(verify_session_token(issued["token"]))

    def test_tampered_rejected(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid)
        bad = issued["token"][:-4] + "dead"
        self.assertIsNone(verify_session_token(bad))


class SessionAuthFlaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import app  # noqa: WPS433

        cls.client = app.test_client()

    def setUp(self):
        reset_abuse_limits_for_tests()

    def _issue(self, installation_id: str | None = None) -> tuple[str, str]:
        iid = installation_id or str(uuid.uuid4())
        r = self.client.post("/api/session/token", json={"installationId": iid})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["ok"])
        return iid, body["result"]["token"]

    def _auth_headers(self, iid: str, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "X-Felt-Installation-Id": iid,
        }

    def test_issue_rejects_bad_installation_id(self):
        r = self.client.post("/api/session/token", json={"installationId": "not-a-uuid"})
        self.assertEqual(r.status_code, 400)

    def test_paid_routes_reject_missing_token(self):
        r = self.client.post("/api/qa/ask", json={"question": "hi", "provider": "mock"})
        self.assertEqual(r.status_code, 401)
        body = r.get_json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "INVALID_ARGUMENT")

    def test_paid_routes_reject_bad_token(self):
        r = self.client.post(
            "/api/qa/ask",
            json={"question": "hi", "provider": "mock"},
            headers={"Authorization": "Bearer totally.invalid"},
        )
        self.assertEqual(r.status_code, 401)

    def test_valid_token_can_call_mock_qa(self):
        iid, token = self._issue()
        r = self.client.post(
            "/api/qa/ask",
            json={"question": "小兔子是什么？", "provider": "mock", "asset": {"assetId": "sticker_rabbit_demo", "nameZh": "小兔子"}},
            headers=self._auth_headers(iid, token),
        )
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body.get("ok"))

    def test_install_rate_limit(self):
        iid, token = self._issue()
        headers = self._auth_headers(iid, token)
        last = None
        for _ in range(6):
            last = self.client.post(
                "/api/qa/ask",
                json={"question": "hi", "provider": "mock"},
                headers=headers,
            )
        self.assertIsNotNone(last)
        assert last is not None
        self.assertEqual(last.status_code, 429)

    def test_global_fuse(self):
        # Each install allows 5; global hour max 8 → fuse after ~8 paid calls across installs
        statuses = []
        for _ in range(3):
            iid, token = self._issue()
            headers = self._auth_headers(iid, token)
            for _ in range(4):
                r = self.client.post(
                    "/api/qa/ask",
                    json={"question": "hi", "provider": "mock"},
                    headers=headers,
                )
                statuses.append(r.status_code)
                if r.status_code == 429:
                    body = r.get_json()
                    # GLOBAL_FUSE or RATE_LIMITED both map to UNKNOWN
                    self.assertEqual(body["error"]["code"], "UNKNOWN")
                    return
        self.fail(f"expected fuse/rate limit, statuses={statuses}")

    def test_health_open_without_token(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json().get("ok"))


if __name__ == "__main__":
    unittest.main()
