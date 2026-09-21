"""Fail-closed promotion of a human-signed candidate into v2 acceptance data.

Promotion never updates acceptance-freeze.json. Its two filesystem replacements
provide exception-level transactional rollback: if manifest replacement fails
after the case has moved into place, the new case is removed and the original
manifest bytes remain untouched. This is not a power-loss atomicity claim.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image


SOURCE_NAMES = ("source.png", "source.jpg", "source.jpeg")
FORMAL_ROLE = "PROJECT_REAL_ACCEPTANCE"
REVIEWER_ROLE = "PROJECT_DATASET_REVIEWER"
CASE_ID_PATTERN = re.compile(r"BR-\d{3}\Z")
ALLOWED_ORIGIN_CLASSES = {"PROJECT_FIXTURE", "PROJECT_GENERATED_ASSET", "PROJECT_USER_ASSET"}
REQUIRED_COVERAGE_SLOTS = {f"slot-{index:02d}" for index in range(1, 16)}
TEMPORARY_LINEAGE_PREFIXES = ("provisional:", "temporary:", "temp:")
REVIEW_IDENTITY_FIELDS = (
    "reviewedSourceSha256",
    "reviewedGroundTruthSha256",
    "reviewedCandidateMetadataSha256",
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_source(candidate_dir: Path) -> Path:
    matches = [candidate_dir / name for name in SOURCE_NAMES if (candidate_dir / name).is_file()]
    if len(matches) != 1:
        raise ValueError("candidate must contain exactly one source.png/source.jpg/source.jpeg")
    return matches[0]


def validate_source(source: Path) -> tuple[int, int]:
    try:
        with Image.open(source) as image:
            image.load()
            if "A" in image.getbands() and any(value != 255 for value in image.getchannel("A").get_flattened_data()):
                raise ValueError("candidate source alpha must be fully opaque")
            return image.size
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValueError("candidate source cannot be decoded") from exc


def validate_binary_mask(path: Path, expected_size: tuple[int, int]) -> None:
    if not path.is_file():
        raise ValueError("candidate is missing draft_ground_truth.png")
    with Image.open(path) as image:
        mask = image.convert("L")
        if mask.size != expected_size:
            raise ValueError("candidate source and draft_ground_truth.png dimensions differ")
        if set(mask.get_flattened_data()) - {0, 255}:
            raise ValueError("candidate draft_ground_truth.png must be strictly binary {0,255}")


def load_json(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError(f"candidate is missing {label}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def validate_candidate(candidate: dict[str, Any], review: dict[str, Any]) -> None:
    if candidate.get("rightsStatus") != "CLEARED_FOR_PROJECT_EVAL":
        raise ValueError("candidate rightsStatus must be CLEARED_FOR_PROJECT_EVAL")
    if candidate.get("backgroundRemovalSuitability") != "SUITABLE":
        raise ValueError("candidate backgroundRemovalSuitability must be SUITABLE")
    if candidate.get("lineageStatus") != "CONFIRMED":
        raise ValueError("candidate lineageStatus must be CONFIRMED")
    if candidate.get("originClass") not in ALLOWED_ORIGIN_CLASSES:
        raise ValueError("candidate originClass is not an allowed original project source")
    required_strings = ("sourceLineageId", "category", "description")
    if any(not isinstance(candidate.get(field), str) or not candidate[field].strip() for field in required_strings):
        raise ValueError("candidate requires sourceLineageId, category, and description")
    if candidate["sourceLineageId"].lower().startswith(TEMPORARY_LINEAGE_PREFIXES):
        raise ValueError("candidate sourceLineageId must be stable, not temporary or provisional")
    structures = candidate.get("criticalStructures")
    tags = candidate.get("coverageTags")
    if not isinstance(structures, list) or not structures or not all(isinstance(value, str) and value.strip() for value in structures):
        raise ValueError("candidate criticalStructures must be a non-empty string list")
    if not isinstance(tags, list) or not tags or not all(isinstance(value, str) and value.strip() for value in tags):
        raise ValueError("candidate coverageTags must be a non-empty string list")
    if candidate.get("primaryCoverageSlot") not in REQUIRED_COVERAGE_SLOTS:
        raise ValueError("candidate primaryCoverageSlot must be a valid human-confirmed formal slot")
    if review.get("state") != "APPROVED" or review.get("signoff") != "SIGNED_OFF" or review.get("reviewerRole") != REVIEWER_ROLE:
        raise ValueError("candidate GT review must be APPROVED, SIGNED_OFF, and PROJECT_DATASET_REVIEWER")


def validate_review_identity(review: dict[str, Any], source: Path, ground_truth: Path, metadata: Path) -> None:
    actual = {
        "reviewedSourceSha256": sha256_file(source),
        "reviewedGroundTruthSha256": sha256_file(ground_truth),
        "reviewedCandidateMetadataSha256": sha256_file(metadata),
    }
    for field in REVIEW_IDENTITY_FIELDS:
        expected = review.get(field)
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected.lower()):
            raise ValueError(f"candidate GT review requires valid {field}")
        if expected.lower() != actual[field]:
            raise ValueError(f"candidate GT review {field} does not match current bytes")


def validate_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    cases = manifest.get("cases")
    if (
        manifest.get("schemaVersion") != "background-removal.acceptance-dataset/2"
        or manifest.get("requiredProjectRealReviewedCaseCount") != 15
        or not isinstance(cases, list)
        or not all(isinstance(entry, dict) for entry in cases)
    ):
        raise ValueError("acceptance manifest must use the formal v2 contract")
    return cases


def safe_target(cases_root: Path, case_id: str) -> Path:
    if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id):
        raise ValueError("caseId must match BR-###")
    root = cases_root.resolve()
    target = (root / case_id).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("caseId resolves outside cases root") from exc
    return target


def canonical_json_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def promote_reviewed_candidate(candidate_dir: Path, cases_root: Path, manifest_path: Path, case_id: str) -> dict[str, Any]:
    """Promote one reviewed candidate with exception-level case/manifest rollback."""
    target = safe_target(cases_root, case_id)
    benchmark_root = cases_root.resolve().parent
    if manifest_path.resolve().parent != benchmark_root:
        raise ValueError("acceptance manifest must be located at benchmark root")
    candidate_path = candidate_dir / "candidate.json"
    gt = candidate_dir / "draft_ground_truth.png"
    review_path = candidate_dir / "gt-review.json"
    candidate = load_json(candidate_path, "candidate.json")
    review = load_json(review_path, "gt-review.json")
    validate_candidate(candidate, review)
    source = find_source(candidate_dir)
    source_size = validate_source(source)
    validate_binary_mask(gt, source_size)
    validate_review_identity(review, source, gt, candidate_path)
    manifest = load_json(manifest_path, "acceptance-dataset.json")
    cases = validate_manifest(manifest)
    if target.exists() or any(entry.get("caseId") == case_id for entry in cases):
        raise ValueError("target caseId already exists")
    lineage = candidate["sourceLineageId"]
    if any(entry.get("sourceLineageId") == lineage for entry in cases):
        raise ValueError("sourceLineageId already exists in acceptance manifest")

    case_metadata = {
        "caseId": case_id,
        "datasetRole": FORMAL_ROLE,
        "sourceLineageId": lineage,
        "category": candidate["category"],
        "description": candidate["description"],
        "criticalStructures": candidate["criticalStructures"],
    }
    case_metadata_bytes = canonical_json_bytes(case_metadata)
    evidence_relative = f"cases/{case_id}/gt-review.json"
    entry = {
        "caseId": case_id,
        "datasetRole": FORMAL_ROLE,
        "sourceLineageId": lineage,
        "sourceFile": source.name,
        "sourceSha256": sha256_file(source),
        "groundTruthSha256": sha256_file(gt),
        "caseMetadataSha256": hashlib.sha256(case_metadata_bytes).hexdigest(),
        "coverageTags": candidate["coverageTags"],
        "primaryCoverageSlot": candidate["primaryCoverageSlot"],
        "groundTruthReview": {
            "state": review["state"],
            "signoff": review["signoff"],
            "reviewerRole": review["reviewerRole"],
            "evidence": {"file": evidence_relative, "sha256": sha256_file(review_path)},
            **{field: review[field] for field in REVIEW_IDENTITY_FIELDS},
        },
    }
    manifest_bytes = canonical_json_bytes({**manifest, "cases": [*cases, entry]})

    cases_root.mkdir(parents=True, exist_ok=True)
    temporary_case = Path(tempfile.mkdtemp(prefix=".promotion-", dir=cases_root))
    temporary_manifest = manifest_path.with_name(f".{manifest_path.name}.promotion-tmp")
    moved_case = False
    try:
        shutil.copyfile(source, temporary_case / source.name)
        shutil.copyfile(gt, temporary_case / "ground_truth.png")
        shutil.copyfile(review_path, temporary_case / "gt-review.json")
        (temporary_case / "case.json").write_bytes(case_metadata_bytes)
        temporary_manifest.write_bytes(manifest_bytes)
        os.replace(temporary_case, target)
        moved_case = True
        os.replace(temporary_manifest, manifest_path)
    except Exception:
        if moved_case and target.exists():
            shutil.rmtree(target, ignore_errors=True)
        if temporary_case.exists():
            shutil.rmtree(temporary_case, ignore_errors=True)
        if temporary_manifest.exists():
            temporary_manifest.unlink()
        raise
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("case_id")
    parser.add_argument("--cases-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    entry = promote_reviewed_candidate(args.candidate_dir, args.cases_root, args.manifest, args.case_id)
    print(json.dumps(entry, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
