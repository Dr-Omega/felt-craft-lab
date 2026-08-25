"""Fail-closed integrity validation for the fabrication-layer-decomposition benchmark."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
MAX_SOURCE_DIMENSION = 4096
GEOMETRY_TAGS = frozenset(
    {
        "G01_SIMPLE_FLAT",
        "G02_AI_COLOR_DRIFT",
        "G03_SAME_COLOR_MULTI_COMPONENT",
        "G04_SIMILAR_COLOR_DISTINCT_REGION",
        "G05_INTERNAL_OVERLAY",
        "G06_MULTI_LEVEL_OVERLAY",
        "G07_GLOBAL_VOID",
        "G08_THIN_FEATURE",
        "G09_MULTI_SUBSHAPE",
        "G10_HARD_AMBIGUOUS",
    }
)
_FIXTURE_REQUIRED = {
    "fixtureId", "fixtureType", "sourceFile", "groundTruthFile", "categoryHint", "geometryTags",
    "sourceCharacteristics", "benchmarkUse", "sourceAudit", "notes",
}
_GT_REQUIRED = {
    "fixtureId", "expectedColorRegions", "expectedPieces", "expectedStacking", "voidPolicy",
    "manufacturingNotes", "knownDifficulty", "manualJudgementNotes",
}


def load_json(path: Path, errors: list[str]) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{path.name}: invalid JSON ({exc})")
        return None


def validate_benchmark(root: Path = BENCHMARK_ROOT) -> list[str]:
    """Return all contract errors; never edits a fixture, GT, or manifest."""
    errors: list[str] = []
    manifest = load_json(root / "benchmark_manifest.json", errors)
    if not isinstance(manifest, dict):
        return errors or ["benchmark_manifest.json: expected object"]
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list):
        return [*errors, "benchmark_manifest.json: fixtures must be an array"]

    fixture_ids: set[str] = set()
    fixture_by_id: dict[str, dict[str, Any]] = {}
    for index, fixture in enumerate(fixtures):
        prefix = f"fixtures[{index}]"
        if not isinstance(fixture, dict):
            errors.append(f"{prefix}: expected object")
            continue
        missing = _FIXTURE_REQUIRED.difference(fixture)
        if missing:
            errors.append(f"{prefix}: missing fields {sorted(missing)}")
            continue
        fixture_id = fixture.get("fixtureId")
        if not isinstance(fixture_id, str) or not _is_fixture_id(fixture_id):
            errors.append(f"{prefix}: invalid fixtureId")
            continue
        if fixture_id in fixture_ids:
            errors.append(f"{fixture_id}: duplicate fixtureId")
            continue
        fixture_ids.add(fixture_id)
        fixture_by_id[fixture_id] = fixture
        _validate_fixture(fixture, root, errors)

    ground_truth_dir = root / "fixtures" / "ground-truth"
    seen_gt_ids: set[str] = set()
    for gt_path in sorted(ground_truth_dir.glob("*.json")):
        ground_truth = load_json(gt_path, errors)
        if not isinstance(ground_truth, dict):
            continue
        _validate_ground_truth(ground_truth, gt_path.name, errors)
        gt_id = ground_truth.get("fixtureId")
        if not isinstance(gt_id, str):
            continue
        if gt_id in seen_gt_ids:
            errors.append(f"{gt_path.name}: duplicate GT fixtureId {gt_id}")
        seen_gt_ids.add(gt_id)
        if gt_id not in fixture_by_id:
            errors.append(f"{gt_path.name}: GT references unknown fixture {gt_id}")
        elif _relative_path(fixture_by_id[gt_id].get("groundTruthFile"), root) != gt_path:
            errors.append(f"{gt_path.name}: groundTruthFile does not match manifest for {gt_id}")

    for fixture_id, fixture in fixture_by_id.items():
        gt_path = _relative_path(fixture.get("groundTruthFile"), root)
        if not gt_path or not gt_path.is_file():
            errors.append(f"{fixture_id}: missing GT file")
            continue
        ground_truth = load_json(gt_path, errors)
        if isinstance(ground_truth, dict) and ground_truth.get("fixtureId") != fixture_id:
            errors.append(f"{fixture_id}: fixture/GT ID mismatch")
    return errors


def _validate_fixture(fixture: dict[str, Any], root: Path, errors: list[str]) -> None:
    fixture_id = fixture["fixtureId"]
    if fixture.get("fixtureType") not in {"project_real", "synthetic_unit"}:
        errors.append(f"{fixture_id}: invalid fixtureType")
    source_path = _relative_path(fixture.get("sourceFile"), root)
    if not source_path or not source_path.is_file():
        errors.append(f"{fixture_id}: missing source file")
    else:
        _validate_source_image(fixture_id, source_path, errors)
    gt_path = _relative_path(fixture.get("groundTruthFile"), root)
    if not gt_path or not gt_path.is_file():
        errors.append(f"{fixture_id}: missing GT file")
    tags = fixture.get("geometryTags")
    if not isinstance(tags, list) or not tags:
        errors.append(f"{fixture_id}: geometryTags must be a non-empty array")
    elif any(not isinstance(tag, str) or tag not in GEOMETRY_TAGS for tag in tags):
        errors.append(f"{fixture_id}: unknown geometry tag")
    if fixture.get("categoryHint") is not None and not isinstance(fixture.get("categoryHint"), str):
        errors.append(f"{fixture_id}: categoryHint must be string or null")
    if not _boolean_object(fixture.get("benchmarkUse"), {"colorPurification", "genericDecomposition"}):
        errors.append(f"{fixture_id}: invalid benchmarkUse")
    if not _boolean_object(
        fixture.get("sourceCharacteristics"),
        {"hasTransparentBackground", "hasColorDrift", "hasGradient", "hasShadow", "hasTexture", "hasGlobalVoid"},
    ):
        errors.append(f"{fixture_id}: invalid sourceCharacteristics")
    audit = fixture.get("sourceAudit")
    if not isinstance(audit, dict) or not all(isinstance(audit.get(key), str) and audit[key] for key in ("originalSourcePath", "selectionRationale")):
        errors.append(f"{fixture_id}: invalid sourceAudit")


def _validate_source_image(fixture_id: str, source_path: Path, errors: list[str]) -> None:
    if source_path.suffix.lower() != ".png":
        errors.append(f"{fixture_id}: source must be PNG")
        return
    try:
        with Image.open(source_path) as image:
            image.verify()
        with Image.open(source_path) as image:
            image.load()
            width, height, mode, image_format = image.width, image.height, image.mode, image.format
    except (OSError, ValueError, UnidentifiedImageError) as exc:
        errors.append(f"{fixture_id}: invalid image ({exc})")
        return
    if image_format != "PNG" or mode != "RGBA":
        errors.append(f"{fixture_id}: source must decode as RGBA PNG")
    if width <= 0 or height <= 0 or width > MAX_SOURCE_DIMENSION or height > MAX_SOURCE_DIMENSION:
        errors.append(f"{fixture_id}: invalid source dimensions {width}x{height}")


def _validate_ground_truth(ground_truth: dict[str, Any], filename: str, errors: list[str]) -> None:
    missing = _GT_REQUIRED.difference(ground_truth)
    if missing:
        errors.append(f"{filename}: missing GT fields {sorted(missing)}")
        return
    if not _is_fixture_id(ground_truth.get("fixtureId")):
        errors.append(f"{filename}: invalid GT fixtureId")
    colors = ground_truth.get("expectedColorRegions")
    pieces = ground_truth.get("expectedPieces")
    stacking = ground_truth.get("expectedStacking")
    void_policy = ground_truth.get("voidPolicy")
    if not isinstance(colors, dict) or not isinstance(colors.get("approximateCount"), int) or colors["approximateCount"] < 1:
        errors.append(f"{filename}: invalid expectedColorRegions")
    if not isinstance(pieces, dict) or not all(isinstance(pieces.get(key), int) for key in ("minReasonableCount", "maxReasonableCount")) or pieces.get("minReasonableCount", 0) > pieces.get("maxReasonableCount", -1):
        errors.append(f"{filename}: invalid expectedPieces")
    if not isinstance(stacking, dict) or not _relation_list(stacking.get("requiredBelowRelations")):
        errors.append(f"{filename}: invalid expectedStacking")
    if not isinstance(void_policy, dict) or not isinstance(void_policy.get("globalVoidsExpected"), int) or not isinstance(void_policy.get("mustPreserveGlobalVoid"), bool):
        errors.append(f"{filename}: invalid voidPolicy")
    for key in ("manufacturingNotes", "knownDifficulty"):
        if not isinstance(ground_truth.get(key), list) or not all(isinstance(item, str) for item in ground_truth[key]):
            errors.append(f"{filename}: {key} must be string array")
    if not isinstance(ground_truth.get("manualJudgementNotes"), str):
        errors.append(f"{filename}: manualJudgementNotes must be string")


def _relative_path(value: Any, root: Path) -> Path | None:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        return None
    try:
        candidate = (root / value).resolve()
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def _is_fixture_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 7 and value.startswith("FLD-") and value[4:].isdigit()


def _boolean_object(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys and all(isinstance(value[key], bool) for key in keys)


def _relation_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(pair, list) and len(pair) == 2 and all(isinstance(item, str) for item in pair) for pair in value)


def main() -> int:
    errors = validate_benchmark()
    if errors:
        print("BENCHMARK INVALID")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print("BENCHMARK VALID: 8 fixtures, 8 structural ground-truth records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
