"""Realtime WebSocket Provider 占位。"""

from __future__ import annotations

from typing import Any, Optional

from services.asr_types import err_result

from .base import AsrProvider


class QwenCloudRealtimeProvider(AsrProvider):
    name = "qwen_cloud_realtime"

    def transcribe(
        self,
        *,
        audio_bytes: Optional[bytes] = None,
        audio_url: Optional[str] = None,
        mime_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> dict[str, Any]:
        return err_result(code="ASR_PROVIDER_NOT_READY")
