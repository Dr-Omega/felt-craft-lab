"""Merge manual reviews into an existing raw run and generate final reports."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from benchmark_lib import BENCHMARK_ROOT, final_verdict_for_review, sha256_file, validate_acceptance_freeze, validate_frozen_formal_dataset_snapshot
from run_benchmark import PROJECT_REAL_ACCEPTANCE, validate_case, write_results


def load_review_document(path: Path, *, default_run_id: str | None = None) -> dict[str, Any]:
    if not path.is_file():
        return {"runId": default_run_id, "reviews": {}}
    payload = json.loads(path.read_text(encoding="utf-8"))
    run_id = payload.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("manual reviews must contain a non-empty runId")
    reviews = payload.get("reviews", [])
    if not isinstance(reviews, list):
        raise ValueError("manual reviews must contain a reviews array")
    indexed: dict[tuple[str, str], dict[str, Any]] = {}
    for review in reviews:
        if not isinstance(review, dict) or not isinstance(review.get("caseId"), str) or not isinstance(review.get("modelId"), str):
            raise ValueError("each manual review requires caseId and modelId")
        key = (review["caseId"], review["modelId"])
        if key in indexed:
            raise ValueError(f"duplicate manual review for {key[0]} / {key[1]}")
        indexed[key] = {field: review.get(field) for field in ("boundaryQuality", "criticalStructure", "visibleInternalHole", "hardFailReasons")}
    return {"runId": run_id, "reviews": indexed}


def verify_output_integrity(run_result: dict[str, Any]) -> None:
    for row in run_result.get("caseResults", []):
        if row.get("status") != "SUCCESS":
            continue
        output_path = row.get("outputPath")
        expected_sha = row.get("outputSha256")
        if not isinstance(output_path, str) or not expected_sha:
            raise ValueError(f"successful result is missing output integrity fields: {row.get('caseId')} / {row.get('modelId')}")
        candidate = (BENCHMARK_ROOT / output_path).resolve()
        try:
            candidate.relative_to(BENCHMARK_ROOT.resolve())
        except ValueError as exc:
            raise ValueError(f"output path escapes benchmark root: {output_path}") from exc
        if not candidate.is_file():
            raise ValueError(f"output file is missing: {output_path}")
        actual_sha = sha256_file(candidate)
        if actual_sha.lower() != str(expected_sha).lower():
            raise ValueError(f"output SHA-256 mismatch: {output_path}")


def verify_dataset_snapshot_integrity(run_result: dict[str, Any]) -> None:
    """Ensure review is applied to the exact source/GT/case bytes used by the run."""
    if run_result.get("scope") == "all-cases":
        validate_acceptance_freeze()
        validate_frozen_formal_dataset_snapshot(run_result.get("datasetSnapshot"), run_result.get("datasetValidation"))
        snapshot = run_result["datasetSnapshot"]
        selected_case_ids = snapshot["selectedCaseIds"]
        if run_result.get("caseIds") != selected_case_ids:
            raise ValueError("formal run caseIds do not match frozen dataset snapshot selectedCaseIds")
        if any(row.get("caseId") not in selected_case_ids for row in run_result.get("caseResults", [])):
            raise ValueError("formal run contains case results outside frozen dataset snapshot")
        configuration = run_result.get("configuration")
        if not isinstance(configuration, dict) or run_result.get("selectedModels") != configuration.get("modelOrder"):
            raise ValueError("formal run selectedModels do not match frozen configuration modelOrder")
    snapshot = run_result.get("datasetSnapshot")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("cases"), list) or not snapshot["cases"]:
        raise ValueError("benchmark run is missing dataset snapshot")
    selected = snapshot.get("selectedCaseIds")
    if not isinstance(selected, list):
        raise ValueError("benchmark run dataset snapshot is missing selectedCaseIds")
    case_ids: set[str] = set()
    lineages: set[str] = set()
    for entry in snapshot["cases"]:
        if not isinstance(entry, dict):
            raise ValueError("dataset snapshot case must be an object")
        required = ("caseId", "sourceFile", "sourceSha256", "groundTruthSha256", "caseMetadataSha256", "sourceLineageId", "datasetRole")
        if any(not isinstance(entry.get(field), str) or not entry[field] for field in required):
            raise ValueError("dataset snapshot case is incomplete")
        case_id = entry["caseId"]
        lineage = entry["sourceLineageId"]
        if case_id in case_ids or lineage in lineages:
            raise ValueError("dataset snapshot contains duplicate caseId or sourceLineageId")
        case_ids.add(case_id); lineages.add(lineage)
        case_dir = BENCHMARK_ROOT / "cases" / case_id
        metadata, source, ground_truth, _validated_dir = validate_case(case_dir)
        if source.name != entry["sourceFile"] or metadata["caseId"] != case_id or metadata["sourceLineageId"] != lineage or metadata["datasetRole"] != entry["datasetRole"]:
            raise ValueError(f"dataset snapshot identity fields changed: {case_id}")
        current = {
            "sourceSha256": sha256_file(source),
            "groundTruthSha256": sha256_file(ground_truth),
            "caseMetadataSha256": sha256_file(case_dir / "case.json"),
        }
        for field, actual in current.items():
            if actual.lower() != entry[field].lower():
                raise ValueError(f"dataset snapshot {field} mismatch: {case_id}")
        if entry["datasetRole"] == PROJECT_REAL_ACCEPTANCE and not isinstance(entry.get("groundTruthReview"), dict):
            raise ValueError(f"formal dataset snapshot is missing ground truth review: {case_id}")
    if set(selected) != case_ids:
        raise ValueError("dataset snapshot selectedCaseIds do not match snapshot cases")


def merge_manual_reviews(run_result: dict[str, Any], review_document: dict[str, Any]) -> dict[str, Any]:
    """Merge reviews without modifying the raw execution report or rerunning a model."""
    run_id = run_result.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("benchmark run is missing runId")
    if review_document.get("runId") != run_id:
        raise ValueError("manual review runId does not match benchmark runId")
    verify_output_integrity(run_result)
    verify_dataset_snapshot_integrity(run_result)
    merged = copy.deepcopy(run_result)
    reviews = review_document.get("reviews", {})
    expected = {(row.get("caseId"), row.get("modelId")) for row in merged.get("caseResults", []) if row.get("status") == "SUCCESS"}
    unexpected = set(reviews) - expected
    if unexpected:
        case_id, model_id = sorted(unexpected)[0]
        raise ValueError(f"manual review does not match a successful run result: {case_id} / {model_id}")
    for row in merged.get("caseResults", []):
        key = (row.get("caseId"), row.get("modelId"))
        if row.get("status") != "SUCCESS":
            row.pop("manualReview", None)
            continue
        review = reviews.get(key)
        if review is None:
            row["manualReview"] = None
        else:
            row["manualReview"] = {**review, "finalVerdict": final_verdict_for_review(review)}
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, default=BENCHMARK_ROOT / "results" / "benchmark-run.json")
    parser.add_argument("--reviews", type=Path, default=BENCHMARK_ROOT / "results" / "manual-reviews.json")
    args = parser.parse_args()
    run_result = json.loads(args.run.read_text(encoding="utf-8"))
    finalized = merge_manual_reviews(run_result, load_review_document(args.reviews, default_run_id=run_result.get("runId")))
    write_results(finalized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
