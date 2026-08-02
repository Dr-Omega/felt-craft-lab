"""Mock Provider：开发态并行；成功结果 provider 映射为冻结名 qwen_cloud_http。"""

from __future__ import annotations

from typing import Any, Optional

from services.asr_types import ok_result

from .base import AsrProvider


class MockAsrProvider(AsrProvider):
    name = "mock"

    def transcribe(
        self,
        *,
        audio_bytes: Optional[bytes] = None,
        audio_url: Optional[str] = None,
        mime_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> dict[str, Any]:
        return ok_result(
            transcript="这是一只小兔子贴纸",
            provider="qwen_cloud_http",
            duration_ms=15,
            audio_duration_ms=1200,
            request_id="mock-asr",
        )
