"""Mock TTS：返回短 audioBase64，由 Electron Main 物化为 felt-resource://audio/dynamic/..."""

from __future__ import annotations

from typing import Any

from services.tts_types import ok_tts_bytes

from .base import TtsProvider

# Minimal stand-in bytes (not a real MP3 frame; sufficient for materialize path smoke).
_MOCK_AUDIO = b"ID3\x03\x00\x00\x00\x00\x00\x00felt-mock-tts"


class MockTtsProvider(TtsProvider):
    name = "mock"

    def synthesize(self, *, text: str, voice_purpose: str = "qa_answer") -> dict[str, Any]:
        _ = text, voice_purpose
        return ok_tts_bytes(
            audio_bytes=_MOCK_AUDIO,
            cache_hit=False,
            request_id="a" * 32,
        )
