"""本地 / 私有化 Provider 占位（弱网或离线时再评估）。"""

from __future__ import annotations

from typing import Any, Optional

from services.asr_types import err_result

from .base import AsrProvider


class QwenLocalProvider(AsrProvider):
    name = "qwen_local"

    def transcribe(
        self,
        *,
        audio_bytes: Optional[bytes] = None,
        audio_url: Optional[str] = None,
        mime_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> dict[str, Any]:
        return err_result(
            code="ASR_PROVIDER_NOT_READY",
            message="qwen_local 尚未接入，当前请使用 qwen_cloud_http",
            retryable=False,
            provider=self.name,
        )
