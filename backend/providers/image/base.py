"""Image Provider 抽象。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Sequence


class ImageProvider(ABC):
    name: str = "base"

    @abstractmethod
    def generate(
        self,
        *,
        positive_prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        reference_images: Sequence[str] | None = None,
        model: str = "",
    ) -> dict[str, Any]:
        raise NotImplementedError
