"""统一 ASR 返回结构（对应规范 AsrResult + 错误信息）。"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

AsrProviderName = Literal["qwen_cloud_http", "qwen_cloud_realtime", "qwen_local", "mock"]


class AsrResult(TypedDict, total=False):
    transcript: str
    provider: AsrProviderName
    durationMs: int
    confidence: float
    requestId: str
    # 扩展：便于验收延迟与排错（不影响 SXY 主字段）
    latencyMs: int
    empty: bool


class SharedError(TypedDict, total=False):
    code: str
    message: str
    retryable: bool
    details: dict[str, Any]


def ok_result(
    *,
    transcript: str,
    provider: AsrProviderName,
    duration_ms: int = 0,
    latency_ms: int = 0,
    request_id: str = "",
    confidence: Optional[float] = None,
) -> dict[str, Any]:
    text = (transcript or "").strip()
    payload: dict[str, Any] = {
        "ok": True,
        "result": {
            "transcript": text,
            "provider": provider,
            "durationMs": int(duration_ms),
            "latencyMs": int(latency_ms),
            "empty": text == "",
        },
    }
    if request_id:
        payload["result"]["requestId"] = request_id
    if confidence is not None:
        payload["result"]["confidence"] = confidence
    return payload


def err_result(
    *,
    code: str,
    message: str,
    retryable: bool = True,
    provider: AsrProviderName | str = "qwen_cloud_http",
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    error: SharedError = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if details:
        error["details"] = details
    return {
        "ok": False,
        "provider": provider,
        "error": error,
    }
