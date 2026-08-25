"""Fail-closed integrity validation for the fabrication-layer-decomposition benchmark."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
MAX_SOURCE_DIMENSION = 4096
GEOMETRY_TAGS = frozenset(
    {
        "G01_SIMPLE_FLAT", "G02_AI_COLOR_DRIFT", "G03_SAME_COLOR_MULTI_COMPONENT",
        "G04_SIMILAR_COLOR_DISTINCT_REGION", "G05_INTERNAL_OVERLAY", "G06_MULTI_LEVEL_OVERLAY",
        "G07_GLOBAL_VOID", "G08_THIN_FEATURE", "G09_MULTI_SUBSHAPE", "G10_HARD_AMBIGUOUS",
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
_GT_OPTIONAL = {"expectedGeometryComponents", "expectedColorRelations", "expectedDisposition"}
_ALLOWED_DISPOSITIONS = {"MULTI_SOLID_PIECE", "MANUAL_REQUIRED"}


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
    repository_root = _repository_root(root)
    for index, fixture in enumerate(fixtures):
        prefix = f"fixtures[{index}]"
        if not isinstance(fixture, dict):
            errors.append(f"{prefix}: expected object")
            continue
        unknown = set(fixture).difference(_FIXTURE_REQUIRED)
        if unknown:
            errors.append(f"{prefix}: unknown fixture fields {sorted(unknown)}")
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
        _validate_fixture(fixture, root, repository_root, errors)

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
        elif gt_path != root / "fixtures" / "ground-truth" / f"{gt_id}.json":
            errors.append(f"{gt_path.name}: GT filename does not match fixtureId {gt_id}")

    for fixture_id, fixture in fixture_by_id.items():
        expected_gt_path = root / "fixtures" / "ground-truth" / f"{fixture_id}.json"
        gt_path = _relative_path(fixture.get("groundTruthFile"), root)
        if gt_path != expected_gt_path:
            errors.append(f"{fixture_id}: groundTruthFile must be fixtures/ground-truth/{fixture_id}.json")
            continue
        if not gt_path.is_file():
            errors.append(f"{fixture_id}: missing GT file")
            continue
        ground_truth = load_json(gt_path, errors)
        if isinstance(ground_truth, dict) and ground_truth.get("fixtureId") != fixture_id:
            errors.append(f"{fixture_id}: fixture/GT ID mismatch")
    return errors


def _validate_fixture(fixture: dict[str, Any], root: Path, repository_root: Path, errors: list[str]) -> None:
    fixture_id = fixture["fixtureId"]
    if fixture.get("fixtureType") not in {"project_real", "synthetic_unit"}:
        errors.append(f"{fixture_id}: invalid fixtureType")
    expected_source_path = root / "fixtures" / "source" / f"{fixture_id}.png"
    source_path = _relative_path(fixture.get("sourceFile"), root)
    if source_path != expected_source_path:
        errors.append(f"{fixture_id}: sourceFile must be fixtures/source/{fixture_id}.png")
    elif not source_path.is_file():
        errors.append(f"{fixture_id}: missing source file")
    else:
        _validate_source_image(fixture_id, source_path, fixture.get("sourceCharacteristics"), errors)
    expected_gt_path = root / "fixtures" / "ground-truth" / f"{fixture_id}.json"
    gt_path = _relative_path(fixture.get("groundTruthFile"), root)
    if gt_path != expected_gt_path:
        errors.append(f"{fixture_id}: groundTruthFile must be fixtures/ground-truth/{fixture_id}.json")
    elif not gt_path.is_file():
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
    source_characteristics = fixture.get("sourceCharacteristics")
    if not _boolean_object(source_characteristics, {"hasTransparentBackground", "hasColorDrift", "hasGradient", "hasShadow", "hasTexture", "hasGlobalVoid"}):
        errors.append(f"{fixture_id}: invalid sourceCharacteristics")
    audit = fixture.get("sourceAudit")
    if not _string_object(audit, {"originalSourcePath", "selectionRationale"}):
        errors.append(f"{fixture_id}: invalid sourceAudit")
    elif fixture.get("fixtureType") == "project_real":
        _validate_project_real_source(fixture_id, source_path, audit["originalSourcePath"], repository_root, errors)
    if not isinstance(fixture.get("notes"), str):
        errors.append(f"{fixture_id}: notes must be string")


def _validate_source_image(fixture_id: str, source_path: Path, source_characteristics: Any, errors: list[str]) -> None:
    if source_path.suffix.lower() != ".png":
        errors.append(f"{fixture_id}: source must be PNG")
        return
    try:
        with Image.open(source_path) as image:
            image.verify()
        with Image.open(source_path) as image:
            image.load()
            width, height, mode, image_format = image.width, image.height, image.mode, image.format
            alpha_values = list(image.getchannel("A").getdata()) if mode == "RGBA" else []
    except (OSError, ValueError, UnidentifiedImageError) as exc:
        errors.append(f"{fixture_id}: invalid image ({exc})")
        return
    if image_format != "PNG" or mode != "RGBA":
        errors.append(f"{fixture_id}: source must decode as RGBA PNG")
        return
    if width <= 0 or height <= 0 or width > MAX_SOURCE_DIMENSION or height > MAX_SOURCE_DIMENSION:
        errors.append(f"{fixture_id}: invalid source dimensions {width}x{height}")
    if not any(alpha > 0 for alpha in alpha_values):
        errors.append(f"{fixture_id}: source is fully transparent")
    if isinstance(source_characteristics, dict) and source_characteristics.get("hasTransparentBackground") is True and not any(alpha < 255 for alpha in alpha_values):
        errors.append(f"{fixture_id}: hasTransparentBackground requires transparent pixels")


def _validate_project_real_source(fixture_id: str, copied_source_path: Path | None, original_source_value: str, repository_root: Path, errors: list[str]) -> None:
    original_source_path = _relative_path(original_source_value, repository_root)
    if original_source_path is None or not original_source_path.is_file():
        errors.append(f"{fixture_id}: project_real original source is missing")
        return
    if copied_source_path is not None and copied_source_path.is_file() and _sha256(copied_source_path) != _sha256(original_source_path):
        errors.append(f"{fixture_id}: project_real copied source SHA mismatch")


def _validate_ground_truth(ground_truth: dict[str, Any], filename: str, errors: list[str]) -> None:
    unknown = set(ground_truth).difference(_GT_REQUIRED | _GT_OPTIONAL)
    if unknown:
        errors.append(f"{filename}: unknown GT fields {sorted(unknown)}")
    missing = _GT_REQUIRED.difference(ground_truth)
    if missing:
        errors.append(f"{filename}: missing GT fields {sorted(missing)}")
        return
    if not _is_fixture_id(ground_truth.get("fixtureId")):
        errors.append(f"{filename}: invalid GT fixtureId")
    _validate_color_regions(ground_truth.get("expectedColorRegions"), filename, errors)
    _validate_relation_object(ground_truth.get("expectedGeometryComponents"), "mustRemainSeparate", filename, "expectedGeometryComponents", errors)
    _validate_relation_object(ground_truth.get("expectedColorRelations"), "mustShareColor", filename, "expectedColorRelations", errors)
    pieces = ground_truth.get("expectedPieces")
    if not _expected_piece_range(pieces):
        errors.append(f"{filename}: invalid expectedPieces")
    stacking = ground_truth.get("expectedStacking")
    if not _relation_object(stacking, "requiredBelowRelations"):
        errors.append(f"{filename}: invalid expectedStacking")
    void_policy = ground_truth.get("voidPolicy")
    if not _void_policy(void_policy):
        errors.append(f"{filename}: invalid voidPolicy")
    disposition = ground_truth.get("expectedDisposition")
    if disposition is not None and not _disposition(disposition):
        errors.append(f"{filename}: invalid expectedDisposition")
    if _requires_solid_void_disposition(void_policy):
        if not _expected_piece_range(pieces) or pieces["minReasonableCount"] < 2:
            errors.append(f"{filename}: global void requires at least two solid pieces")
        if not _disposition(disposition):
            errors.append(f"{filename}: global void requires MULTI_SOLID_PIECE or MANUAL_REQUIRED disposition")
    for key in ("manufacturingNotes", "knownDifficulty"):
        if not isinstance(ground_truth.get(key), list) or not all(isinstance(item, str) for item in ground_truth[key]):
            errors.append(f"{filename}: {key} must be string array")
    if not isinstance(ground_truth.get("manualJudgementNotes"), str):
        errors.append(f"{filename}: manualJudgementNotes must be string")


def _validate_color_regions(value: Any, filename: str, errors: list[str]) -> None:
    if not isinstance(value, dict) or set(value) != {"approximateCount", "mustKeepSeparate"}:
        errors.append(f"{filename}: invalid expectedColorRegions")
    elif not _is_int(value.get("approximateCount")) or value["approximateCount"] < 1 or not _relation_list(value.get("mustKeepSeparate")):
        errors.append(f"{filename}: invalid expectedColorRegions")


def _validate_relation_object(value: Any, required_key: str, filename: str, name: str, errors: list[str]) -> None:
    if value is not None and not _relation_object(value, required_key):
        errors.append(f"{filename}: invalid {name}")


def _relative_path(value: Any, root: Path) -> Path | None:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        return None
    try:
        candidate = (root / value).resolve()
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def _repository_root(root: Path) -> Path:
    return root.parent.parent if root.parent.name == "benchmarks" else root


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_fixture_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 7 and value.startswith("FLD-") and value[4:].isdigit()


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _boolean_object(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys and all(isinstance(value[key], bool) for key in keys)


def _string_object(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys and all(isinstance(value[key], str) and value[key] for key in keys)


def _relation_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(pair, list) and len(pair) == 2 and all(isinstance(item, str) and item for item in pair) for pair in value)


def _relation_object(value: Any, key: str) -> bool:
    return isinstance(value, dict) and set(value) == {key} and _relation_list(value[key])


def _expected_piece_range(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"minReasonableCount", "maxReasonableCount"} and _is_int(value.get("minReasonableCount")) and _is_int(value.get("maxReasonableCount")) and 1 <= value["minReasonableCount"] <= value["maxReasonableCount"]


def _void_policy(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"globalVoidsExpected", "mustPreserveGlobalVoid"} and _is_int(value.get("globalVoidsExpected")) and value["globalVoidsExpected"] >= 0 and isinstance(value.get("mustPreserveGlobalVoid"), bool)


def _disposition(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"allowedOutcomes"} and isinstance(value["allowedOutcomes"], list) and bool(value["allowedOutcomes"]) and len(set(value["allowedOutcomes"])) == len(value["allowedOutcomes"]) and all(isinstance(outcome, str) and outcome in _ALLOWED_DISPOSITIONS for outcome in value["allowedOutcomes"])


def _requires_solid_void_disposition(void_policy: Any) -> bool:
    return bool(isinstance(void_policy, dict) and void_policy.get("mustPreserveGlobalVoid") is True and _is_int(void_policy.get("globalVoidsExpected")) and void_policy["globalVoidsExpected"] > 0)


def _benchmark_counts(root: Path) -> tuple[int, int]:
    errors: list[str] = []
    manifest = load_json(root / "benchmark_manifest.json", errors)
    fixture_count = len(manifest.get("fixtures", [])) if isinstance(manifest, dict) and isinstance(manifest.get("fixtures"), list) else 0
    ground_truth_count = len(list((root / "fixtures" / "ground-truth").glob("*.json")))
    return fixture_count, ground_truth_count


def main(root: Path = BENCHMARK_ROOT) -> int:
    errors = validate_benchmark(root)
    if errors:
        print("BENCHMARK INVALID")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    fixture_count, ground_truth_count = _benchmark_counts(root)
    print(f"BENCHMARK VALID: {fixture_count} fixtures, {ground_truth_count} structural ground-truth records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
