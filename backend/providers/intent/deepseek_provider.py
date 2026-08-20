"""DeepSeek JSON parser: spoken Chinese → GenerationSpec patch. Never Prompt/Provider."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import requests

from services.intent_sanitize import sanitize_generation_spec_patch
from services.intent_types import err_intent, ok_intent_patch

from .base import IntentProvider

DEFAULT_BASE = "https://api.deepseek.com"
MODEL = "deepseek-chat"

SYSTEM_PROMPT = """你是不织布手工工具里的意图整理员。把小朋友的口语整理成绘画需求卡片。
只输出一个 JSON 对象，不要 Markdown，不要解释。

允许的字段只有：
{
  "assetRole": "core_pattern" | "element" | "background",
  "content": {
    "primarySubjects": [{"name": "短中文名词", "attributes": ["只属于它的颜色或外形"]}],
    "actionOrRelationship": "短动作短语",
    "preferredColors": ["仅当颜色还没绑到某个主体时才用"],
    "requiredElements": ["画面还必须有的短名词"],
    "forbiddenElements": ["不要出现的东西"],
    "environmentDescription": "地点或场景短词"
  }
}

硬性规则：
1. 禁止输出 prompt、negativePrompt、provider、model、seed、apiKey、lora。
2. 主体用短名词。手里拿着、抱着的东西也要放进 primarySubjects。
3. 颜色必须跟主体一一对应：例如黑白熊猫、红色皮球，把颜色写进该主体的 attributes，不要把所有颜色摊给每一个主体。
4. 动作写成短短语，例如「坐在地上抱着皮球」。
5. 「不要/别」后面的内容放 forbiddenElements；「必须有/还要有」放 requiredElements。
6. 不确定的字段省略，不要编造。
7. 这是扁平卡通不织布，不要写成写实摄影需求。
8. 若调用方已锁定角色，不要改 assetRole。
9. 若口语只是补充姿势（如「坐在地上」），只填 actionOrRelationship 为该补充；合并时会与已有动作叠加，不要删掉已有的抱/捧等动作。
10. 若调用方给出「当前追问栏」，只填该栏相关字段，其他字段一律省略。
11. 「再加一个X」把 X 放进 primarySubjects，不要清空其它未提及主体（其它主体省略即可）。
12. 补充句不要重复输出已经完整的旧动作；只输出新增部分（例如已有「抱着皮球」时，补充「坐在地上」只输出「坐在地上」）。
13. 颜色追问时若用户说的是姿势/地点而不是颜色，不要填写 preferredColors 或 attributes。
"""

REJECT_PATTERNS = (
    r"自杀",
    r"色情",
    r"暴力杀人",
    r"炸弹",
    r"毒品",
    r"赌博",
)


class DeepSeekIntentProvider(IntentProvider):
    name = "deepseek"

    def parse(
        self,
        *,
        text: str,
        locked_role: str | None,
        pending_field: str | None = None,
    ) -> dict[str, Any]:
        key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not key:
            return err_intent(code="QA_MISSING_API_KEY")

        source = (text or "").strip()
        if not source:
            return err_intent(code="QA_MISSING_QUESTION")

        for pattern in REJECT_PATTERNS:
            if re.search(pattern, source):
                return ok_intent_patch(patch=sanitize_generation_spec_patch({}, locked_role))

        base = (os.getenv("DEEPSEEK_BASE_URL") or DEFAULT_BASE).rstrip("/")
        url = f"{base}/chat/completions"
        user = source[:120]
        if locked_role:
            user = f"锁定角色：{locked_role}\n口语：{user}"
        else:
            user = f"口语：{user}"
        if pending_field:
            user = f"{user}\n当前追问栏：{pending_field}\n只填这一栏相关内容，其他字段省略。"
        payload = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": 400,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=40)
        except requests.Timeout:
            return err_intent(code="QA_TIMEOUT")
        except requests.RequestException:
            return err_intent(code="QA_NETWORK_ERROR")
        _ = int((time.perf_counter() - started) * 1000)

        try:
            data = resp.json()
        except ValueError:
            return err_intent(code="QA_UPSTREAM_ERROR")

        if resp.status_code >= 400:
            return err_intent(code="QA_UPSTREAM_ERROR", retryable=resp.status_code >= 500)

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return err_intent(code="QA_UPSTREAM_ERROR")

        raw = _parse_json_object(content)
        request_id = str(data.get("id") or "").strip()
        return ok_intent_patch(
            patch=sanitize_generation_spec_patch(raw, locked_role),
            request_id=request_id,
        )


def _parse_json_object(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    fence = re.search(r"\{[\s\S]*\}", text)
    if not fence:
        return {}
    try:
        obj = json.loads(fence.group(0))
    except json.JSONDecodeError:
        return {}
    return obj if isinstance(obj, dict) else {}
