"""统一问答返回结构（对应规范 QaResult + SharedError）。"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

SafetyAction = Literal["allow", "redirect", "reject"]


class QaResult(TypedDict, total=False):
    answer: str
    requestId: str
    safetyAction: SafetyAction
    latencyMs: int


def ok_qa(
    *,
    answer: str,
    safety_action: SafetyAction = "allow",
    request_id: str = "",
    latency_ms: int = 0,
) -> dict[str, Any]:
    return {
        "ok": True,
        "result": {
            "answer": (answer or "").strip(),
            "safetyAction": safety_action,
            "requestId": request_id or "",
            "latencyMs": int(latency_ms or 0),
        },
    }


def err_qa(
    *,
    code: str,
    message: str,
    retryable: bool = True,
    details: Optional[dict[str, Any]] = None,
    latency_ms: int = 0,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if details:
        error["details"] = details
    return {"ok": False, "error": error, "latencyMs": int(latency_ms or 0)}


QA_ERROR_CODES = [
    {"code": "QA_MISSING_API_KEY", "message": "未配置 DeepSeek 密钥", "retryable": False},
    {"code": "QA_MISSING_QUESTION", "message": "问题不能为空", "retryable": False},
    {"code": "QA_MISSING_ASSET", "message": "缺少当前素材信息", "retryable": False},
    {"code": "QA_TIMEOUT", "message": "回答超时，请重试", "retryable": True},
    {"code": "QA_NETWORK_ERROR", "message": "网络异常，请稍后重试", "retryable": True},
    {"code": "QA_UPSTREAM_ERROR", "message": "问答服务暂时不可用", "retryable": True},
    {"code": "QA_REJECTED", "message": "这个问题我们换个聊聊贴纸吧", "retryable": False},
]
