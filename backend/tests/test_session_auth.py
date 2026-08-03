"""Session Token、防刷限流与付费保险丝分离回归。"""

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

os.environ["APP_ENV"] = "development"
os.environ["AI_SESSION_HMAC_SECRET"] = "test-session-hmac-secret-not-for-prod"
os.environ["AI_SMOKE_ENABLED"] = "false"
os.environ["AI_INSTALL_RATE_MAX"] = "5"
os.environ["AI_INSTALL_DAY_MAX"] = "100"
os.environ["AI_GLOBAL_MAX_CALLS_PER_HOUR"] = "3"
os.environ["AI_GLOBAL_MAX_CALLS_PER_DAY"] = "100"
os.environ["AI_RATE_MAX"] = "1000"

from services.abuse_limits import (  # noqa: E402
    consume_paid_provider_call,
    global_fuse_counts_for_tests,
    reset_abuse_limits_for_tests,
)
from services.session_auth import issue_session_token, verify_session_token  # noqa: E402
from services.qa_types import ok_qa  # noqa: E402


class SessionAuthUnitTests(unittest.TestCase):
    def test_issue_and_verify(self):
        iid = str(uuid.uuid4())
        issued = issue_session_token(iid, ttl_sec=120)
        claims = verify_session_token(issued["token"], expected_installation_id=iid)
        self.assertIsNotNone(claims)

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

    def test_paid_routes_reject_bad_token(self):
        r = self.client.post(
            "/api/qa/ask",
            json={"question": "hi", "provider": "mock"},
            headers={"Authorization": "Bearer totally.invalid", "X-Felt-Installation-Id": str(uuid.uuid4())},
        )
        self.assertEqual(r.status_code, 401)

    def test_valid_token_can_call_mock_qa(self):
        iid, token = self._issue()
        r = self.client.post(
            "/api/qa/ask",
            json={
                "question": "小兔子是什么？",
                "provider": "mock",
                "asset": {"assetId": "sticker_rabbit_demo", "nameZh": "小兔子"},
            },
            headers=self._auth_headers(iid, token),
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json().get("ok"))

    def test_install_rate_limit_still_applies_to_mock(self):
        iid, token = self._issue()
        headers = self._auth_headers(iid, token)
        last = None
        for _ in range(6):
            last = self.client.post(
                "/api/qa/ask",
                json={"question": "hi", "provider": "mock"},
                headers=headers,
            )
        self.assertEqual(last.status_code, 429)

    def test_illegal_requests_do_not_consume_global_fuse(self):
        iid, token = self._issue()
        headers = self._auth_headers(iid, token)
        before = global_fuse_counts_for_tests()
        for _ in range(5):
            # empty question
            r = self.client.post(
                "/api/qa/ask",
                json={"question": "", "provider": "mock"},
                headers=headers,
            )
            self.assertEqual(r.status_code, 400)
            # bad provider
            r2 = self.client.post(
                "/api/qa/ask",
                json={"question": "hi", "provider": "not-a-real-provider"},
                headers=headers,
            )
            self.assertEqual(r2.status_code, 400)
            # mock success (also must not consume fuse)
            r3 = self.client.post(
                "/api/qa/ask",
                json={"question": "hi", "provider": "mock"},
                headers=headers,
            )
            self.assertIn(r3.status_code, (200, 429))
        after = global_fuse_counts_for_tests()
        self.assertEqual(before, after)

    def test_real_provider_calls_consume_global_fuse(self):
        iid, token = self._issue()
        headers = self._auth_headers(iid, token)

        with mock.patch("services.qa_service.QaService.ask", return_value=ok_qa(answer="ok", safety_action="allow")):
            statuses = []
            for _ in range(5):
                r = self.client.post(
                    "/api/qa/ask",
                    json={
                        "question": "小兔子可以贴在哪里？",
                        "provider": "deepseek",
                        "asset": {"nameZh": "小兔子"},
                    },
                    headers=headers,
                )
                statuses.append(r.status_code)
                if r.status_code == 429:
                    self.assertEqual(r.get_json()["error"]["code"], "UNKNOWN")
                    hour, _ = global_fuse_counts_for_tests()
                    self.assertGreaterEqual(hour, 3)
                    return
        self.fail(f"expected global fuse, statuses={statuses} counts={global_fuse_counts_for_tests()}")

    def test_health_open_without_token(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json().get("ok"))


class PaidFuseUnitTests(unittest.TestCase):
    def setUp(self):
        reset_abuse_limits_for_tests()

    def test_consume_paid_provider_call_trips_fuse(self):
        iid = str(uuid.uuid4())
        for _ in range(3):
            self.assertIsNone(consume_paid_provider_call(iid))
        self.assertEqual(consume_paid_provider_call(iid), "GLOBAL_FUSE")


if __name__ == "__main__":
    unittest.main()
