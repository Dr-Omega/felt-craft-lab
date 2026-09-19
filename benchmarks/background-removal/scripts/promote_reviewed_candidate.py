"""Explicit, fail-closed promotion of a human-signed candidate into acceptance data.

Nothing invokes this tool automatically. It is intentionally separate from candidate
inventory and GT review-pack generation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from PIL import Image


SOURCE_NAMES = ("source.png", "source.jpg", "source.jpeg")
FORMAL_ROLE = "PROJECT_REAL_ACCEPTANCE"
REVIEWER_ROLE = "PROJECT_DATASET_REVIEWER"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_source(candidate_dir: Path) -> Path:
    matches = [candidate_dir / name for name in SOURCE_NAMES if (candidate_dir / name).is_file()]
    if len(matches) != 1:
        raise ValueError("candidate must contain exactly one source.png/source.jpg/source.jpeg")
    return matches[0]


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
    required_strings = ("sourceLineageId", "category", "description")
    if any(not isinstance(candidate.get(field), str) or not candidate[field].strip() for field in required_strings):
        raise ValueError("candidate requires sourceLineageId, category, and description")
    structures = candidate.get("criticalStructures")
    tags = candidate.get("coverageTags")
    if not isinstance(structures, list) or not structures or not all(isinstance(value, str) and value.strip() for value in structures):
        raise ValueError("candidate criticalStructures must be a non-empty string list")
    if not isinstance(tags, list) or not tags or not all(isinstance(value, str) and value.strip() for value in tags):
        raise ValueError("candidate coverageTags must be a non-empty string list")
    if review.get("state") != "APPROVED" or review.get("signoff") != "SIGNED_OFF" or review.get("reviewerRole") != REVIEWER_ROLE:
        raise ValueError("candidate GT review must be APPROVED, SIGNED_OFF, and PROJECT_DATASET_REVIEWER")


def promote_reviewed_candidate(candidate_dir: Path, cases_root: Path, manifest_path: Path, case_id: str) -> dict[str, Any]:
    if not case_id or not case_id.startswith("BR-"):
        raise ValueError("caseId must be a non-empty BR-* identifier")
    candidate = load_json(candidate_dir / "candidate.json", "candidate.json")
    review = load_json(candidate_dir / "gt-review.json", "gt-review.json")
    validate_candidate(candidate, review)
    source = find_source(candidate_dir)
    gt = candidate_dir / "draft_ground_truth.png"
    with Image.open(source) as image:
        source_size = image.size
    validate_binary_mask(gt, source_size)
    manifest = load_json(manifest_path, "acceptance-dataset.json")
    if manifest.get("schemaVersion") != "background-removal.acceptance-dataset/1" or manifest.get("requiredProjectRealReviewedCaseCount") != 15 or not isinstance(manifest.get("cases"), list):
        raise ValueError("acceptance manifest contract is invalid")
    if (cases_root / case_id).exists() or any(entry.get("caseId") == case_id for entry in manifest["cases"] if isinstance(entry, dict)):
        raise ValueError("target caseId already exists")
    lineage = candidate["sourceLineageId"]
    if any(entry.get("sourceLineageId") == lineage for entry in manifest["cases"] if isinstance(entry, dict)):
        raise ValueError("sourceLineageId already exists in acceptance manifest")
    target = cases_root / case_id
    target.mkdir(parents=True)
    source_target = target / source.name
    gt_target = target / "ground_truth.png"
    shutil.copyfile(source, source_target)
    shutil.copyfile(gt, gt_target)
    case_metadata = {
        "caseId": case_id,
        "datasetRole": FORMAL_ROLE,
        "sourceLineageId": lineage,
        "category": candidate["category"],
        "description": candidate["description"],
        "criticalStructures": candidate["criticalStructures"],
    }
    case_metadata_path = target / "case.json"
    case_metadata_path.write_text(json.dumps(case_metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    entry = {
        "caseId": case_id,
        "datasetRole": FORMAL_ROLE,
        "sourceLineageId": lineage,
        "sourceFile": source_target.name,
        "sourceSha256": sha256_file(source_target),
        "groundTruthSha256": sha256_file(gt_target),
        "caseMetadataSha256": sha256_file(case_metadata_path),
        "coverageTags": candidate["coverageTags"],
        "groundTruthReview": {"state": review["state"], "signoff": review["signoff"], "reviewerRole": review["reviewerRole"]},
    }
    manifest["cases"].append(entry)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
