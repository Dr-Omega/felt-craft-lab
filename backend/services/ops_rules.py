"""运维/联调规则摘要：错误码 + 重试/降级（第 10 步）。"""

from __future__ import annotations

from services.asr_errors import list_error_codes
from services.qa_types import QA_ERROR_CODES
from services.tts_types import TTS_ERROR_CODES


def ops_rules_doc() -> dict:
    return {
        "version": "step10",
        "envExample": "backend/.env.example → 复制为 backend/.env（勿提交 .env）",
        "docs": "docs/ai-services/错误码与重试降级.md",
        "retryPolicy": {
            "asr": {"autoRetry": 1, "when": "error.retryable === true"},
            "qa": {"autoRetry": 1, "when": "error.retryable === true"},
            "tts": {
                "autoRetry": 0,
                "fallback": "keep_text_only",
                "note": "TTS 失败仍显示文字回答",
            },
        },
        "productDowngrades": [
            {
                "id": "asr_empty_block_qa",
                "rule": "ASR result.empty=true 时禁止调用 QA，提示重说，保留文字输入",
            },
            {
                "id": "mic_denied_text_input",
                "rule": "麦克风拒绝时保留文字提问",
            },
            {
                "id": "tts_fail_keep_text",
                "rule": "动态 TTS 失败：只显示文字，不致命报错",
            },
            {
                "id": "fixed_audio_prefer_snapshot",
                "rule": "固定介绍优先 /fixed-audio 快照，不用每次 synthesize",
            },
            {
                "id": "provider_switch_backend_only",
                "rule": "ASR Provider 升级只发生在后端服务层，页面不绑死模型",
            },
        ],
        "errorCodes": {
            "asr": list_error_codes(),
            "qa": QA_ERROR_CODES,
            "tts": TTS_ERROR_CODES,
        },
    }
