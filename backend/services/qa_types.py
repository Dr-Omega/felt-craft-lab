"""QA 成功结果对齐共享 Contracts QaResult。"""

from __future__ import annotations

from typing import Any, Literal, Optional

from services.shared_error_map import fail, ok

SafetyAction = Literal["allow", "redirect", "reject"]


def ok_qa(
    *,
    answer: str,
    safety_action: SafetyAction = "allow",
    request_id: str = "",
    **_ignored: Any,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "answer": (answer or "").strip(),
        "safetyAction": safety_action,
    }
    rid = (request_id or "").strip()
    if rid:
        result["requestId"] = rid
    return ok(result)


def err_qa(
    *,
    code: str,
    message: Optional[str] = None,
    retryable: Optional[bool] = None,
    request_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
    **_ignored: Any,
) -> dict[str, Any]:
    return fail(
        code=code,
        message=message,
        retryable=retryable,
        request_id=request_id,
        details=details,
    )


QA_ERROR_CODES = [
    {"code": "INVALID_ARGUMENT", "message": "参数无效", "retryable": False},
    {"code": "QA_TIMEOUT", "message": "回答超时", "retryable": True},
    {"code": "QA_BLOCKED", "message": "内容被安全策略拦截", "retryable": False},
    {"code": "UNKNOWN", "message": "服务暂时不可用", "retryable": True},
]
