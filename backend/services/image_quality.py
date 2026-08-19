"""Felt-friendliness quality gate (Pillow-first rules)."""

from __future__ import annotations

import io
from collections import Counter
from typing import Any, Literal

from PIL import Image

QualityVerdict = Literal["PASS", "WARN", "FAIL"]


def _unique_opaque_colors(image: Image.Image, *, alpha_min: int = 32) -> int:
    """Count distinct RGB colors among sufficiently opaque pixels (quantized)."""
    rgba = image.convert("RGBA")
    # Quantize lightly to avoid counting JPEG/PNG noise as unique colors.
    quantized = rgba.convert("P", palette=Image.Palette.ADAPTIVE, colors=64).convert("RGBA")
    counts: Counter[tuple[int, int, int]] = Counter()
    for r, g, b, a in quantized.getdata():
        if a < alpha_min:
            continue
        counts[(r // 8 * 8, g // 8 * 8, b // 8 * 8)] += 1
    return len(counts)


def _opaque_ratio(image: Image.Image, *, alpha_min: int = 32) -> float:
    rgba = image.convert("RGBA")
    total = rgba.width * rgba.height
    if total <= 0:
        return 0.0
    opaque = sum(1 for *_, a in rgba.getdata() if a >= alpha_min)
    return opaque / total


def _edge_complexity_score(image: Image.Image) -> float:
    """Cheap edge proxy: average absolute neighbor difference on luminance."""
    gray = image.convert("L")
    pixels = list(gray.getdata())
    w, h = gray.size
    if w < 2 or h < 2:
        return 0.0
    total = 0.0
    count = 0
    for y in range(h):
        row = y * w
        for x in range(w - 1):
            total += abs(pixels[row + x] - pixels[row + x + 1])
            count += 1
    for y in range(h - 1):
        for x in range(w):
            total += abs(pixels[y * w + x] - pixels[(y + 1) * w + x])
            count += 1
    return (total / count) if count else 0.0


def evaluate_felt_quality(
    image_bytes: bytes,
    *,
    asset_role: str = "core_pattern",
) -> dict[str, Any]:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except Exception:  # noqa: BLE001
        return {
            "verdict": "FAIL",
            "messages": ["图片损坏，无法检查。"],
            "metrics": {},
        }

    rgba = image.convert("RGBA")
    colors = _unique_opaque_colors(rgba)
    opaque = _opaque_ratio(rgba)
    edge = _edge_complexity_score(rgba)
    messages: list[str] = []
    verdict: QualityVerdict = "PASS"

    # Cloud T2I anti-alias counts as many colors; core pattern is the work, not a cut sticker.
    color_fail = 64 if asset_role == "core_pattern" else 48
    color_warn = 28 if asset_role == "core_pattern" else 22
    if colors > color_fail:
        verdict = "FAIL"
        messages.append("颜色种类太多，不适合剪不织布。")
    elif colors > color_warn:
        verdict = "WARN"
        messages.append("颜色有点多，制作时可能会比较碎。")

    if asset_role == "core_pattern":
        if opaque < 0.08:
            verdict = "FAIL"
            messages.append("图案太淡或几乎看不见。")
    elif asset_role != "background":
        if opaque < 0.08:
            verdict = "FAIL"
            messages.append("图案太淡或几乎看不见。")
        elif opaque > 0.98:
            if verdict == "PASS":
                verdict = "WARN"
            messages.append("几乎铺满整张纸，单独剪下来可能不好用。")

    if edge > 40:
        verdict = "FAIL"
        messages.append("边缘太碎，不适合手工剪贴。")
    elif edge > 22:
        if verdict == "PASS":
            verdict = "WARN"
        messages.append("边缘有点细碎，剪的时候要小心。")

    if not messages:
        messages.append("看起来适合做成不织布图案。")

    return {
        "verdict": verdict,
        "messages": messages,
        "metrics": {
            "width": rgba.width,
            "height": rgba.height,
            "uniqueColors": colors,
            "opaqueRatio": round(opaque, 4),
            "edgeComplexity": round(edge, 3),
        },
    }
