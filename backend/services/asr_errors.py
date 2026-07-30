"""ASR 错误码约定（组长维护，SXY 按 code 做提示/重试）。"""

from __future__ import annotations

# code → (默认中文说明, 是否可重试)
ASR_ERROR_CODES: dict[str, tuple[str, bool]] = {
    "ASR_MISSING_API_KEY": ("未配置语音识别密钥", False),
    "ASR_MISSING_AUDIO": ("缺少音频文件或 audioUrl", False),
    "ASR_TIMEOUT": ("识别超时，请重试", True),
    "ASR_NETWORK_ERROR": ("网络异常，请检查网络后重试", True),
    "ASR_BAD_RESPONSE": ("云端返回异常，请重试", True),
    "ASR_UPSTREAM_ERROR": ("云端识别失败", True),
    "ASR_PROVIDER_NOT_READY": ("该识别通道尚未开通", False),
    "ASR_INTERNAL_ERROR": ("服务内部错误", True),
    "ASR_EMPTY_TRANSCRIPT": ("没有听清内容，请再说一次", True),
}


def list_error_codes() -> list[dict]:
    return [
        {"code": code, "message": msg, "retryable": retryable}
        for code, (msg, retryable) in ASR_ERROR_CODES.items()
    ]
