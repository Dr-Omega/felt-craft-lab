from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import benchmark_lib  # noqa: E402
from benchmark_lib import canonical_environment_contract_sha256, classify_benchmark_status, load_acceptance_environment, model_run_status, runtime_environment_validation  # noqa: E402


MODELS = ["current-rule", "isnet-anime", "birefnet-general-lite", "birefnet-general"]
CASE_IDS = [f"BR-{index:03d}" for index in range(1, 16)]


def review(*, complete: bool) -> dict[str, object]:
    if not complete:
        return {"boundaryQuality": None, "criticalStructure": None, "visibleInternalHole": None, "hardFailReasons": []}
    return {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": False, "hardFailReasons": []}


def complete_reproducibility() -> dict[str, object]:
    environment_contract = {"schemaVersion": "background-removal.acceptance-environment/1", "python": "3.12", "packages": {"rembg": "2.0.81", "onnxruntime": "1.29.0", "Pillow": "12.3.0", "numpy": "2.5.2", "psutil": "7.2.2"}}
    return {
        "runtimeVersions": {"python": "3.12.7", "rembg": "2.0.81", "onnxruntime": "1.29.0", "Pillow": "12.3.0", "numpy": "2.5.2", "psutil": "7.2.2"},
        "environmentContract": environment_contract,
        "environmentContractSha256": canonical_environment_contract_sha256(environment_contract),
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


def formal_snapshot() -> dict[str, object]:
    review = {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"}
    return {
        "acceptanceDatasetManifestSha256": "b" * 64,
        "requiredProjectRealReviewedCaseCount": 15,
        "selectedCaseIds": list(CASE_IDS),
        "cases": [
            {
                "caseId": case_id,
                "sourceFile": "source.png",
                "sourceSha256": "c" * 64,
                "groundTruthSha256": "d" * 64,
                "caseMetadataSha256": "e" * 64,
                "sourceLineageId": f"project/{case_id.lower()}",
                "datasetRole": "PROJECT_REAL_ACCEPTANCE",
                "coverageTags": ["unit-test"],
                "groundTruthReview": dict(review),
            }
            for case_id in CASE_IDS
        ],
    }


def result_fixture(*, review_complete: bool, selected_models: list[str] | None = None) -> dict[str, object]:
    selected = selected_models or MODELS
    snapshot = formal_snapshot()
    rows = [
        {"modelId": model_id, "caseId": case_id, "status": "SUCCESS", "manualReview": review(complete=review_complete)}
        for model_id in selected for case_id in CASE_IDS
    ]
    return {
        "scope": "all-cases",
        "configuration": {"modelOrder": list(MODELS)},
        "datasetValidation": {"valid": True, "manifestSha256": snapshot["acceptanceDatasetManifestSha256"], "projectRealReviewedCaseCount": 15, "requiredProjectRealReviewedCaseCount": 15, "sourceLineageCount": 15, "selectedCaseIds": list(CASE_IDS), "completeCaseCount": 15, "requiredCaseCount": 15},
        "datasetSnapshot": snapshot,
        "selectedModels": selected,
        "caseIds": list(CASE_IDS),
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

    def test_exact_formal_environment_passes_the_environment_gate(self) -> None:
        versions = complete_reproducibility()["runtimeVersions"]
        self.assertTrue(runtime_environment_validation(versions).get("valid"))
        self.assertEqual(load_acceptance_environment()["python"], "3.12")

    def test_each_package_version_mismatch_blocks_formal_acceptance(self) -> None:
        for package in ("rembg", "onnxruntime", "Pillow", "numpy", "psutil"):
            result = result_fixture(review_complete=True)
            result["reproducibility"]["runtimeVersions"][package] = "mismatch"
            self.assertEqual(classify_benchmark_status(result), "RUN_COMPLETE_UNVERIFIED", package)

    def test_non_312_python_blocks_formal_acceptance(self) -> None:
        result = result_fixture(review_complete=True)
        result["reproducibility"]["runtimeVersions"]["python"] = "3.11.9"
        self.assertEqual(classify_benchmark_status(result), "RUN_COMPLETE_UNVERIFIED")

    def test_environment_contract_content_or_hash_drift_blocks_formal_acceptance(self) -> None:
        changed_contract = result_fixture(review_complete=True)
        changed_contract["reproducibility"]["environmentContract"]["semanticNote"] = "changed"
        self.assertEqual(classify_benchmark_status(changed_contract), "RUN_COMPLETE_UNVERIFIED")

        changed_hash = result_fixture(review_complete=True)
        changed_hash["reproducibility"]["environmentContractSha256"] = "0" * 64
        self.assertEqual(classify_benchmark_status(changed_hash), "RUN_COMPLETE_UNVERIFIED")

    def test_frozen_environment_contract_survives_worktree_drift(self) -> None:
        accepted = result_fixture(review_complete=True)
        with tempfile.TemporaryDirectory() as temporary:
            previous_root = benchmark_lib.BENCHMARK_ROOT
            benchmark_lib.BENCHMARK_ROOT = Path(temporary)
            try:
                (Path(temporary) / "acceptance-environment.json").write_text('{"schemaVersion":"changed"}', encoding="utf-8")
                self.assertEqual(classify_benchmark_status(accepted), "ACCEPTANCE_COMPLETE")
            finally:
                benchmark_lib.BENCHMARK_ROOT = previous_root

    def test_missing_or_synthetic_frozen_snapshot_never_completes_acceptance(self) -> None:
        missing = result_fixture(review_complete=True)
        missing.pop("datasetSnapshot")
        self.assertNotEqual(classify_benchmark_status(missing), "ACCEPTANCE_COMPLETE")

        synthetic = result_fixture(review_complete=True)
        for entry in synthetic["datasetSnapshot"]["cases"]:
            entry["datasetRole"] = "SYNTHETIC_DEBUG"
        self.assertNotEqual(classify_benchmark_status(synthetic), "ACCEPTANCE_COMPLETE")

    def test_frozen_snapshot_review_and_count_mismatches_never_complete_acceptance(self) -> None:
        for field, invalid in (("state", "PENDING"), ("state", "REJECTED"), ("signoff", "NOT_SIGNED"), ("reviewerRole", "WRONG_ROLE")):
            with self.subTest(field=field, invalid=invalid):
                result = result_fixture(review_complete=True)
                result["datasetSnapshot"]["cases"][0]["groundTruthReview"][field] = invalid
                self.assertNotEqual(classify_benchmark_status(result), "ACCEPTANCE_COMPLETE")

        too_few = result_fixture(review_complete=True)
        too_few["datasetSnapshot"]["cases"].pop()
        too_few["datasetSnapshot"]["selectedCaseIds"].pop()
        self.assertNotEqual(classify_benchmark_status(too_few), "ACCEPTANCE_COMPLETE")

        duplicate_lineage = result_fixture(review_complete=True)
        duplicate_lineage["datasetSnapshot"]["cases"][1]["sourceLineageId"] = duplicate_lineage["datasetSnapshot"]["cases"][0]["sourceLineageId"]
        self.assertNotEqual(classify_benchmark_status(duplicate_lineage), "ACCEPTANCE_COMPLETE")

    def test_run_case_ids_and_case_results_must_bind_to_frozen_snapshot(self) -> None:
        replacement_ids = [f"ALT-{index:03d}" for index in range(1, 16)]
        replaced = result_fixture(review_complete=True)
        replaced["caseIds"] = replacement_ids
        for row, replacement_id in zip(replaced["caseResults"], replacement_ids * len(MODELS), strict=True):
            row["caseId"] = replacement_id
        self.assertNotEqual(classify_benchmark_status(replaced), "ACCEPTANCE_COMPLETE")

        case_ids_only = result_fixture(review_complete=True)
        case_ids_only["caseIds"] = replacement_ids
        self.assertNotEqual(classify_benchmark_status(case_ids_only), "ACCEPTANCE_COMPLETE")

        outside_result = result_fixture(review_complete=True)
        outside_result["caseResults"][0]["caseId"] = "BR-OUTSIDE"
        self.assertNotEqual(classify_benchmark_status(outside_result), "ACCEPTANCE_COMPLETE")

    def test_formal_model_subsets_never_complete_acceptance(self) -> None:
        for subset in (MODELS[:1], [MODELS[1]], MODELS[:2], MODELS[:3]):
            with self.subTest(subset=subset):
                self.assertNotEqual(classify_benchmark_status(result_fixture(review_complete=True, selected_models=subset)), "ACCEPTANCE_COMPLETE")

    def test_non_acceptance_scope_is_partial(self) -> None:
        result = result_fixture(review_complete=True)
        result["scope"] = "case:BR-001"
        self.assertEqual(classify_benchmark_status(result), "PARTIAL")

    def test_model_with_any_case_error_is_not_run_complete(self) -> None:
        self.assertEqual(model_run_status([{"status": "SUCCESS"}, {"status": "ERROR"}], 2), "FAILED")


if __name__ == "__main__":
    unittest.main()
