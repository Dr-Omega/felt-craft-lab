"""Mock image provider: subject on light studio backdrop (matte-friendly)."""

from __future__ import annotations

import hashlib
import io
from typing import Any

from PIL import Image, ImageDraw

from services.image_types import ok_image_bytes

from .base import ImageProvider

# Soft felt-like palette (RGB) for the subject blob.
_PALETTE = (
    (244, 162, 97),
    (233, 196, 106),
    (42, 157, 143),
    (231, 111, 81),
    (168, 218, 220),
    (144, 190, 109),
)

# Light gray studio backdrop — border-connected so Pillow matte can clear it.
_BACKDROP = (236, 236, 236)


def subject_on_backdrop_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Draw one flat oval on a light backdrop so normalize_rgba_png yields transparency."""
    image = Image.new("RGB", (width, height), _BACKDROP)
    draw = ImageDraw.Draw(image)
    margin_x = max(8, width // 6)
    margin_y = max(8, height // 6)
    draw.ellipse((margin_x, margin_y, width - margin_x, height - margin_y), fill=rgb)
    # Small dark core so white-adjacent subject protection still has an anchor if colors shift.
    cx, cy = width // 2, height // 2
    r = max(4, min(width, height) // 16)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(40, 40, 40))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


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
            image_bytes=subject_on_backdrop_png(w, h, color),
            request_id=digest.hex()[:32],
            provider=self.name,
        )
