"""Merge manual reviews into an existing raw run and generate final reports."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from benchmark_lib import BENCHMARK_ROOT, final_verdict_for_review
from run_benchmark import write_results


def load_review_index(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
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
    return indexed


def merge_manual_reviews(run_result: dict[str, Any], reviews: dict[tuple[str, str], dict[str, Any]]) -> dict[str, Any]:
    """Merge reviews without modifying the raw execution report or rerunning a model."""
    merged = copy.deepcopy(run_result)
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
    finalized = merge_manual_reviews(run_result, load_review_index(args.reviews))
    write_results(finalized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
