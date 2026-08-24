"""Signature-compatible placeholder; Wan reference images are not enabled in P0."""

from __future__ import annotations

from typing import Sequence

from services.image_types import ImageProviderError, ImageProviderResult

from .base import ImageProvider


class WanDashscopeImageProvider(ImageProvider):
    name = "wan_dashscope"

    def generate(self, *, positive_prompt: str, model: str, width: int, height: int, reference_images: Sequence[str] | None = None) -> ImageProviderResult:
        _ = (positive_prompt, model, width, height, reference_images)
        raise ImageProviderError("IMAGE_PROVIDER_NOT_READY")
