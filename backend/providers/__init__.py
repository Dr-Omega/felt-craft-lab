"""ASR Provider 抽象：页面不依赖具体模型，只依赖统一结果。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional


class AsrProvider(ABC):
    name: str = "base"

    @abstractmethod
    def transcribe(
        self,
        *,
        audio_bytes: Optional[bytes] = None,
        audio_url: Optional[str] = None,
        mime_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> dict[str, Any]:
        """返回 ok_result(...) 或 err_result(...)。"""
        raise NotImplementedError
