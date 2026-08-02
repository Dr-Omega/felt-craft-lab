"""TTS Gateway 线格式与 Electron 冻结 TtsResult 的桥接说明。

Gateway（Flask）对动态 TTS 返回 audioBase64，由 Electron Main 落盘并转成
felt-resource://audio/dynamic/<hash>.mp3 后再交给 Renderer。

Mock 可返回已存在的打包固件 ResourceRef（禁止 Gateway 伪造 dynamic/ 路径）。
"""

from __future__ import annotations

import base64
from typing import Any, Optional

from services.shared_error_map import fail, ok


def ok_tts(
    *,
    audio_url: str,
    cache_hit: bool,
    request_id: str = "",
    **_ignored: Any,
) -> dict[str, Any]:
    """Packaged / mock fixture path (felt-resource://audio/<file>, never dynamic/)."""
    result: dict[str, Any] = {
        "audioUrl": audio_url,
        "cacheHit": bool(cache_hit),
    }
    rid = (request_id or "").strip()
    if rid:
        result["requestId"] = rid
    return ok(result)


def ok_tts_bytes(
    *,
    audio_bytes: bytes,
    cache_hit: bool,
    request_id: str = "",
    content_type: str = "audio/mpeg",
    **_ignored: Any,
) -> dict[str, Any]:
    """Dynamic TTS wire format for Main materialization (no forged ResourceRef)."""
    result: dict[str, Any] = {
        "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
        "contentType": content_type,
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
