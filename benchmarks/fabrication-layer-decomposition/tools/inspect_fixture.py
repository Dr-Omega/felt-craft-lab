"""Read-only fixture summary for manual benchmark audit."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

from validate_benchmark import BENCHMARK_ROOT, load_json


def inspect_fixture(fixture_id: str, root: Path = BENCHMARK_ROOT) -> dict:
    errors: list[str] = []
    manifest = load_json(root / "benchmark_manifest.json", errors)
    if errors or not isinstance(manifest, dict):
        raise ValueError("benchmark manifest is unreadable")
    fixture = next((item for item in manifest.get("fixtures", []) if item.get("fixtureId") == fixture_id), None)
    if not isinstance(fixture, dict):
        raise ValueError("unknown fixtureId")
    source_path = root / fixture["sourceFile"]
    gt = load_json(root / fixture["groundTruthFile"], errors)
    if errors or not isinstance(gt, dict):
        raise ValueError("ground truth is unreadable")
    with Image.open(source_path) as image:
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        alpha_values = list(alpha.getdata())
        step = max(1, len(alpha_values) // 100_000)
        pixels = list(rgba.getdata())
        unique_rgb = {pixel[:3] for index, pixel in enumerate(pixels) if alpha_values[index] > 0 and index % step == 0}
        transparent = sum(1 for value in alpha_values if value == 0)
        summary = {
            "fixtureId": fixture_id,
            "source": {"width": image.width, "height": image.height, "mode": image.mode},
            "alpha": {"hasAlpha": "A" in image.getbands(), "extrema": list(alpha.getextrema()), "transparentPixelFraction": round(transparent / len(alpha_values), 6)},
            "approximateUniqueRgbCount": len(unique_rgb),
            "geometryTags": fixture["geometryTags"],
            "benchmarkUse": fixture["benchmarkUse"],
            "groundTruthSummary": {
                "expectedColorRegionCount": gt["expectedColorRegions"]["approximateCount"],
                "expectedPieceRange": gt["expectedPieces"],
                "requiredBelowRelationCount": len(gt["expectedStacking"]["requiredBelowRelations"]),
                "voidPolicy": gt["voidPolicy"],
            },
        }
    return summary


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: inspect_fixture.py FLD-001", file=sys.stderr)
        return 2
    try:
        print(json.dumps(inspect_fixture(args[0]), ensure_ascii=False, indent=2))
    except ValueError as exc:
        print(f"inspect failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
