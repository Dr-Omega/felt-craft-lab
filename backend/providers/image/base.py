"""Provider-neutral image generation contract."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Sequence

from services.image_types import ImageProviderResult


class ImageProvider(ABC):
    name: str = "base"

    @abstractmethod
    def generate(
        self,
        *,
        positive_prompt: str,
        model: str,
        width: int,
        height: int,
        reference_images: Sequence[str] | None = None,
    ) -> ImageProviderResult:
        raise NotImplementedError
