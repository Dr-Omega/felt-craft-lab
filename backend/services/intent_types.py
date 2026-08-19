"""Creation-intent parse wire format: domain patch only, never Prompt/Provider."""

from __future__ import annotations

from typing import Any, Optional

from services.shared_error_map import fail, ok


def ok_intent_patch(*, patch: dict[str, Any], request_id: str = "") -> dict[str, Any]:
    result: dict[str, Any] = {"patch": patch or {}}
    rid = (request_id or "").strip()
    if rid:
        result["requestId"] = rid
    return ok(result)


def err_intent(
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
