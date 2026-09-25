from __future__ import annotations

import os
import sys
import unittest
import uuid
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AI_SESSION_HMAC_SECRET", "test-session-hmac-secret-not-for-prod")

from services.story_rewrite_service import _build_system_prompt, _extract_json, rewrite_story  # noqa: E402


CONTEXT = {
    "workId": "work-001",
    "completionStatus": "completed",
    "artworkImageRef": "felt-resource://preview/work-001.png",
    "background": {"name": "月夜花园"},
    "subject": {"name": "小兔子"},
    "stickers": [{"name": "灯笼"}],
}


class _Response:
    status_code = 200

    def json(self):
        return {
            "id": "request-for-test",
            "choices": [
                {
                    "message": {
                        "content": '{"title":"小兔子的月夜花园","storyText":"我把小兔子放在月夜花园，因为它要找朋友。"}'
                    }
                }
            ],
        }


class StoryRewriteServiceTests(unittest.TestCase):
    def test_prompt_requires_a_source_only_semantic_check_before_rewrite(self):
        prompt = _build_system_prompt({"background": "月夜花园", "subject": "小兔子", "stickers": ["灯笼"]})
        self.assertIn("内部逐项核对候选稿是否只来自孩子原话", prompt)
        self.assertIn("核心人物、地点、行动或事件必须靠猜测", prompt)
        self.assertIn("语序整理、连接词和轻微情绪润色不算新增情节", prompt)

    def test_prompt_uses_the_confirmed_child_friendly_person_label_list(self):
        prompt = _build_system_prompt({"background": "月夜花园", "subject": "小兔子", "stickers": ["灯笼"]})
        self.assertIn("笨蛋、傻瓜改为“小迷糊”", prompt)
        self.assertIn("坏蛋改为“不太友好的家伙”", prompt)
        self.assertIn("讨厌鬼改为“不太友好的小伙伴”", prompt)
        self.assertIn("东西坏了", prompt)

    def test_extracts_ready_for_review_title_and_story_text(self):
        value = _extract_json('说明：{"title":"标题","storyText":"正文"}')
        self.assertEqual(value, {"status": "ready_for_review", "title": "标题", "storyText": "正文"})

    def test_extracts_conservative_needs_more_input_questions(self):
        value = _extract_json('{"status":"needs_more_input","followUpQuestions":["小兔子在做什么呢？","后来发生了什么呢？"]}')
        self.assertEqual(
            value,
            {
                "status": "needs_more_input",
                "followUpQuestions": ["小兔子在做什么呢？", "后来发生了什么呢？"],
            },
        )

    def test_invalid_context_is_rejected_before_network(self):
        with mock.patch("services.story_rewrite_service.requests.post") as post:
            result = rewrite_story(work_id="work-001", text="小兔子找朋友。", context={})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        post.assert_not_called()

    def test_returns_existing_draft_shape_from_qwen_response(self):
        with mock.patch.dict(os.environ, {"QWEN_ASR_API_KEY": "test-key"}, clear=False):
            with mock.patch("services.story_rewrite_service.requests.post", return_value=_Response()) as post:
                result = rewrite_story(work_id="work-001", text="小兔子在月夜花园找朋友。", context=CONTEXT)
        self.assertTrue(result["ok"])
        self.assertEqual(
            result["result"],
            {
                "workId": "work-001",
                "status": "ready_for_review",
                "suggestedTitle": "小兔子的月夜花园",
                "suggestedStoryText": "我把小兔子放在月夜花园，因为它要找朋友。",
            },
        )
        self.assertEqual(post.call_args.kwargs["json"]["model"], os.getenv("QWEN_STORY_MODEL", "qwen3.8-flash"))

    def test_returns_needs_more_input_without_generating_a_story(self):
        response = _Response()
        response.json = lambda: {
            "choices": [{"message": {"content": '{"status":"needs_more_input","followUpQuestions":["小兔子在做什么呢？","后来发生了什么呢？"]}'}}]
        }
        with mock.patch.dict(os.environ, {"QWEN_ASR_API_KEY": "test-key"}, clear=False):
            with mock.patch("services.story_rewrite_service.requests.post", return_value=response):
                result = rewrite_story(work_id="work-001", text="小兔子很开心。", context=CONTEXT)
        self.assertEqual(
            result,
            {
                "ok": True,
                "result": {
                    "workId": "work-001",
                    "status": "needs_more_input",
                    "followUpQuestions": ["小兔子在做什么呢？", "后来发生了什么呢？"],
                },
            },
        )


class StoryRewriteEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import app  # noqa: WPS433

        cls.client = app.test_client()

    def _headers(self) -> dict[str, str]:
        installation_id = str(uuid.uuid4())
        response = self.client.post("/api/session/token", json={"installationId": installation_id})
        self.assertEqual(response.status_code, 200)
        token = response.get_json()["result"]["token"]
        return {"Authorization": f"Bearer {token}", "X-Felt-Installation-Id": installation_id}

    def test_protected_route_returns_story_card_draft_envelope(self):
        draft = {
            "ok": True,
            "result": {
                "workId": "work-001",
                "status": "ready_for_review",
                "suggestedTitle": "小兔子的月夜花园",
                "suggestedStoryText": "小兔子在月夜花园找朋友。",
            },
        }
        with mock.patch("app.rewrite_story", return_value=draft):
            response = self.client.post(
                "/api/story/rewrite",
                json={"workId": "work-001", "text": "小兔子在月夜花园找朋友。", "context": CONTEXT},
                headers=self._headers(),
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), draft)

    def test_protected_route_preserves_needs_more_input_draft(self):
        draft = {
            "ok": True,
            "result": {
                "workId": "work-001",
                "status": "needs_more_input",
                "followUpQuestions": ["小兔子在做什么呢？", "后来发生了什么呢？"],
            },
        }
        with mock.patch("app.rewrite_story", return_value=draft):
            response = self.client.post(
                "/api/story/rewrite",
                json={"workId": "work-001", "text": "小兔子很开心。", "context": CONTEXT},
                headers=self._headers(),
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), draft)


if __name__ == "__main__":
    unittest.main()
