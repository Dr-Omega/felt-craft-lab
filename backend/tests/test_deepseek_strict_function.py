"""Strict Function Calling regressions without real DeepSeek traffic."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import requests

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from providers.qa.deepseek_provider import (  # noqa: E402
    CONTENT_FILTERED,
    DANGEROUS_OUTPUT_REASON,
    EXPECTED_TOOL_NAME,
    FINISH_REASON_LENGTH,
    INVALID_SAFETY_ACTION,
    INVALID_TOOL_ARGUMENTS,
    MISSING_ANSWER,
    MODEL,
    MULTIPLE_TOOL_CALLS,
    NO_TOOL_CALL,
    WRONG_TOOL,
    DeepSeekQaProvider,
    _build_system_prompt,
)


def tool_call(arguments: str, name: str = EXPECTED_TOOL_NAME) -> dict[str, object]:
    return {"id": "call-1", "type": "function", "function": {"name": name, "arguments": arguments}}


def upstream_response(
    *,
    tool_calls: object = None,
    finish_reason: str = "tool_calls",
    status_code: int = 200,
    request_id: str = "req-test",
) -> mock.Mock:
    response = mock.Mock(status_code=status_code)
    response.json.return_value = {
        "id": request_id,
        "choices": [{"message": {"tool_calls": tool_calls}, "finish_reason": finish_reason}],
    }
    return response


class DeepSeekStrictFunctionTests(unittest.TestCase):
    asset = {"assetId": "sticker_lantern_001", "nameZh": "灯笼"}

    def ask_with(self, response_or_error: object, *, base: str = "https://api.deepseek.com"):
        with mock.patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key-never-log", "DEEPSEEK_BASE_URL": base}, clear=False):
            with mock.patch("providers.qa.deepseek_provider.requests.post", side_effect=[response_or_error]) as post:
                result = DeepSeekQaProvider().ask(question="灯笼有什么形状？", asset=self.asset, history=[])
        return result, post

    @staticmethod
    def valid_response(answer: str = "灯笼可以是圆圆的。", action: str = "allow") -> mock.Mock:
        return upstream_response(tool_calls=[tool_call(json.dumps({"answer": answer, "safetyAction": action}, ensure_ascii=False))])

    def assert_fallback_reason(self, response: mock.Mock, reason: str, *, action: str = "redirect"):
        with self.assertLogs("providers.qa.deepseek_provider", level="WARNING") as logs:
            result, post = self.ask_with(response)
        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["safetyAction"], action)
        self.assertEqual(post.call_count, 1)
        self.assertIn(f"reason={reason}", "\n".join(logs.output))

    def test_STRICT_PROVIDER_01_uses_beta_completion_endpoint_without_duplicate_beta(self):
        result, post = self.ask_with(self.valid_response())
        self.assertTrue(result["ok"])
        self.assertEqual(post.call_args.args[0], "https://api.deepseek.com/beta/chat/completions")
        _, beta_post = self.ask_with(self.valid_response(), base="https://api.deepseek.com/beta")
        self.assertEqual(beta_post.call_args.args[0], "https://api.deepseek.com/beta/chat/completions")

    def test_STRICT_PROVIDER_02_uses_v4_flash_with_non_thinking_mode(self):
        _, post = self.ask_with(self.valid_response())
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], MODEL)
        self.assertEqual(payload["thinking"], {"type": "disabled"})

    def test_STRICT_PROVIDER_03_sends_strict_schema(self):
        _, post = self.ask_with(self.valid_response())
        function = post.call_args.kwargs["json"]["tools"][0]["function"]
        self.assertTrue(function["strict"])
        self.assertEqual(function["parameters"]["required"], ["answer", "safetyAction"])
        self.assertFalse(function["parameters"]["additionalProperties"])
        self.assertEqual(function["parameters"]["properties"]["safetyAction"]["enum"], ["allow", "redirect", "reject"])

    def test_STRICT_PROVIDER_04_sends_named_tool_choice(self):
        _, post = self.ask_with(self.valid_response())
        self.assertEqual(post.call_args.kwargs["json"]["tool_choice"], {"type": "function", "function": {"name": EXPECTED_TOOL_NAME}})

    def test_STRICT_PROVIDER_05_parses_valid_tool_call(self):
        result, post = self.ask_with(self.valid_response("红红的灯笼很喜庆。", "allow"))
        self.assertEqual(post.call_count, 1)
        self.assertEqual(result["result"], {"answer": "红红的灯笼很喜庆。", "safetyAction": "allow", "requestId": "req-test"})

    def test_STRICT_PROVIDER_06_no_tool_calls_falls_back_without_retry(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[]), NO_TOOL_CALL)

    def test_STRICT_PROVIDER_07_multiple_tool_calls_falls_back_without_retry(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[tool_call("{}"), tool_call("{}")]), MULTIPLE_TOOL_CALLS)

    def test_STRICT_PROVIDER_08_wrong_function_name_falls_back(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[tool_call("{}", name="wrong_tool")]), WRONG_TOOL)

    def test_STRICT_PROVIDER_09_invalid_arguments_json_falls_back(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[tool_call('{"answer":')]), INVALID_TOOL_ARGUMENTS)

    def test_STRICT_PROVIDER_10_missing_answer_falls_back(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[tool_call('{"safetyAction":"allow"}')]), MISSING_ANSWER)

    def test_STRICT_PROVIDER_11_invalid_safety_action_falls_back(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[tool_call('{"answer":"好呀","safetyAction":"maybe"}')]), INVALID_SAFETY_ACTION)

    def test_strict_extra_field_and_overlong_answer_fall_back(self):
        self.assert_fallback_reason(
            upstream_response(tool_calls=[tool_call('{"answer":"好呀","safetyAction":"allow","extra":"no"}')]),
            INVALID_TOOL_ARGUMENTS,
        )
        self.assert_fallback_reason(
            self.valid_response("x" * 301),
            "ANSWER_TOO_LONG",
        )

    def test_STRICT_PROVIDER_12_dangerous_output_is_locally_rejected(self):
        self.assert_fallback_reason(
            self.valid_response("请访问 https://unsafe.example", "allow"),
            DANGEROUS_OUTPUT_REASON,
            action="reject",
        )

    def test_STRICT_PROVIDER_13_content_filter_is_locally_rejected(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[], finish_reason="content_filter"), CONTENT_FILTERED, action="reject")

    def test_STRICT_PROVIDER_14_length_is_locally_fallen_back(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[], finish_reason="length"), FINISH_REASON_LENGTH)

    def test_STRICT_PROVIDER_15_every_qa_turn_has_at_most_one_http_call(self):
        result, post = self.ask_with(upstream_response(tool_calls=[]))
        self.assertTrue(result["ok"])
        self.assertEqual(post.call_count, 1)

    def test_STRICT_PROVIDER_16_network_error_contract_is_unchanged(self):
        result, post = self.ask_with(requests.RequestException("network"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "UNKNOWN")
        self.assertEqual(post.call_count, 1)

    def test_STRICT_PROVIDER_17_timeout_contract_is_unchanged(self):
        result, post = self.ask_with(requests.Timeout("timeout"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "QA_TIMEOUT")
        self.assertEqual(post.call_count, 1)

    def test_STRICT_PROVIDER_18_http_error_contract_is_unchanged(self):
        response = self.valid_response()
        response.status_code = 401
        result, post = self.ask_with(response)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "UNKNOWN")
        self.assertEqual(post.call_count, 1)

    def test_strict_unknown_finish_reason_is_a_single_call_safe_fallback(self):
        self.assert_fallback_reason(upstream_response(tool_calls=[], finish_reason="unexpected"), "UNKNOWN_FINISH_REASON")

    def test_strict_failure_logs_only_metadata(self):
        question = "question-must-not-appear"
        history = [{"role": "user", "content": "history-must-not-appear"}]
        arguments = '{"answer":"answer-must-not-appear","safetyAction":"maybe"}'
        with mock.patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key-never-log"}, clear=False):
            with mock.patch("providers.qa.deepseek_provider.requests.post", return_value=upstream_response(tool_calls=[tool_call(arguments)])):
                with self.assertLogs("providers.qa.deepseek_provider", level="WARNING") as logs:
                    result = DeepSeekQaProvider().ask(question=question, asset=self.asset, history=history)
        self.assertTrue(result["ok"])
        log_text = "\n".join(logs.output)
        self.assertIn("tool_call_count=1", log_text)
        self.assertIn("arguments_length=", log_text)
        for protected in ("test-key-never-log", "Authorization", question, history[0]["content"], "answer-must-not-appear", arguments):
            self.assertNotIn(protected, log_text)

    def test_prompt_01_second_person_defaults_to_current_asset(self):
        prompt = _build_system_prompt(self.asset)
        self.assertIn("默认在问当前素材", prompt)
        self.assertIn("你有别的名字吗", prompt)

    def test_prompt_02_explicit_assistant_question_remains_supported(self):
        prompt = _build_system_prompt(self.asset)
        self.assertIn("你这个助手", prompt)
        self.assertIn("AI助手", prompt)

    def test_prompt_03_nonwoven_material_scope_is_present(self):
        prompt = _build_system_prompt(self.asset)
        self.assertIn("不织布", prompt)
        self.assertIn("双面胶", prompt)
        self.assertIn("不要主动换成彩纸", prompt)

    def test_prompt_04_avoids_a_fixed_child_address_template(self):
        prompt = _build_system_prompt(self.asset)
        self.assertIn("不要机械地每轮都用“小朋友”开头", prompt)

    def test_prompt_05_has_relationship_identity_boundary(self):
        prompt = _build_system_prompt(self.asset)
        self.assertIn("不接受爸爸、妈妈、恋人或真实家人", prompt)
        self.assertIn("永远陪伴", prompt)


if __name__ == "__main__":
    unittest.main()
