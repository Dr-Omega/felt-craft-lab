"""TTS 成功结果对齐共享 Contracts TtsResult（audioUrl 须为 ResourceRef）。"""

from __future__ import annotations

from typing import Any, Optional

from services.shared_error_map import fail, ok


def ok_tts(
    *,
    audio_url: str,
    cache_hit: bool,
    request_id: str = "",
    **_ignored: Any,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "audioUrl": audio_url,
        "cacheHit": bool(cache_hit),
    }
    rid = (request_id or "").strip()
    if rid:
        result["requestId"] = rid
    return ok(result)


def err_tts(
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


TTS_ERROR_CODES = [
    {"code": "INVALID_ARGUMENT", "message": "参数无效", "retryable": False},
    {"code": "TTS_TIMEOUT", "message": "语音生成超时", "retryable": True},
    {"code": "UNKNOWN", "message": "语音服务暂时不可用", "retryable": True},
]
