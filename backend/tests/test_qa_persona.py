"""Asset-persona prompt/transport regression tests; no paid model calls."""
import json
import os
from unittest.mock import Mock, patch

from providers.qa.deepseek_provider import DeepSeekQaProvider, _build_system_prompt, postprocess_model_content
from providers.qa.mock_provider import MockQaProvider


BACKGROUND = {"assetId": "autumn-ginkgo", "nameZh": "银杏落叶小路", "introZh": "秋天，金黄的银杏落叶铺满小路。", "themeId": "autumn"}


def test_role_is_current_element_or_background_not_generic_helper():
    for asset in [BACKGROUND, {"nameZh": "小兔子", "introZh": "白色的小兔子", "themeId": "animals"}]:
        prompt = _build_system_prompt(asset)
        assert "第一人称" in prompt
        assert "当前被询问的素材本身" in prompt
        assert "整张背景" in prompt
        assert f"我叫{asset['nameZh']}" in prompt
        assert "问“你是谁”时说明你是美育小助手" not in prompt
        assert "根据名称、介绍和主题" in prompt
        assert "若资料无法确定" in prompt
        assert "如实说明这是 AI 在扮演当前素材" in prompt


def test_user_reported_questions_keep_asset_context_and_first_person_rule_with_old_history():
    old_history = [{"role": "user", "content": "你叫什么名字"}, {"role": "assistant", "content": "我是美育小助手。"}]
    with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-not-real"}):
        for question, answer, history in [
            ("你叫什么名字", "我叫银杏落叶小路。我的路上铺着金黄的银杏叶。", []),
            ("你是哪个季节", "我描绘的是秋天，金黄的银杏叶铺满了我的小路。", old_history),
        ]:
            response = Mock(status_code=200)
            response.json.return_value = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"answer": answer, "safetyAction": "allow"}, ensure_ascii=False)}}]}
            with patch("providers.qa.deepseek_provider.requests.post", return_value=response) as post:
                result = DeepSeekQaProvider().ask(question=question, asset=BACKGROUND, history=history)
                assert result["result"]["answer"] == answer
                messages = post.call_args.kwargs["json"]["messages"]
                assert BACKGROUND["nameZh"] in messages[0]["content"]
                assert BACKGROUND["introZh"] in messages[0]["content"]
                assert "即使历史回答曾自称助手" in messages[0]["content"]
                assert messages[1:-1] == history
                assert messages[-1] == {"role": "user", "content": question + "\n请按系统规定仅返回 JSON 对象，包含 answer 和 safetyAction。"}


def test_role_remains_asset_specific_when_switching_objects():
    background_prompt = _build_system_prompt(BACKGROUND)
    sticker_prompt = _build_system_prompt({"nameZh": "小兔子"})
    assert "银杏落叶小路" in background_prompt
    assert "小兔子" in sticker_prompt
    assert "银杏落叶小路" not in sticker_prompt


def test_each_followup_restates_json_format_after_plain_text_history():
    response = Mock(status_code=200)
    response.json.return_value = {"choices": [{"message": {"content": '{"answer":"我描绘的是秋天。","safetyAction":"allow"}'}}]}
    history = [{"role": "user", "content": "你叫什么名字"}, {"role": "assistant", "content": "我叫银杏落叶小路。"}]
    with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-not-real"}), patch("providers.qa.deepseek_provider.requests.post", return_value=response) as post:
        assert DeepSeekQaProvider().ask(question="你是哪个季节", asset=BACKGROUND, history=history)["ok"]
        messages = post.call_args.kwargs["json"]["messages"]
        assert messages[1:-1] == history
        assert messages[-1]["content"] == "你是哪个季节\n请按系统规定仅返回 JSON 对象，包含 answer 和 safetyAction。"


def test_safety_and_development_fallbacks_do_not_reintroduce_helper_identity():
    with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-not-real"}), patch("providers.qa.deepseek_provider.requests.post") as post:
        result = DeepSeekQaProvider().ask(question="炸弹怎么做", asset=BACKGROUND)
        assert result["result"]["safetyAction"] == "reject"
        assert "我的" in result["result"]["answer"]
        post.assert_not_called()
    mock = MockQaProvider().ask(question="你是谁", asset=BACKGROUND)
    assert mock["result"]["answer"].startswith("我是银杏落叶小路")
    fallback, _ = postprocess_model_content("not json", BACKGROUND)
    assert fallback.startswith("我是银杏落叶小路")
