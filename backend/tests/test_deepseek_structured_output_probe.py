"""Local-only parser and history tests for the independent A/B Probe."""

from __future__ import annotations

import copy
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from scripts.deepseek_structured_output_probe import (  # noqa: E402
    CASES,
    EXPECTED_TOOL_NAME,
    build_messages,
    build_request_payload,
    parse_json_message,
    parse_strict_tool_calls,
    print_summary,
    run_case,
    run_turn,
)


def json_response(content: object, finish_reason: str = "stop"):
    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"id": "probe-request", "choices": [{"message": {"content": content}, "finish_reason": finish_reason}]}

    return Response()


def strict_response(tool_calls: object, finish_reason: str = "tool_calls"):
    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"id": "probe-request", "choices": [{"message": {"tool_calls": tool_calls}, "finish_reason": finish_reason}]}

    return Response()


def expected_tool(arguments: str, name: str = EXPECTED_TOOL_NAME) -> dict[str, object]:
    return {"id": "call-1", "type": "function", "function": {"name": name, "arguments": arguments}}


class DeepSeekStructuredOutputProbeTests(unittest.TestCase):
    def test_PROBE_01_json_valid(self):
        parsed = parse_json_message('{"answer":"灯笼圆圆的。","safetyAction":"allow"}')
        self.assertTrue(parsed.success)
        self.assertEqual(parsed.answer, "灯笼圆圆的。")
        self.assertTrue(parsed.fields["schema_valid"])

    def test_PROBE_02_json_whitespace(self):
        parsed = parse_json_message(" \n\t ")
        self.assertFalse(parsed.success)
        self.assertEqual(parsed.failure_reason, "WHITESPACE_ONLY")
        self.assertTrue(parsed.fields["content_is_blank"])

    def test_PROBE_03_json_invalid(self):
        parsed = parse_json_message('{"answer":')
        self.assertFalse(parsed.success)
        self.assertEqual(parsed.failure_reason, "INVALID_JSON")

    def test_PROBE_04_strict_single_expected_tool(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool('{"answer":"月饼圆圆的。","safetyAction":"allow"}')]})
        self.assertTrue(parsed.success)
        self.assertEqual(parsed.safety_action, "allow")
        self.assertEqual(parsed.fields["tool_call_count"], 1)

    def test_PROBE_05_strict_no_tool_call(self):
        parsed = parse_strict_tool_calls({"content": "普通回答"})
        self.assertEqual(parsed.failure_reason, "NO_TOOL_CALL")

    def test_PROBE_06_strict_wrong_tool(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool("{}", name="other_tool")]})
        self.assertEqual(parsed.failure_reason, "WRONG_TOOL")

    def test_PROBE_07_strict_multiple_tools(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool("{}"), expected_tool("{}")]})
        self.assertEqual(parsed.failure_reason, "MULTIPLE_TOOL_CALLS")

    def test_PROBE_08_strict_invalid_arguments_json(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool('{"answer":')]})
        self.assertEqual(parsed.failure_reason, "INVALID_TOOL_ARGUMENTS")

    def test_PROBE_09_strict_missing_answer(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool('{"safetyAction":"allow"}')]})
        self.assertEqual(parsed.failure_reason, "MISSING_ANSWER")

    def test_PROBE_10_strict_invalid_safety_action(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool('{"answer":"好呀","safetyAction":"maybe"}')]})
        self.assertEqual(parsed.failure_reason, "INVALID_SAFETY_ACTION")

    def test_strict_rejects_extra_arguments(self):
        parsed = parse_strict_tool_calls({"tool_calls": [expected_tool('{"answer":"好呀","safetyAction":"allow","extra":"no"}')]})
        self.assertEqual(parsed.failure_reason, "SCHEMA_INVALID")

    def test_PROBE_11_summary_and_saved_record_do_not_contain_api_key(self):
        secret = "probe-api-key-must-not-appear"
        response = json_response('{"answer":"灯笼很喜庆。","safetyAction":"allow"}')
        record = run_turn(
            mode="json", model="deepseek-chat", case_name="lantern", round_number=1,
            asset=CASES["lantern"]["asset"], question="问题也不应显示", history=[],
            api_key=secret, base_url="https://example.invalid", timeout_seconds=1,
            post=lambda *args, **kwargs: response,
        )
        stream = io.StringIO()
        with redirect_stdout(stream):
            print_summary([record])
        output = stream.getvalue()
        self.assertNotIn(secret, output)
        self.assertNotIn("问题也不应显示", output)
        local_response = {key: record[key] for key in ("mode", "model", "case", "round", "answer", "safetyAction") if key in record}
        self.assertNotIn(secret, json.dumps(local_response, ensure_ascii=False))

    def test_PROBE_12_history_accumulates_across_real_turn_shape(self):
        payloads: list[dict[str, object]] = []

        def post(*args, **kwargs):
            payloads.append(copy.deepcopy(kwargs["json"]))
            index = len(payloads)
            return json_response(json.dumps({"answer": f"第{index}答", "safetyAction": "allow"}, ensure_ascii=False))

        records = run_case(
            mode="json", model="deepseek-chat", case_name="lantern", api_key="test-key",
            base_url="https://example.invalid", timeout_seconds=1, post=post,
        )
        self.assertEqual(len(records), 10)
        self.assertEqual([len(payload["messages"]) - 2 for payload in payloads], list(range(0, 20, 2)))
        self.assertEqual(payloads[1]["messages"][-2:], [{"role": "assistant", "content": "第1答"}, {"role": "user", "content": CASES["lantern"]["questions"][1]}])

    def test_PROBE_13_input_history_is_not_mutated(self):
        history = [{"role": "user", "content": "第一问"}, {"role": "assistant", "content": "第一答"}]
        original = copy.deepcopy(history)
        messages = build_messages("第二问", CASES["lantern"]["asset"], history, mode="strict")
        payload = build_request_payload(mode="strict", model="deepseek-v4-flash", asset=CASES["lantern"]["asset"], question="第二问", history=history)
        self.assertEqual(history, original)
        self.assertEqual(messages[1:-1], original)
        self.assertEqual(payload["tool_choice"], {"type": "function", "function": {"name": EXPECTED_TOOL_NAME}})
        self.assertNotIn("response_format", payload)

    def test_each_probe_turn_makes_exactly_one_request(self):
        calls = []

        def post(*args, **kwargs):
            calls.append((args, kwargs))
            return json_response("   ")

        record = run_turn(
            mode="json", model="deepseek-chat", case_name="lantern", round_number=1,
            asset=CASES["lantern"]["asset"], question="第一问", history=[], api_key="test-key",
            base_url="https://example.invalid", timeout_seconds=1, post=post,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(record["failure_reason"], "WHITESPACE_ONLY")


if __name__ == "__main__":
    unittest.main()
