"""DeepSeek structured-output retry regressions without real provider traffic."""

from __future__ import annotations

import copy
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from providers.qa.deepseek_provider import (  # noqa: E402
    ANSWER_TOO_LONG,
    DANGEROUS_OUTPUT_REASON,
    EMPTY_CONTENT,
    INVALID_JSON,
    INVALID_SAFETY_ACTION,
    MISSING_ANSWER,
    NON_OBJECT_JSON,
    NO_JSON_OBJECT,
    DeepSeekQaProvider,
    _parse_model_content,
)


def upstream_response(content: object, finish_reason: str = "stop", request_id: str = "req-test") -> mock.Mock:
    response = mock.Mock(status_code=200)
    response.json.return_value = {
        "id": request_id,
        "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
    }
    return response


class DeepSeekJsonRetryTests(unittest.TestCase):
    asset = {"assetId": "sticker_mooncake_001", "nameZh": "月饼"}

    def ask_with(self, responses: list[mock.Mock], *, question: str = "月饼有什么故事？", history=None):
        with mock.patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key-never-log"}, clear=False):
            with mock.patch("providers.qa.deepseek_provider.requests.post", side_effect=responses) as post:
                result = DeepSeekQaProvider().ask(question=question, asset=self.asset, history=history)
        self.assertLessEqual(post.call_count, 2)
        return result, post

    def test_QA_JSON_01_valid_json_returns_after_one_call(self):
        result, post = self.ask_with([upstream_response('{"answer":"月饼圆圆的。","safetyAction":"allow"}')])
        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["answer"], "月饼圆圆的。")
        self.assertEqual(post.call_count, 1)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertIn("只输出一个 JSON 对象", payload["messages"][0]["content"])

    def test_QA_JSON_02_empty_content_retries_once(self):
        result, post = self.ask_with([upstream_response(""), upstream_response('{"answer":"第二次正常。","safetyAction":"allow"}')])
        self.assertEqual(result["result"]["answer"], "第二次正常。")
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args_list[1].kwargs["json"]["temperature"], 0.2)

    def test_QA_JSON_03_plain_text_retries_once(self):
        result, post = self.ask_with([upstream_response("这是普通文本"), upstream_response('{"answer":"恢复正常。","safetyAction":"allow"}')])
        self.assertEqual(result["result"]["answer"], "恢复正常。")
        self.assertEqual(post.call_count, 2)

    def test_QA_JSON_04_invalid_json_retries_once(self):
        result, post = self.ask_with([upstream_response('{"answer":'), upstream_response('{"answer":"恢复正常。","safetyAction":"allow"}')])
        self.assertEqual(result["result"]["answer"], "恢复正常。")
        self.assertEqual(post.call_count, 2)

    def test_QA_JSON_05_missing_answer_retries_once(self):
        result, post = self.ask_with([upstream_response('{"safetyAction":"allow"}'), upstream_response('{"answer":"有答案。","safetyAction":"allow"}')])
        self.assertEqual(result["result"]["answer"], "有答案。")
        self.assertEqual(post.call_count, 2)

    def test_QA_JSON_06_invalid_safety_action_retries_once(self):
        result, post = self.ask_with([upstream_response('{"answer":"x","safetyAction":"maybe"}'), upstream_response('{"answer":"安全答案。","safetyAction":"allow"}')])
        self.assertEqual(result["result"]["answer"], "安全答案。")
        self.assertEqual(post.call_count, 2)

    def test_QA_JSON_07_two_structural_failures_return_safe_redirect(self):
        result, post = self.ask_with([upstream_response("not json"), upstream_response("still not json")])
        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["safetyAction"], "redirect")
        self.assertEqual(post.call_count, 2)

    def test_QA_JSON_08_dangerous_output_rejects_without_retry(self):
        result, post = self.ask_with([upstream_response('{"answer":"请访问 https://evil.example","safetyAction":"allow"}')])
        self.assertEqual(result["result"]["safetyAction"], "reject")
        self.assertEqual(post.call_count, 1)

    def test_QA_JSON_09_valid_redirect_is_preserved_without_retry(self):
        result, post = self.ask_with([upstream_response('{"answer":"我们换个安全的话题吧。","safetyAction":"redirect"}')])
        self.assertEqual(result["result"], {"answer": "我们换个安全的话题吧。", "safetyAction": "redirect", "requestId": "req-test"})
        self.assertEqual(post.call_count, 1)

    def test_QA_JSON_10_valid_reject_is_preserved_without_retry(self):
        result, post = self.ask_with([upstream_response('{"answer":"这个问题不适合继续聊。","safetyAction":"reject"}')])
        self.assertEqual(result["result"]["safetyAction"], "reject")
        self.assertEqual(post.call_count, 1)

    def test_QA_JSON_11_finish_reason_length_retries_once(self):
        result, post = self.ask_with([
            upstream_response('{"answer":"partial","safetyAction":"allow"}', finish_reason="length"),
            upstream_response('{"answer":"完整答案。","safetyAction":"allow"}'),
        ])
        self.assertEqual(result["result"]["answer"], "完整答案。")
        self.assertEqual(post.call_count, 2)

    def test_QA_JSON_12_content_filter_does_not_retry(self):
        result, post = self.ask_with([upstream_response("", finish_reason="content_filter")])
        self.assertEqual(result["result"]["safetyAction"], "reject")
        self.assertEqual(post.call_count, 1)

    def test_unknown_finish_reason_is_conservative_without_retry(self):
        result, post = self.ask_with([upstream_response('{"answer":"x","safetyAction":"allow"}', finish_reason="unexpected")])
        self.assertEqual(result["result"]["safetyAction"], "redirect")
        self.assertEqual(post.call_count, 1)

    def test_http_auth_error_does_not_enter_structural_retry(self):
        response = upstream_response('{"answer":"x","safetyAction":"allow"}')
        response.status_code = 401
        result, post = self.ask_with([response])
        self.assertFalse(result["ok"])
        self.assertEqual(post.call_count, 1)

    def test_QA_JSON_13_twelve_history_messages_are_preserved_without_mutation(self):
        history = [
            {"role": role, "content": f"{role}-{turn}"}
            for turn in range(6)
            for role in ("user", "assistant")
        ]
        original = copy.deepcopy(history)
        result, post = self.ask_with([
            upstream_response("not valid json"),
            upstream_response('{"answer":"第七轮。","safetyAction":"allow"}'),
        ], history=history)
        self.assertTrue(result["ok"])
        self.assertEqual(post.call_count, 2)
        self.assertEqual(history, original)
        for call in post.call_args_list:
            sent = call.kwargs["json"]["messages"]
            self.assertEqual(sent[1:-1], original)

    def test_QA_JSON_14_logs_reason_without_credentials_or_conversation_text(self):
        question = "question-must-not-appear"
        history = [{"role": "user", "content": "history-must-not-appear"}]
        with self.assertLogs("providers.qa.deepseek_provider", level="WARNING") as captured:
            result, post = self.ask_with([upstream_response("plain text"), upstream_response("plain text")], question=question, history=history)
        self.assertEqual(result["result"]["safetyAction"], "redirect")
        self.assertEqual(post.call_count, 2)
        log_text = "\n".join(captured.output)
        self.assertIn("reason=NO_JSON_OBJECT", log_text)
        self.assertIn("attempt=1", log_text)
        self.assertIn("attempt=2", log_text)
        for secret in ("test-key-never-log", "Authorization", question, history[0]["content"]):
            self.assertNotIn(secret, log_text)

    def test_QA_JSON_15_any_turn_makes_at_most_two_provider_calls(self):
        _, post = self.ask_with([upstream_response('{"answer":'), upstream_response('{"answer":')])
        self.assertLessEqual(post.call_count, 2)

    def test_parser_reason_matrix_keeps_structural_and_safety_failures_distinct(self):
        cases = {
            "": EMPTY_CONTENT,
            "plain text": NO_JSON_OBJECT,
            '{"answer":': INVALID_JSON,
            "[]": NON_OBJECT_JSON,
            '{"safetyAction":"allow"}': MISSING_ANSWER,
            '{"answer":"ok","safetyAction":"maybe"}': INVALID_SAFETY_ACTION,
            '{"answer":"' + ("x" * 301) + '","safetyAction":"allow"}': ANSWER_TOO_LONG,
            '{"answer":"https://unsafe.example","safetyAction":"allow"}': DANGEROUS_OUTPUT_REASON,
        }
        for content, reason in cases.items():
            with self.subTest(reason=reason):
                self.assertEqual(_parse_model_content(content, self.asset).reason, reason)


if __name__ == "__main__":
    unittest.main()
