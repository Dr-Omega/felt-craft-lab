"""Trusted multipart image validation for the Image-to-Image Gateway path."""

from __future__ import annotations

import base64
import io
import os
from dataclasses import dataclass
from typing import Any

from PIL import Image, UnidentifiedImageError


MAX_IMAGE_INPUT_BYTES = int(os.getenv("MAX_IMAGE_INPUT_BYTES", str(4 * 1024 * 1024)))
MAX_IMAGE_INPUT_DIMENSION = int(os.getenv("MAX_IMAGE_INPUT_DIMENSION", "8192"))
MAX_IMAGE_INPUT_PIXELS = int(os.getenv("MAX_IMAGE_INPUT_PIXELS", str(32 * 1024 * 1024)))

_MIME_TO_FORMAT = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
}
_MAGIC = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}


class ImageInputError(ValueError):
    """A safe, non-path-bearing rejection raised by the upload boundary."""

    def __init__(self, reason: str, *, http_status: int = 400) -> None:
        super().__init__(reason)
        self.http_status = http_status


@dataclass(frozen=True)
class ValidatedImageInput:
    data_uri: str
    mime_type: str
    width: int
    height: int
    size_bytes: int


def validate_uploaded_image(upload: Any) -> ValidatedImageInput:
    """Read one Werkzeug upload safely, returning only a data URI and metadata."""
    if upload is None:
        raise ImageInputError("missing-file")
    mime_type = _normalize_mime(getattr(upload, "mimetype", ""))
    raw = upload.read(MAX_IMAGE_INPUT_BYTES + 1)
    return validate_image_bytes(raw, mime_type=mime_type)


def validate_image_bytes(raw: bytes, *, mime_type: str) -> ValidatedImageInput:
    """Validate actual image bytes; no filesystem paths or URLs are accepted here."""
    mime = _normalize_mime(mime_type)
    if mime not in _MIME_TO_FORMAT:
        raise ImageInputError("unsupported-mime", http_status=415)
    if not raw:
        raise ImageInputError("empty-file")
    if len(raw) > MAX_IMAGE_INPUT_BYTES:
        raise ImageInputError("file-too-large", http_status=413)
    if not raw.startswith(_MAGIC[mime]):
        raise ImageInputError("signature-mismatch")

    try:
        with Image.open(io.BytesIO(raw)) as verified:
            verified.verify()
        with Image.open(io.BytesIO(raw)) as decoded:
            width, height = decoded.size
            image_format = decoded.format
            if width <= 0 or height <= 0:
                raise ImageInputError("invalid-dimensions")
            if width > MAX_IMAGE_INPUT_DIMENSION or height > MAX_IMAGE_INPUT_DIMENSION:
                raise ImageInputError("dimensions-too-large")
            if width * height > MAX_IMAGE_INPUT_PIXELS:
                raise ImageInputError("pixel-count-too-large")
            decoded.load()
    except ImageInputError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageInputError("invalid-image") from exc

    if image_format != _MIME_TO_FORMAT[mime]:
        raise ImageInputError("mime-format-mismatch")
    encoded = base64.b64encode(raw).decode("ascii")
    return ValidatedImageInput(
        data_uri=f"data:{mime};base64,{encoded}",
        mime_type=mime,
        width=width,
        height=height,
        size_bytes=len(raw),
    )


def _normalize_mime(value: str) -> str:
    return (value or "").split(";", 1)[0].strip().lower()
