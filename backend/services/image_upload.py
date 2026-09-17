"""Validate and persist user-uploaded images without processing them."""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import BinaryIO

MAX_IMAGE_BYTES = int(os.getenv("UPLOAD_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
ALLOWED_IMAGE_MIME = frozenset({"image/png", "image/jpeg", "image/bmp"})


class ImageUploadError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _detected_extension(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"BM"):
        return ".bmp"
    return None


def _safe_original_name(filename: str | None) -> str:
    name = Path((filename or "").replace("\\", "/")).name.strip()
    if not name or any(ord(char) < 32 for char in name):
        raise ImageUploadError("IMAGE_MISSING_FILE")
    return name[:255]


def save_uploaded_image(
    stream: BinaryIO,
    *,
    filename: str | None,
    mime_type: str | None,
    upload_dir: Path,
) -> dict[str, object]:
    original_name = _safe_original_name(filename)
    normalized_mime = (mime_type or "").split(";", 1)[0].strip().lower()
    if normalized_mime not in ALLOWED_IMAGE_MIME:
        raise ImageUploadError("IMAGE_UNSUPPORTED_MEDIA_TYPE")

    data = stream.read(MAX_IMAGE_BYTES + 1)
    if not data:
        raise ImageUploadError("IMAGE_MISSING_FILE")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageUploadError("PAYLOAD_TOO_LARGE")

    extension = _detected_extension(data)
    expected_mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".bmp": "image/bmp",
    }.get(extension)
    if not extension or expected_mime != normalized_mime:
        raise ImageUploadError("IMAGE_INVALID_CONTENT")

    upload_id = uuid.uuid4().hex
    upload_dir.mkdir(parents=True, exist_ok=True)
    destination = upload_dir / f"{upload_id}{extension}"
    temporary = upload_dir / f".{upload_id}.tmp"
    try:
        temporary.write_bytes(data)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)

    return {
        "uploadId": upload_id,
        "originalName": original_name,
        "mimeType": normalized_mime,
        "sizeBytes": len(data),
    }
