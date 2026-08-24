"""将网关错误映射为冻结的 SharedError（与 src/shared/contracts/error.ts 对齐）。"""

from __future__ import annotations

from typing import Any, Optional

# 与 SHARED_ERROR_CODES 保持一致（勿自行扩展冻结列表）
SHARED_ERROR_CODES = frozenset(
    {
        "INVALID_ARGUMENT",
        "ASSET_NOT_FOUND",
        "ASSET_NOT_UNLOCKED",
        "ASSET_TYPE_INVALID",
        "ASSET_SNAPSHOT_MISMATCH",
        "SCENE_SCHEMA_UNSUPPORTED",
        "SCENE_VALIDATION_FAILED",
        "SCENE_IMPORT_FAILED",
        "SCENE_MIGRATION_FAILED",
        "DRAFT_SAVE_FAILED",
        "DRAFT_RESTORE_FAILED",
        "PROJECT_NAME_REQUIRED",
        "PREVIEW_EXPORT_FAILED",
        "PROJECT_SAVE_FAILED",
        "MIC_PERMISSION_DENIED",
        "RECORDING_EMPTY",
        "REQUEST_CANCELLED",
        "ASR_TIMEOUT",
        "ASR_EMPTY_TRANSCRIPT",
        "QA_TIMEOUT",
        "QA_BLOCKED",
        "TTS_TIMEOUT",
        "AUDIO_LOAD_FAILED",
        "UNKNOWN",
    }
)

# 内部旧码 → (SharedErrorCode, 默认文案, retryable)
_LEGACY_MAP: dict[str, tuple[str, str, bool]] = {
    "ASR_MISSING_API_KEY": ("UNKNOWN", "语音识别暂时不可用，请稍后重试。", False),
    "ASR_MISSING_AUDIO": ("RECORDING_EMPTY", "缺少有效录音，请重新录制。", False),
    "ASR_TIMEOUT": ("ASR_TIMEOUT", "识别超时，请重试。", True),
    "ASR_NETWORK_ERROR": ("UNKNOWN", "网络异常，请稍后重试。", True),
    "ASR_BAD_RESPONSE": ("UNKNOWN", "识别服务暂时不可用，请稍后重试。", True),
    "ASR_UPSTREAM_ERROR": ("UNKNOWN", "识别服务暂时不可用，请稍后重试。", True),
    "ASR_PROVIDER_NOT_READY": ("INVALID_ARGUMENT", "该识别通道尚未开通。", False),
    "ASR_INTERNAL_ERROR": ("UNKNOWN", "识别服务暂时不可用，请稍后重试。", True),
    "ASR_EMPTY_TRANSCRIPT": ("ASR_EMPTY_TRANSCRIPT", "没有听清内容，请再说一次。", True),
    "QA_MISSING_API_KEY": ("UNKNOWN", "问答服务暂时不可用，请稍后重试。", False),
    "QA_MISSING_QUESTION": ("INVALID_ARGUMENT", "问题不能为空。", False),
    "QA_MISSING_ASSET": ("INVALID_ARGUMENT", "缺少当前素材信息。", False),
    "QA_TIMEOUT": ("QA_TIMEOUT", "回答超时，请重试。", True),
    "QA_NETWORK_ERROR": ("UNKNOWN", "网络异常，请稍后重试。", True),
    "QA_UPSTREAM_ERROR": ("UNKNOWN", "问答服务暂时不可用，请稍后重试。", True),
    "QA_REJECTED": ("QA_BLOCKED", "这个问题我们换个聊聊贴纸吧。", False),
    "TTS_MISSING_API_KEY": ("UNKNOWN", "语音合成暂时不可用，请稍后重试。", False),
    "TTS_MISSING_GROUP_ID": ("UNKNOWN", "语音合成暂时不可用，请稍后重试。", False),
    "TTS_MISSING_TEXT": ("INVALID_ARGUMENT", "合成文本不能为空。", False),
    "TTS_TIMEOUT": ("TTS_TIMEOUT", "语音生成超时，请重试。", True),
    "TTS_NETWORK_ERROR": ("UNKNOWN", "网络异常，请稍后重试。", True),
    "TTS_UPSTREAM_ERROR": ("UNKNOWN", "语音服务暂时不可用，请稍后重试。", True),
    "TTS_BAD_FILE": ("INVALID_ARGUMENT", "无效的音频请求。", False),
    "TTS_NOT_FOUND": ("INVALID_ARGUMENT", "音频不存在。", False),
    "IMAGE_MISSING_API_KEY": ("UNKNOWN", "生图服务暂时不可用，请稍后重试。", False),
    "IMAGE_TIMEOUT": ("UNKNOWN", "画图超时，请再试一次。", True),
    "IMAGE_NETWORK_ERROR": ("UNKNOWN", "网络异常，请稍后重试。", True),
    "IMAGE_UPSTREAM_ERROR": ("UNKNOWN", "生图服务暂时不可用，请稍后重试。", True),
    "IMAGE_REFERENCE_INVALID": ("UNKNOWN", "图片风格配置暂时不可用，请稍后重试。", False),
    "IMAGE_PROFILE_UNAVAILABLE": ("INVALID_ARGUMENT", "该素材类型暂未开通图片生成。", False),
    "IMAGE_BLOCKED": ("UNKNOWN", "这张图没能画出来，请换个说法再试。", False),
    "INVALID_PROVIDER": ("INVALID_ARGUMENT", "不支持的服务通道。", False),
    "RATE_LIMITED": ("UNKNOWN", "请求过于频繁，请稍后再试。", True),
    "GLOBAL_FUSE": ("UNKNOWN", "服务暂时繁忙，请稍后再试。", True),
    "SESSION_MISSING": ("INVALID_ARGUMENT", "会话未建立，请稍后重试。", True),
    "SESSION_INVALID": ("INVALID_ARGUMENT", "会话已失效，请稍后重试。", True),
    "PAYLOAD_TOO_LARGE": ("INVALID_ARGUMENT", "上传内容过大。", False),
    "UNSUPPORTED_MEDIA_TYPE": ("INVALID_ARGUMENT", "不支持的音频格式。", False),
    "TEXT_TOO_LONG": ("INVALID_ARGUMENT", "文本过长。", False),
    "SMOKE_DISABLED": ("INVALID_ARGUMENT", "冒烟接口仅在受保护的开发模式下可用。", False),
}


