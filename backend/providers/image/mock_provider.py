"""Mock image provider: flat color-block PNG from prompt hash (felt-friendly stand-in)."""

from __future__ import annotations

import hashlib
import struct
import zlib
from typing import Any

from services.image_types import ok_image_bytes

from .base import ImageProvider

# Soft felt-like palette (RGB).
_PALETTE = (
    (244, 162, 97),
    (233, 196, 106),
    (42, 157, 143),
    (231, 111, 81),
    (168, 218, 220),
    (144, 190, 109),
)


def solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


class MockImageProvider(ImageProvider):
    name = "mock"

    def generate(
        self,
        *,
        positive_prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
    ) -> dict[str, Any]:
        _ = negative_prompt
        digest = hashlib.sha256(positive_prompt.encode("utf-8")).digest()
        color = _PALETTE[digest[0] % len(_PALETTE)]
        w = max(64, min(int(width), 768))
        h = max(64, min(int(height), 768))
        return ok_image_bytes(
            image_bytes=solid_png(w, h, color),
            request_id=digest.hex()[:32],
            provider=self.name,
        )
