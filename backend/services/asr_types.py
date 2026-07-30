"""统一 ASR 返回结构（对应规范 AsrResult + SharedError）。"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

AsrProviderName = Literal["qwen_cloud_http", "qwen_cloud_realtime", "qwen_local", "mock"]


class AsrResult(TypedDict, total=False):
    transcript: str
    provider: AsrProviderName
    durationMs: int
    confidence: float
    requestId: str
    latencyMs: int
    empty: bool


class SharedError(TypedDict, total=False):
    code: str
    message: str
    retryable: bool
    details: dict[str, Any]


# SXY 可依赖的成功态固定字段（缺一不可）
ASR_RESULT_REQUIRED_FIELDS = (
    "transcript",
    "provider",
    "durationMs",
    "latencyMs",
    "empty",
)


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
    result: dict[str, Any] = {
        "transcript": text,
        "provider": provider,
        "durationMs": int(duration_ms or 0),
        "latencyMs": int(latency_ms or 0),
        "empty": text == "",
        "requestId": request_id or "",
    }
    if confidence is not None:
        result["confidence"] = confidence
    return {"ok": True, "result": result}


def err_result(
    *,
    code: str,
    message: str,
    retryable: bool = True,
    provider: AsrProviderName | str = "qwen_cloud_http",
    details: Optional[dict[str, Any]] = None,
    latency_ms: int = 0,
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
        # 失败时也尽量带回耗时，方便统计
        "latencyMs": int(latency_ms or 0),
    }


def contract_doc() -> dict[str, Any]:
    return {
        "version": "step3",
        "successShape": {
            "ok": True,
            "result": {
                "transcript": "string 识别文本",
                "provider": "qwen_cloud_http | mock | ...",
                "durationMs": "number 音频时长（毫秒，能取到则填）",
                "latencyMs": "number 请求耗时（毫秒）",
                "empty": "boolean 是否空文本（SXY 不得把 empty=true 交给 DeepSeek）",
                "requestId": "string 可选",
                "confidence": "number 可选",
            },
        },
        "errorShape": {
            "ok": False,
            "provider": "string",
            "error": {
                "code": "string",
                "message": "string",
                "retryable": "boolean",
                "details": "object 可选",
            },
            "latencyMs": "number",
        },
        "requiredResultFields": list(ASR_RESULT_REQUIRED_FIELDS),
    }
