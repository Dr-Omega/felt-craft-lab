"""Mock TTS：返回仓库内合法 ResourceRef 固件。"""

from __future__ import annotations

from typing import Any

from services.tts_types import ok_tts

from .base import TtsProvider


class MockTtsProvider(TtsProvider):
    name = "mock"

    def synthesize(self, *, text: str, voice_purpose: str = "qa_answer") -> dict[str, Any]:
        return ok_tts(
            audio_url="felt-resource://audio/mock-name-zh.wav",
            cache_hit=False,
            request_id="mock-tts",
        )
