"""统一 TTS 返回结构（对应规范 TtsResult）。"""

from __future__ import annotations

from typing import Any, Optional


def ok_tts(
    *,
    audio_url: str,
    cache_hit: bool,
    request_id: str = "",
    latency_ms: int = 0,
) -> dict[str, Any]:
    return {
        "ok": True,
        "result": {
            "audioUrl": audio_url,
            "cacheHit": bool(cache_hit),
            "requestId": request_id or "",
            "latencyMs": int(latency_ms or 0),
        },
    }


def err_tts(
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
    return {
        "ok": False,
        "error": error,
        "latencyMs": int(latency_ms or 0),
        # 失败时前端仍应保留文字回答（规范要求）
        "fallback": "keep_text_only",
    }


TTS_ERROR_CODES = [
    {"code": "TTS_MISSING_API_KEY", "message": "未配置 MiniMax 密钥", "retryable": False},
    {"code": "TTS_MISSING_GROUP_ID", "message": "未配置 MiniMax GroupId", "retryable": False},
    {"code": "TTS_MISSING_TEXT", "message": "合成文本不能为空", "retryable": False},
    {"code": "TTS_TIMEOUT", "message": "语音生成超时", "retryable": True},
    {"code": "TTS_NETWORK_ERROR", "message": "网络异常", "retryable": True},
    {"code": "TTS_UPSTREAM_ERROR", "message": "语音服务失败", "retryable": True},
]
