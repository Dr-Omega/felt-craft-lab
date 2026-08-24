"""Volcengine Ark Seedream 4.5 image provider.

This adapter intentionally speaks only the documented Seedream image API shape;
it does not leak Stable Diffusion knobs into Seedream requests.
"""

from __future__ import annotations

import base64
import os
from typing import Any, Sequence

import requests

from services.image_types import ImageProviderError, ImageProviderResult

from .base import ImageProvider

DEFAULT_ARK_IMAGE_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
DEFAULT_TIMEOUT_SECONDS = 90


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip().strip('"').strip("'")


class SeedreamArkImageProvider(ImageProvider):
    name = "seedream_ark"

    def __init__(self, *, session: Any = requests) -> None:
        self._session = session

    def generate(
        self,
        *,
        positive_prompt: str,
        model: str,
        width: int,
        height: int,
        reference_images: Sequence[str] | None = None,
    ) -> ImageProviderResult:
        api_key = _env("ARK_API_KEY")
        if not api_key:
            raise ImageProviderError("IMAGE_MISSING_API_KEY")
        prompt = (positive_prompt or "").strip()
        if not prompt:
            raise ImageProviderError("IMAGE_MISSING_PROMPT")
        images = list(reference_images or [])
        if len(images) != 8:
            raise ImageProviderError("IMAGE_REFERENCE_INVALID")
        if any(not image.startswith("data:image/") for image in images):
            raise ImageProviderError("IMAGE_REFERENCE_INVALID")

        payload = {
            "model": model,
            "prompt": prompt,
            "image": images,
            "size": f"{width}x{height}",
            "sequential_image_generation": "disabled",
            "response_format": "b64_json",
            "watermark": False,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        url = _env("ARK_IMAGE_API_BASE", DEFAULT_ARK_IMAGE_URL).rstrip("/")
        timeout = float(_env("ARK_IMAGE_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
        try:
            response = self._session.post(url, headers=headers, json=payload, timeout=timeout)
        except requests.Timeout as exc:
            raise ImageProviderError("IMAGE_TIMEOUT") from exc
        except requests.RequestException as exc:
            raise ImageProviderError("IMAGE_NETWORK_ERROR") from exc

        try:
            body = response.json()
        except ValueError as exc:
            raise ImageProviderError("IMAGE_UPSTREAM_ERROR") from exc
        if response.status_code >= 400 or body.get("error"):
            raise ImageProviderError("IMAGE_UPSTREAM_ERROR")
        data = body.get("data")
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise ImageProviderError("IMAGE_BAD_RESPONSE")
        encoded = data[0].get("b64_json")
        if not isinstance(encoded, str) or not encoded:
            raise ImageProviderError("IMAGE_BAD_RESPONSE")
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise ImageProviderError("IMAGE_BAD_RESPONSE") from exc
        if not image_bytes:
            raise ImageProviderError("IMAGE_BAD_RESPONSE")
        request_id = str(response.headers.get("X-Request-Id") or body.get("request_id") or "")
        return ImageProviderResult(image_bytes=image_bytes, mime_type="image/*", request_id=request_id)
