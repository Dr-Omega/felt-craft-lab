"""TTS Provider 抽象。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class TtsProvider(ABC):
    name: str = "base"

    @abstractmethod
    def synthesize(self, *, text: str, voice_purpose: str = "qa_answer") -> dict[str, Any]:
        raise NotImplementedError
