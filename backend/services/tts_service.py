"""TtsService。"""

from __future__ import annotations

import os
from typing import Optional

from providers.tts.minimax_provider import MiniMaxTtsProvider
from providers.tts.mock_provider import MockTtsProvider
from services.guards import tts_provider_allowed
from services.tts_types import err_tts


class UnknownTtsProvider(ValueError):
    pass


class TtsService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        name = (provider_name or os.getenv("TTS_PROVIDER") or "minimax").strip()
        if not tts_provider_allowed(name):
            raise UnknownTtsProvider(name)
        if name == "mock":
            self.provider = MockTtsProvider()
        else:
            self.provider = MiniMaxTtsProvider()

    def synthesize(self, *, text: str, voice_purpose: str = "qa_answer") -> dict:
        try:
            return self.provider.synthesize(text=text, voice_purpose=voice_purpose)
        except Exception:  # noqa: BLE001
            return err_tts(code="TTS_UPSTREAM_ERROR")
