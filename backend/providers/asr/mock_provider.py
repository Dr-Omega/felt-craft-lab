"""Mock Provider：无密钥时也可让 SXY 并行开发。"""

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
            transcript="（Mock）这是一只小兔子贴纸",
            provider="mock",  # type: ignore[arg-type]
            duration_ms=1200,
            latency_ms=15,
            request_id="mock-request",
        )
