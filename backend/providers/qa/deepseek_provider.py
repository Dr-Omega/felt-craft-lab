"""DeepSeek 儿童适龄问答 Provider。"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import requests

from services.qa_types import err_qa, ok_qa

from .base import QaProvider

DEFAULT_BASE = "https://api.deepseek.com"
MODEL = "deepseek-chat"

# 明显越界关键词（本地先挡一层；模型侧还有 system prompt）
REJECT_PATTERNS = [
    r"自杀",
    r"色情",
    r"暴力杀人",
    r"炸弹",
    r"毒品",
    r"赌博",
]


def _build_system_prompt(asset: dict[str, Any]) -> str:
    name = asset.get("nameZh") or "当前贴纸"
    intro = asset.get("introZh") or ""
    theme = asset.get("themeId") or "美育手工"
    return f"""你是「不织布工坊」里的儿童美育小助手，服务对象是小学生和家长。
请用简短、友好、安全的中文回答（一般 2～4 句，不超过 120 字）。

当前素材：
- 名称：{name}
- 介绍：{intro}
- 主题：{theme}

硬性规则：
1. 回答必须尽量围绕当前素材的造型、颜色、文化或手工用法。
2. 不要讲恐怖、色情、暴力、仇恨、成人不宜内容。
3. 若问题跑题（如要作业答案、股票、成人话题），温和拉回素材，不要生硬责骂。
4. 不确定时诚实说「我也不太确定」，并给一个安全的手工小建议。
5. 不要输出 Markdown 标题或代码块。

请只输出一个 JSON 对象，不要其它文字：
{{"answer":"给孩子看的回答","safetyAction":"allow|redirect|reject"}}
说明：
- allow：正常回答
- redirect：跑题但已拉回素材
- reject：不适合回答（answer 里给一句温和拒绝）
"""


class DeepSeekQaProvider(QaProvider):
    name = "deepseek"

    def ask(self, *, question: str, asset: dict[str, Any]) -> dict[str, Any]:
        key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not key:
            return err_qa(
                code="QA_MISSING_API_KEY",
                message="未配置 DEEPSEEK_API_KEY",
                retryable=False,
            )

        q = (question or "").strip()
        if not q:
            return err_qa(
                code="QA_MISSING_QUESTION",
                message="问题不能为空",
                retryable=False,
            )

        # 本地硬拦截
        for pat in REJECT_PATTERNS:
            if re.search(pat, q):
                return ok_qa(
                    answer="这个问题我们换个方式聊吧。你更想了解这个贴纸的颜色、形状，还是怎么做成不织布手工呢？",
                    safety_action="reject",
                    latency_ms=0,
                )

        base = (os.getenv("DEEPSEEK_BASE_URL") or DEFAULT_BASE).rstrip("/")
        url = f"{base}/chat/completions"
        payload = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": _build_system_prompt(asset)},
                {"role": "user", "content": q},
            ],
            "temperature": 0.6,
            "max_tokens": 300,
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=45)
        except requests.Timeout:
            return err_qa(code="QA_TIMEOUT", message="回答超时，请重试", retryable=True)
        except requests.RequestException as exc:
            return err_qa(
                code="QA_NETWORK_ERROR",
                message=f"网络异常：{exc}",
                retryable=True,
                details={"exception": type(exc).__name__},
            )

        latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            data = resp.json()
        except ValueError:
            return err_qa(
                code="QA_UPSTREAM_ERROR",
                message="问答服务返回异常",
                retryable=True,
                latency_ms=latency_ms,
                details={"status": resp.status_code},
            )

        if resp.status_code >= 400:
            msg = data.get("error", {}).get("message") if isinstance(data.get("error"), dict) else None
            return err_qa(
                code="QA_UPSTREAM_ERROR",
                message=str(msg or data.get("message") or "问答服务失败"),
                retryable=resp.status_code >= 500,
                latency_ms=latency_ms,
                details={"status": resp.status_code},
            )

        content = ""
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return err_qa(
                code="QA_UPSTREAM_ERROR",
                message="无法解析模型回答",
                retryable=True,
                latency_ms=latency_ms,
            )

        answer, safety = _parse_model_content(content, asset)
        request_id = str(data.get("id") or "")
        return ok_qa(
            answer=answer,
            safety_action=safety,
            request_id=request_id,
            latency_ms=latency_ms,
        )


def _parse_model_content(content: str, asset: dict[str, Any]) -> tuple[str, str]:
    text = (content or "").strip()
    # 尝试提取 JSON
    try:
        # 允许模型包在 ```json 里
        fence = re.search(r"\{[\s\S]*\}", text)
        raw = fence.group(0) if fence else text
        obj = json.loads(raw)
        answer = str(obj.get("answer") or "").strip()
        safety = str(obj.get("safetyAction") or "allow").strip().lower()
        if safety not in {"allow", "redirect", "reject"}:
            safety = "allow"
        if not answer:
            answer = _fallback_answer(asset)
        return answer, safety
    except (json.JSONDecodeError, TypeError, AttributeError):
        # 不是 JSON 就当纯文本
        if not text:
            return _fallback_answer(asset), "allow"
        return text[:200], "allow"


def _fallback_answer(asset: dict[str, Any]) -> str:
    name = asset.get("nameZh") or "这个贴纸"
    return f"「{name}」很适合不织布手工。你可以观察它的颜色和外形，再把它轻轻贴到画布上试试哦。"