def shared_error(
    *,
    code: str,
    message: Optional[str] = None,
    retryable: Optional[bool] = None,
    request_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """构造可被 validateSharedError 接受的错误对象。"""
    mapped = _LEGACY_MAP.get(code)
    if mapped:
        final_code, default_msg, default_retry = mapped
    elif code in SHARED_ERROR_CODES:
        final_code, default_msg, default_retry = code, "请求暂时无法完成，请稍后重试。", True
    else:
        final_code, default_msg, default_retry = "UNKNOWN", "请求暂时无法完成，请稍后重试。", True

    err: dict[str, Any] = {
        "code": final_code,
        "message": (message or default_msg).strip() or default_msg,
        "retryable": default_retry if retryable is None else bool(retryable),
    }
    if request_id and str(request_id).strip():
        err["requestId"] = str(request_id).strip()
    safe = _safe_details(details)
    if safe:
        err["details"] = safe
    return err


def fail(
    *,
    code: str,
    message: Optional[str] = None,
    retryable: Optional[bool] = None,
    request_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {
        "ok": False,
        "error": shared_error(
            code=code,
            message=message,
            retryable=retryable,
            request_id=request_id,
            details=details,
        ),
    }


def ok(result: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "result": result}


_SENSITIVE_DETAIL_KEY = (
    "token",
    "secret",
    "signature",
    "sig",
    "password",
    "authorization",
    "cookie",
    "header",
    "recording",
    "audio",
    "question",
    "provider",
    "key",
    "group",
    "api",
    "base_resp",
    "exception",
    "traceback",
    "body",
)


def _safe_details(details: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not details:
        return None
    clean: dict[str, Any] = {}
    for key, value in details.items():
        k = str(key)
        if not k.strip():
            continue
        lower = k.lower()
        if any(s in lower for s in _SENSITIVE_DETAIL_KEY):
            continue
        if value is None or isinstance(value, bool):
            clean[k] = value
        elif isinstance(value, int) and not isinstance(value, bool):
            clean[k] = value
        elif isinstance(value, float) and value == value and value not in (float("inf"), float("-inf")):
            clean[k] = value
        elif isinstance(value, str) and len(value) <= 80:
            clean[k] = value
    return clean or None
