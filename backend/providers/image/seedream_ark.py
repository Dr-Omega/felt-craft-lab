"""Volcengine Ark Seedream 4.5 provider, returning the existing image envelope."""

from __future__ import annotations

import base64
import os
from typing import Any, Callable, Optional, Sequence

import requests

from services.image_types import err_image, ok_image_bytes

from .base import ImageProvider

DEFAULT_API_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
DEFAULT_TIMEOUT_SECONDS = 90.0


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip().strip('"').strip("'")


class SeedreamArkProvider(ImageProvider):
    name = "seedream_ark"

    def __init__(self, *, post: Optional[Callable[..., Any]] = None) -> None:
        self._post = post or requests.post

    def generate(
        self,
        *,
        positive_prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        reference_images: Sequence[str] | None = None,
        model: str = "",
    ) -> dict[str, Any]:
        _ = negative_prompt  # Seedream has no negative-prompt field.
        key = _env("ARK_API_KEY")
        if not key:
            return err_image(code="IMAGE_MISSING_API_KEY")
        prompt = (positive_prompt or "").strip()
        if not prompt:
            return err_image(code="INVALID_ARGUMENT", message="缺少正向提示词。")
        refs = list(reference_images or [])
        if any(not isinstance(image, str) or not image.startswith("data:image/") for image in refs):
            return err_image(code="IMAGE_REFERENCE_INVALID")
        payload: dict[str, Any] = {
            "model": (model or _env("SEEDREAM_MODEL_ID", "doubao-seedream-4-5-251128")).strip(),
            "prompt": prompt,
            "size": f"{int(width)}x{int(height)}",
            "sequential_image_generation": "disabled",
            "response_format": "b64_json",
            "watermark": False,
        }
        # The provider protocol is generic: the Profile owns the exactly-eight policy.
        if refs:
            payload["image"] = refs
        timeout = float(_env("ARK_IMAGE_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
        try:
            response = self._post(
                _env("ARK_IMAGE_API_BASE", DEFAULT_API_URL).rstrip("/"),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
                timeout=timeout,
            )
        except requests.Timeout:
            return err_image(code="IMAGE_TIMEOUT")
        except requests.RequestException:
            return err_image(code="IMAGE_NETWORK_ERROR")
        try:
            body = response.json()
        except ValueError:
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        if response.status_code >= 400 or (isinstance(body, dict) and body.get("error")):
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        encoded = data[0].get("b64_json")
        if not isinstance(encoded, str) or not encoded:
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (TypeError, ValueError):
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        if not image_bytes:
            return err_image(code="IMAGE_UPSTREAM_ERROR")
        request_id = str(getattr(response, "headers", {}).get("X-Request-Id") or "")
        return ok_image_bytes(image_bytes=image_bytes, request_id=request_id, provider=self.name)
