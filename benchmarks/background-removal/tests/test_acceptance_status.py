from __future__ import annotations

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from benchmark_lib import classify_benchmark_status, model_run_status  # noqa: E402


MODELS = ["current-rule", "isnet-anime", "birefnet-general-lite", "birefnet-general"]
CASE_IDS = [f"BR-{index:03d}" for index in range(1, 16)]


def review(*, complete: bool) -> dict[str, object]:
    if not complete:
        return {"boundaryQuality": None, "criticalStructure": None, "visibleInternalHole": None, "hardFailReasons": []}
    return {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": False, "hardFailReasons": []}


def complete_reproducibility() -> dict[str, object]:
    return {
        "runtimeVersions": {"rembg": "2.0.0", "onnxruntime": "1.0.0", "Pillow": "10.0.0"},
        "modelArtifacts": {
            model_id: {
                "exactModelRevision": "not-applicable" if model_id == "current-rule" else "revision-1",
                "expectedSha256": "not-applicable" if model_id == "current-rule" else "abc123",
                "actualModelSha256": "not-applicable" if model_id == "current-rule" else "abc123",
                "sha256Match": "NOT_APPLICABLE" if model_id == "current-rule" else True,
                "artifactVerified": True,
                "weightLicenseVerificationStatus": "NOT_APPLICABLE" if model_id == "current-rule" else "VERIFIED",
            }
            for model_id in MODELS
        },
    }


def result_fixture(*, review_complete: bool, selected_models: list[str] | None = None) -> dict[str, object]:
    selected = selected_models or MODELS
    rows = [
        {"modelId": model_id, "caseId": case_id, "status": "SUCCESS", "manualReview": review(complete=review_complete)}
        for model_id in selected for case_id in CASE_IDS
    ]
    return {
        "scope": "all-cases",
        "datasetValidation": {"valid": True, "completeCaseCount": 15, "requiredCaseCount": 15},
        "selectedModels": selected,
        "caseIds": CASE_IDS,
        "models": {model_id: {"status": "RUN_COMPLETE", "initializeStatus": "SUCCESS"} for model_id in selected},
        "caseResults": rows,
        "reproducibility": complete_reproducibility(),
    }


class AcceptanceStatusTests(unittest.TestCase):
    def test_only_current_rule_success_and_other_models_not_run_is_not_acceptance_complete(self) -> None:
        result = result_fixture(review_complete=True)
        result["models"]["isnet-anime"] = {"status": "NOT_RUN", "initializeStatus": "NOT_RUN"}
        result["models"]["birefnet-general-lite"] = {"status": "NOT_RUN", "initializeStatus": "NOT_RUN"}
        result["models"]["birefnet-general"] = {"status": "NOT_RUN", "initializeStatus": "NOT_RUN"}
        result["caseResults"] = [row for row in result["caseResults"] if row["modelId"] == "current-rule"]

        self.assertEqual(classify_benchmark_status(result), "FAILED")

    def test_all_model_case_runs_without_reviews_are_run_complete_unreviewed(self) -> None:
        self.assertEqual(classify_benchmark_status(result_fixture(review_complete=False)), "RUN_COMPLETE_UNREVIEWED")

    def test_any_case_error_prevents_acceptance_complete(self) -> None:
        result = result_fixture(review_complete=True)
        result["caseResults"][0]["status"] = "ERROR"
        result["models"]["current-rule"]["status"] = "FAILED"

        self.assertEqual(classify_benchmark_status(result), "FAILED")

    def test_all_successful_reviewed_cases_with_reproducibility_are_acceptance_complete(self) -> None:
        self.assertEqual(classify_benchmark_status(result_fixture(review_complete=True)), "ACCEPTANCE_COMPLETE")

    def test_non_acceptance_scope_is_partial(self) -> None:
        result = result_fixture(review_complete=True)
        result["scope"] = "case:BR-001"
        self.assertEqual(classify_benchmark_status(result), "PARTIAL")

    def test_model_with_any_case_error_is_not_run_complete(self) -> None:
        self.assertEqual(model_run_status([{"status": "SUCCESS"}, {"status": "ERROR"}], 2), "FAILED")


if __name__ == "__main__":
    unittest.main()
