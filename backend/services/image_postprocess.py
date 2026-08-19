"""Normalize generated images to role size + RGBA PNG (Pillow).

Background removal keeps light subject parts (e.g. white panda belly):
1) Treat only border-connected background as removable.
2) Protect a dilated mask grown from clearly non-background cores
   (dark / colored subject pixels), so white regions inside the subject survive.
"""

from __future__ import annotations

import io
from collections import deque
from typing import Any

from PIL import Image, ImageFilter

from services.image_types import err_image


def _channel_median(values: list[int]) -> int:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def _color_dist(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def remove_plain_background(
    image: Image.Image,
    *,
    tolerance: int = 38,
    protect_radius: int = 31,
) -> Image.Image:
    """Remove plain studio backdrop without wiping white parts of the subject."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    if width < 4 or height < 4:
        return rgba

    pixels = rgba.load()
    border_rgb: list[tuple[int, int, int]] = []
    for x in range(width):
        border_rgb.append(pixels[x, 0][:3])
        border_rgb.append(pixels[x, height - 1][:3])
    for y in range(height):
        border_rgb.append(pixels[0, y][:3])
        border_rgb.append(pixels[width - 1, y][:3])

    bg = (
        _channel_median([c[0] for c in border_rgb]),
        _channel_median([c[1] for c in border_rgb]),
        _channel_median([c[2] for c in border_rgb]),
    )
    # Skip matte when the frame border is a solid colorful mock fill.
    if min(bg) < 160 and max(bg) - min(bg) > 40:
        return rgba

    limit = max(30, int(tolerance) * 3)

    def close_to_bg(color: tuple[int, int, int, int] | tuple[int, int, int]) -> bool:
        return _color_dist(color[:3], bg) <= limit

    # Cores: clearly not the backdrop (black panda patches, red ball, outlines…).
    core = Image.new("L", (width, height), 0)
    core_px = core.load()
    for y in range(height):
        for x in range(width):
            if not close_to_bg(pixels[x, y]):
                core_px[x, y] = 255

    # Expand cores so white belly / highlights attached to the subject stay protected.
    radius = protect_radius if protect_radius % 2 == 1 else protect_radius + 1
    radius = max(9, min(radius, 63))
    protected = core.filter(ImageFilter.MaxFilter(radius))
    protected_px = protected.load()

    visited = [[False] * width for _ in range(height)]
    queue: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        if visited[y][x]:
            return
        if protected_px[x, y] >= 128:
            return
        if not close_to_bg(pixels[x, y]):
            return
        visited[y][x] = True
        queue.append((x, y))

    for x in range(width):
        try_seed(x, 0)
        try_seed(x, height - 1)
    for y in range(height):
        try_seed(0, y)
        try_seed(width - 1, y)

    while queue:
        x, y = queue.popleft()
        r, g, b, _a = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < width and 0 <= ny < height) or visited[ny][nx]:
                continue
            if protected_px[nx, ny] >= 128:
                continue
            if not close_to_bg(pixels[nx, ny]):
                continue
            visited[ny][nx] = True
            queue.append((nx, ny))

    return rgba


def normalize_rgba_png(
    image_bytes: bytes,
    *,
    width: int,
    height: int,
) -> dict[str, Any]:
    """Decode JPEG/PNG, matte plain backgrounds, resize/pad to exact RGBA PNG bytes."""
    w = max(64, min(int(width), 1024))
    h = max(64, min(int(height), 1024))
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except Exception:  # noqa: BLE001
        return err_image(code="INVALID_ARGUMENT", message="图片无法打开。")

    # Protect radius scales with source size so white subject islands stay attached.
    protect = 31 if max(image.size) < 700 else 47
    rgba = remove_plain_background(image.convert("RGBA"), protect_radius=protect)
    fitted = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    scale = min(w / max(rgba.width, 1), h / max(rgba.height, 1))
    nw = max(1, int(round(rgba.width * scale)))
    nh = max(1, int(round(rgba.height * scale)))
    resized = rgba.resize((nw, nh), Image.Resampling.LANCZOS)
    offset = ((w - nw) // 2, (h - nh) // 2)
    fitted.paste(resized, offset, resized)

    out = io.BytesIO()
    fitted.save(out, format="PNG", optimize=True)
    return {
        "ok": True,
        "image_bytes": out.getvalue(),
        "width": w,
        "height": h,
    }
