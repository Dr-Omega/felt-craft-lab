"""ASR 成功结果对齐共享 Contracts AsrResult。"""

from __future__ import annotations

from typing import Any, Literal, Optional

from services.shared_error_map import fail, ok

# Contracts ASR_PROVIDERS（mock 仅网关内部，成功结果对外映射为 qwen_cloud_http）
AsrProviderName = Literal["qwen_cloud_http", "qwen_cloud_realtime", "qwen_local"]


def ok_asr(
    *,
    transcript: str,
    provider: str,
    duration_ms: int,
    audio_duration_ms: Optional[int] = None,
    request_id: Optional[str] = None,
    confidence: Optional[float] = None,
) -> dict[str, Any]:
    """
    duration_ms: 端到端请求耗时（Contracts AsrResult.durationMs）
    audio_duration_ms: 录音时长（可选 audioDurationMs）
    """
    text = (transcript or "").strip()
    # mock 对外契约仍使用冻结 Provider 名
    prov = provider if provider in {"qwen_cloud_http", "qwen_cloud_realtime", "qwen_local"} else "qwen_cloud_http"
    result: dict[str, Any] = {
        "transcript": text,
        "provider": prov,
        "durationMs": int(duration_ms or 0),
    }
    if audio_duration_ms is not None:
        result["audioDurationMs"] = int(audio_duration_ms)
    if confidence is not None:
        result["confidence"] = float(confidence)
    rid = (request_id or "").strip()
    if rid:
        result["requestId"] = rid

    if text == "":
        return fail(code="ASR_EMPTY_TRANSCRIPT")
    return ok(result)


def err_asr(
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


# 兼容旧 import 名
err_result = err_asr
ok_result = ok_asr


def contract_doc() -> dict[str, Any]:
    return {
        "version": "contracts-aligned",
        "resultContract": "src/shared/contracts/ai.ts AsrResult",
        "errorContract": "src/shared/contracts/error.ts SharedError",
        "envelope": {"ok": "boolean", "result|error": "AsrResult | SharedError"},
        "notes": [
            "durationMs = 端到端请求耗时；audioDurationMs = 录音时长（可选）",
            "空文本返回 SharedError ASR_EMPTY_TRANSCRIPT，不再输出 empty 字段",
            "requestId 仅在非空时出现",
        ],
    }
