"""Merge manual reviews into an existing raw run and generate final reports."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from benchmark_lib import BENCHMARK_ROOT, final_verdict_for_review, sha256_file
from run_benchmark import write_results


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


def merge_manual_reviews(run_result: dict[str, Any], review_document: dict[str, Any]) -> dict[str, Any]:
    """Merge reviews without modifying the raw execution report or rerunning a model."""
    run_id = run_result.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise ValueError("benchmark run is missing runId")
    if review_document.get("runId") != run_id:
        raise ValueError("manual review runId does not match benchmark runId")
    verify_output_integrity(run_result)
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
