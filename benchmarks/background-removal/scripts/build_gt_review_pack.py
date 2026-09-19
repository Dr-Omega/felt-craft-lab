"""Build read-only visual review material for a candidate draft GT mask."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


SOURCE_NAMES = ("source.png", "source.jpg", "source.jpeg")


def find_source(candidate_dir: Path) -> Path:
    matches = [candidate_dir / name for name in SOURCE_NAMES if (candidate_dir / name).is_file()]
    if len(matches) != 1:
        raise ValueError("candidate must contain exactly one source.png/source.jpg/source.jpeg")
    return matches[0]


def binary_mask(path: Path) -> Image.Image:
    with Image.open(path) as image:
        mask = image.convert("L")
        values = set(mask.get_flattened_data())
        if values - {0, 255}:
            raise ValueError("draft_ground_truth.png must be strictly binary {0,255}")
        return mask.copy()


def checkerboard(size: tuple[int, int], square: int = 16) -> Image.Image:
    image = Image.new("RGB", size, (238, 238, 238))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill=(194, 194, 194))
    return image


def build_review_pack(candidate_dir: Path, output_dir: Path) -> dict[str, str]:
    source_path = find_source(candidate_dir)
    gt_path = candidate_dir / "draft_ground_truth.png"
    metadata_path = candidate_dir / "candidate.json"
    if not gt_path.is_file() or not metadata_path.is_file():
        raise ValueError("candidate requires draft_ground_truth.png and candidate.json")
    json.loads(metadata_path.read_text(encoding="utf-8"))
    mask = binary_mask(gt_path)
    with Image.open(source_path) as image:
        source = image.convert("RGBA")
    if source.size != mask.size:
        raise ValueError("source and draft_ground_truth.png dimensions differ")
    output_dir.mkdir(parents=True, exist_ok=True)
    source.copy().save(output_dir / "source.png")
    mask.save(output_dir / "gt-mask.png")
    eroded = mask.filter(ImageFilter.MinFilter(3))
    boundary = ImageChops.subtract(mask, eroded)
    overlay = source.copy()
    red = Image.new("RGBA", source.size, (255, 48, 48, 0))
    red.putalpha(boundary.point(lambda value: 220 if value else 0))
    overlay.alpha_composite(red)
    overlay.save(output_dir / "boundary-overlay.png")
    foreground = source.copy()
    foreground.putalpha(mask)
    preview = checkerboard(source.size).convert("RGBA")
    preview.alpha_composite(foreground)
    preview.save(output_dir / "checkerboard-foreground.png")
    review_identity = {
        "schemaVersion": "background-removal.gt-review-identity/1",
        "reviewedSourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "reviewedGroundTruthSha256": hashlib.sha256(gt_path.read_bytes()).hexdigest(),
        "reviewedCandidateMetadataSha256": hashlib.sha256(metadata_path.read_bytes()).hexdigest(),
    }
    (output_dir / "review-identity.json").write_text(
        json.dumps(review_identity, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return review_identity


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    hashes = build_review_pack(args.candidate_dir, args.output_dir)
    print(json.dumps(hashes, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
