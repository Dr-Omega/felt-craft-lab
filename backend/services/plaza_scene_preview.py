"""Compose flat scene previews (same layout as Editor / 展示) for plaza demo posts."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - optional until Pillow installed
    Image = None  # type: ignore[misc, assignment]

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
SNAPSHOT_ID = "snapshot_ywn_20260805_112922"
CANVAS_WIDTH = 902
CANVAS_HEIGHT = 516
CANVAS_BG = (255, 248, 231)


@dataclass(frozen=True)
class StickerPlacement:
    asset_id: str
    left: int
    top: int
    z_index: int


@dataclass(frozen=True)
class PlazaDemoSceneSpec:
    background_asset_id: str
    stickers: tuple[StickerPlacement, ...]


# Same catalog assets as projection demo; two mid-autumn layouts for 中秋1 / 中秋2.
PLAZA_DEMO_SCENES: dict[str, PlazaDemoSceneSpec] = {
    "demo-plaza-mid-autumn-1.png": PlazaDemoSceneSpec(
        background_asset_id="background_lake_moon_001",
        stickers=(
            StickerPlacement("sticker_crescent_moon_001", 120, 80, 1),
            StickerPlacement("sticker_mooncake_001", 280, 160, 2),
            StickerPlacement("sticker_rabbit_001", 440, 120, 3),
            StickerPlacement("sticker_tangyuan_001", 560, 260, 4),
        ),
    ),
    "demo-plaza-mid-autumn-2.png": PlazaDemoSceneSpec(
        background_asset_id="background_osmanthus_moon_001",
        stickers=(
            StickerPlacement("sticker_mooncake_001", 140, 120, 1),
            StickerPlacement("sticker_rabbit_001", 360, 90, 2),
            StickerPlacement("sticker_crescent_moon_001", 520, 200, 3),
            StickerPlacement("sticker_tangyuan_001", 680, 140, 4),
        ),
    ),
    "demo-plaza-personal-1.png": PlazaDemoSceneSpec(
        background_asset_id="background_river_lantern_001",
        stickers=(
            StickerPlacement("sticker_flower_lantern_001", 160, 140, 1),
            StickerPlacement("sticker_mooncake_001", 380, 180, 2),
            StickerPlacement("sticker_rabbit_001", 520, 100, 3),
        ),
    ),
    "demo-plaza-personal-2.png": PlazaDemoSceneSpec(
        background_asset_id="background_lantern_street_001",
        stickers=(
            StickerPlacement("sticker_crescent_moon_001", 200, 120, 1),
            StickerPlacement("sticker_tangyuan_001", 420, 200, 2),
            StickerPlacement("sticker_flower_lantern_001", 600, 130, 3),
        ),
    ),
}


def _material_roots() -> list[Path]:
    generated = REPO_ROOT / "assets" / "generated"
    return [
        generated / "material" / SNAPSHOT_ID,
        generated / "snapshots" / SNAPSHOT_ID,
    ]


def resolve_material_png(asset_id: str) -> Path:
    filename = f"{asset_id}.png"
    for root in _material_roots():
        candidate = root / filename
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Missing catalog material: {asset_id} ({filename})")


def compose_scene_preview(spec: PlazaDemoSceneSpec, *, out_width: int = 640) -> bytes:
    if Image is None:
        raise RuntimeError("Pillow is required to compose plaza demo previews (pip install Pillow).")

    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), CANVAS_BG + (255,))

    background = Image.open(resolve_material_png(spec.background_asset_id)).convert("RGBA")
    background = _cover_resize(background, CANVAS_WIDTH, CANVAS_HEIGHT)
    canvas.alpha_composite(background, (0, 0))

    for sticker in sorted(spec.stickers, key=lambda entry: entry.z_index):
        layer = Image.open(resolve_material_png(sticker.asset_id)).convert("RGBA")
        canvas.alpha_composite(layer, (sticker.left, sticker.top))

    scale = out_width / CANVAS_WIDTH
    out_height = max(1, round(CANVAS_HEIGHT * scale))
    preview = canvas.resize((out_width, out_height), Image.Resampling.LANCZOS)

    buffer = BytesIO()
    preview.convert("RGB").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _cover_resize(image: Image.Image, width: int, height: int) -> Image.Image:
    src_w, src_h = image.size
    scale = max(width / src_w, height / src_h)
    resized = image.resize((max(1, round(src_w * scale)), max(1, round(src_h * scale))), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def write_scene_preview_png(png_name: str, target: Path) -> bool:
    spec = PLAZA_DEMO_SCENES.get(png_name)
    if not spec:
        return False
    try:
        payload = compose_scene_preview(spec)
    except (FileNotFoundError, RuntimeError):
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return True
