# -*- coding: utf-8 -*-
"""Export named layers from the 160 UI PSD into assets/ui/psd160/."""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PSD = Path(r"C:\Users\xingx\Desktop\160 - 副本.psd")
OUT_DIR = REPO_ROOT / "assets" / "ui" / "psd160"
DESIGN_SIZE = (1920, 1080)

# Layer name in PSD -> output slug (ASCII filename)
LAYER_EXPORTS: dict[str, str] = {
    "图层 2": "background",
    "背景边框装饰": "background-decor",
    "狐狸按钮": "fox-button",
    "白熊按钮": "white-bear-button",
    "棕熊按钮": "brown-bear-button",
    "书本": "book",
    "3d投影屏": "projection-screen",
    "文本框": "text-box",
    "画框": "canvas-frame",
    "保存按钮": "save-button",
}

# Content clip bounds — manifest bbox only, no PNG export
BOUNDS_LAYER_EXPORTS: dict[str, str] = {
    "书本范围": "book-bounds",
    "画板范围": "canvas-bounds",
    "3d投影屏范围": "projection-screen-bounds",
}


def sanitize_slug(value: str) -> str:
    slug = LAYER_EXPORTS.get(value)
    if slug:
        return slug
    slug = re.sub(r"[^\w\-]+", "-", value.strip().lower(), flags=re.UNICODE)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "layer"


def iter_layers(psd: PSDImage):
    def walk(parent):
        for layer in parent:
            yield layer
            if layer.is_group():
                yield from walk(layer)

    yield from walk(psd)


def find_layer(psd: PSDImage, name: str):
    for layer in iter_layers(psd):
        if layer.name == name:
            return layer
    return None


def bbox_dict(bbox) -> dict[str, int]:
    left, top, right, bottom = bbox
    return {
        "left": int(left),
        "top": int(top),
        "right": int(right),
        "bottom": int(bottom),
        "width": int(right - left),
        "height": int(bottom - top),
    }


def sample_text_box_tokens(image: Image.Image) -> dict[str, str]:
    """Sample border + fill colors from the 文本框 layer for CSS tokens."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    border_samples: list[tuple[int, int, int]] = []
    for x in range(width):
        for y in (0, 1, 2, height - 3, height - 2, height - 1):
            border_samples.append(pixels[x, y][:3])
    for y in range(height):
        for x in (0, 1, 2, width - 3, width - 2, width - 1):
            border_samples.append(pixels[x, y][:3])

    fill_samples: list[tuple[int, int, int]] = []
    x0, x1 = int(width * 0.2), int(width * 0.8)
    y0, y1 = int(height * 0.2), int(height * 0.8)
    for y in range(y0, y1, 4):
        for x in range(x0, x1, 4):
            r, g, b, a = pixels[x, y]
            if a > 200:
                fill_samples.append((r, g, b))

    def dominant(samples: list[tuple[int, int, int]]) -> str:
        if not samples:
            return "#fffef8"
        bucket = Counter((r // 8, g // 8, b // 8) for r, g, b in samples)
        r8, g8, b8 = bucket.most_common(1)[0][0]
        return "#{:02x}{:02x}{:02x}".format(r8 * 8 + 4, g8 * 8 + 4, b8 * 8 + 4)

    return {
        "border": dominant(border_samples),
        "fill": dominant(fill_samples),
    }


def export_layer(layer, out_path: Path) -> None:
    if hasattr(layer, "topil"):
        image = layer.topil()
    else:
        image = layer.composite(force=True)
    if image is None:
        raise RuntimeError(f"Layer {layer.name!r} did not rasterize.")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, format="PNG")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export 160 UI PSD layers to PNG.")
    parser.add_argument("--psd", type=Path, default=DEFAULT_PSD, help="Source PSD path")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="Output directory")
    args = parser.parse_args()

    if not args.psd.exists():
        print(f"PSD not found: {args.psd}", file=sys.stderr)
        return 1

    psd = PSDImage.open(args.psd)
    exported: list[dict] = []
    text_box_tokens: dict[str, str] | None = None

    for layer in iter_layers(psd):
        slug = LAYER_EXPORTS.get(layer.name) or BOUNDS_LAYER_EXPORTS.get(layer.name)
        if not slug:
            continue

        export_png = layer.name in LAYER_EXPORTS
        out_file = args.out / f"{slug}.png"
        if export_png:
            export_layer(layer, out_file)
            print(f"exported {layer.name} -> {out_file}")

        entry = {
            "name": layer.name,
            "slug": slug,
            "file": f"{slug}.png" if export_png else None,
            "kind": "bounds" if layer.name in BOUNDS_LAYER_EXPORTS else "asset",
            "bbox": bbox_dict(layer.bbox),
            "visibleInPsd": bool(layer.visible),
        }
        exported.append(entry)
        if not export_png:
            print(f"recorded bounds {layer.name} -> {slug}")

        if slug == "text-box" and export_png:
            image = Image.open(out_file)
            text_box_tokens = sample_text_box_tokens(image)

    manifest = {
        "sourcePsd": str(args.psd),
        "designSize": {"width": DESIGN_SIZE[0], "height": DESIGN_SIZE[1]},
        "layers": exported,
        "textBoxTokens": text_box_tokens
        or {"border": "#7e6244", "fill": "#fffef8"},
    }
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
