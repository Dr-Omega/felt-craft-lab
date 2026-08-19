"""Image generation wire format: Gateway returns imageBase64; Main materializes preview."""

from __future__ import annotations

import base64
from typing import Any, Optional

from services.shared_error_map import fail, ok


def ok_image_bytes(
    *,
    image_bytes: bytes,
    request_id: str = "",
    content_type: str = "image/png",
    provider: str = "mock",
    **_ignored: Any,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "imageBase64": base64.b64encode(image_bytes).decode("ascii"),
        "contentType": content_type,
        "provider": provider,
    }
    rid = (request_id or "").strip()
    if rid:
        result["requestId"] = rid
    return ok(result)


def err_image(
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


IMAGE_ERROR_CODES = [
    {"code": "INVALID_ARGUMENT", "message": "参数无效", "retryable": False},
    {"code": "UNKNOWN", "message": "生图服务暂时不可用", "retryable": True},
]
