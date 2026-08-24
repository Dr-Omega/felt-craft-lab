"""Private wire helpers for the image Gateway."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from typing import Any

from services.shared_error_map import fail, ok


class ImageProviderError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ImageProviderResult:
    image_bytes: bytes
    mime_type: str = "image/png"
    request_id: str = ""


def normalize_to_png(result: ImageProviderResult) -> bytes:
    """Normalize provider output at the service boundary, preserving PNG bytes."""
    raw = result.image_bytes
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return raw
    try:
        from PIL import Image  # Pillow is the explicit production dependency.

        with Image.open(io.BytesIO(raw)) as image:
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return output.getvalue()
    except Exception as exc:  # noqa: BLE001
        raise ImageProviderError("IMAGE_NORMALIZE_FAILED") from exc


def quality_gate(png_bytes: bytes) -> str:
    """Current quality gate boundary: reject empty/non-PNG, accept valid PNG input."""
    if len(png_bytes) < 8 or not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ImageProviderError("IMAGE_QUALITY_REJECTED")
    return "accepted"


def ok_image(*, png_bytes: bytes, quality_verdict: str, request_id: str = "") -> dict[str, Any]:
    result: dict[str, Any] = {
        "imageBase64": base64.b64encode(png_bytes).decode("ascii"),
        "contentType": "image/png",
        "qualityVerdict": quality_verdict,
    }
    if request_id:
        result["requestId"] = request_id
    return ok(result)


def err_image(code: str) -> dict[str, Any]:
    return fail(code=code)
