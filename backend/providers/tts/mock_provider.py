"""Mock TTS：返回占位说明，不消耗额度。"""

from __future__ import annotations

from typing import Any

from services.tts_types import ok_tts

from .base import TtsProvider


class MockTtsProvider(TtsProvider):
    name = "mock"

    def synthesize(self, *, text: str, voice_purpose: str = "qa_answer") -> dict[str, Any]:
        return ok_tts(
            audio_url="/api/tts/mock-audio",
            cache_hit=False,
            request_id="mock-tts",
            latency_ms=10,
        )
