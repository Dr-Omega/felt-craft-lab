"""Deterministic image provider used only by explicit development configuration."""

from __future__ import annotations

import base64
from typing import Sequence

from services.image_types import ImageProviderResult

from .base import ImageProvider

_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/"
    "z8lK6QAAAABJRU5ErkJggg=="
)


class MockImageProvider(ImageProvider):
    name = "mock"

    def generate(self, *, positive_prompt: str, model: str, width: int, height: int, reference_images: Sequence[str] | None = None) -> ImageProviderResult:
        _ = (positive_prompt, model, width, height, reference_images)
        return ImageProviderResult(image_bytes=_ONE_PIXEL_PNG, request_id="mock-image")
