# -*- coding: utf-8
"""Crop hand-drawn UI PNGs from 1920x1080 artboards and emit manifest.json."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "assets" / "ui" / "hand-drawn"

# Later batches override earlier entries with the same slug.
SOURCE_BATCHES: list[tuple[Path, dict[str, str]]] = [
    (
        Path(r"C:\Users\xingx\Desktop\新建文件夹 (2)"),
        {
            "按钮-主.png": "btn-primary",
            "按钮-次.png": "btn-secondary",
            "按钮-关闭.png": "btn-close",
            "按钮-圆-撤销.png": "btn-round-undo",
            "按钮-圆-重做.png": "btn-round-redo",
            "按钮-圆-素材盒.png": "btn-round-material",
            "按钮-返回.png": "btn-back",
            "文本框.png": "text-box",
            "文本框-小.png": "text-box-small",
            "素材盒底.png": "material-sheet-bg",
            "背景按钮.png": "background-trigger",
            "输入框.png": "input-field",
        },
    ),
    (
        Path(r"C:\Users\xingx\Desktop\新建文件夹 (3)"),
        {
            "背景.png": "background-trigger",
            "QA面板底.png": "qa-panel-bg",
            "QA输入框.png": "qa-input-field",
            "聊天气泡-问.png": "qa-bubble-question",
            "按钮-发送.png": "btn-send",
            "按钮-语音.png": "btn-voice",
        },
    ),
]


def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    rgba = image.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    minx, miny, maxx, maxy = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 16 and not (r < 20 and g < 20 and b < 20):
                found = True
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if not found:
        return None
    return minx, miny, maxx + 1, maxy + 1


def estimate_slice(width: int, height: int, *, full_bleed: bool = False) -> int:
    if full_bleed:
        return max(12, int(min(width, height) * 0.06))
    short = min(width, height)
    long = max(width, height)
    if short < 120:
        return max(10, int(short * 0.24))
    if long > short * 2.5:
        return max(14, int(short * 0.28))
    return max(16, int(min(width, height) * 0.12))


def crop_one(source: Path, slug: str, out_dir: Path, archive_dir: Path) -> dict:
    archive_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, archive_dir / f"{slug}-full.png")
    image = Image.open(source).convert("RGBA")
    bbox = content_bbox(image)
    if bbox is None:
        raise RuntimeError(f"No visible pixels in {source.name}")
    cropped = image.crop(bbox)
    out_file = out_dir / f"{slug}.png"
    cropped.save(out_file, format="PNG")
    w, h = cropped.size
    entry: dict = {
        "slug": slug,
        "sourceName": source.name,
        "file": f"{slug}.png",
        "width": w,
        "height": h,
        "fullBleed": slug in {"material-sheet-bg", "qa-panel-bg"},
    }
    if not entry["fullBleed"]:
        entry["borderSlice"] = estimate_slice(w, h, full_bleed=False)
    print(f"cropped {source.name} -> {out_file.name} ({w}x{h})")
    return entry


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / "_source-full"
    merged: dict[str, dict] = {}

    for src_dir, name_map in SOURCE_BATCHES:
        if not src_dir.exists():
            raise FileNotFoundError(src_dir)
        for cn, slug in name_map.items():
            merged[slug] = crop_one(src_dir / cn, slug, OUT, archive)

    manifest = {"assets": list(merged.values())}
    manifest_path = OUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()
