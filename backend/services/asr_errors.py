"""ASR 对外错误码说明（映射后的 SharedError，供 ops/文档展示）。"""

from __future__ import annotations

# 客户端实际收到的是冻结 SharedErrorCode（见 shared_error_map）
ASR_CLIENT_ERROR_CODES: list[dict] = [
    {"code": "ASR_TIMEOUT", "message": "识别超时，请重试。", "retryable": True},
    {"code": "ASR_EMPTY_TRANSCRIPT", "message": "没有听清内容，请再说一次。", "retryable": True},
    {"code": "RECORDING_EMPTY", "message": "缺少有效录音，请重新录制。", "retryable": False},
    {"code": "INVALID_ARGUMENT", "message": "参数无效或不支持的识别通道。", "retryable": False},
    {"code": "REQUEST_CANCELLED", "message": "请求已取消。", "retryable": False},
    {"code": "UNKNOWN", "message": "识别服务暂时不可用，请稍后重试。", "retryable": True},
]


def list_error_codes() -> list[dict]:
    return list(ASR_CLIENT_ERROR_CODES)
