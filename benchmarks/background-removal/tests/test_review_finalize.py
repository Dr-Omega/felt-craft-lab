from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import run_benchmark  # noqa: E402
from benchmark_lib import classify_benchmark_status  # noqa: E402
from finalize_benchmark import merge_manual_reviews  # noqa: E402


def run_fixture() -> dict[str, object]:
    models = ["current-rule"]
    cases = [f"BR-{index:03d}" for index in range(1, 16)]
    return {
        "scope": "all-cases",
        "datasetValidation": {"valid": True, "completeCaseCount": 15, "requiredCaseCount": 15},
        "selectedModels": models,
        "caseIds": cases,
        "models": {"current-rule": {"status": "RUN_COMPLETE", "initializeStatus": "SUCCESS", "processPeakRssMb": 99.5}},
        "caseResults": [{"caseId": case_id, "modelId": "current-rule", "status": "SUCCESS", "performance": {"initializeMs": 1.0}} for case_id in cases],
        "reproducibility": {
            "runtimeVersions": {"rembg": "2", "onnxruntime": "1", "Pillow": "10"},
            "modelArtifacts": {"current-rule": {"artifactVerified": True, "expectedSha256": "NOT_APPLICABLE", "actualModelSha256": "NOT_APPLICABLE", "sha256Match": "NOT_APPLICABLE", "exactModelRevision": "not-applicable", "weightLicenseVerificationStatus": "NOT_APPLICABLE"}},
        },
    }


def complete_reviews() -> dict[tuple[str, str], dict[str, object]]:
    return {(f"BR-{index:03d}", "current-rule"): {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": False, "hardFailReasons": []} for index in range(1, 16)}


class ReviewFinalizeTests(unittest.TestCase):
    def test_missing_review_records_leave_run_complete_unreviewed(self) -> None:
        result = merge_manual_reviews(run_fixture(), {})
        self.assertEqual(classify_benchmark_status(result), "RUN_COMPLETE_UNREVIEWED")

    def test_complete_reviews_continue_to_acceptance_status_evaluation(self) -> None:
        accepted = merge_manual_reviews(run_fixture(), complete_reviews())
        self.assertEqual(classify_benchmark_status(accepted), "ACCEPTANCE_COMPLETE")

        unverified = copy.deepcopy(accepted)
        unverified["reproducibility"]["runtimeVersions"]["rembg"] = None
        self.assertEqual(classify_benchmark_status(unverified), "RUN_COMPLETE_UNVERIFIED")

    def test_writing_a_new_raw_run_never_overwrites_manual_reviews(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            results = temporary_root / "results"
            results.mkdir()
            manual_path = results / "manual-reviews.json"
            manual_path.write_text('{"reviews":[{"caseId":"BR-001","modelId":"current-rule"}]}', encoding="utf-8")
            old_root = run_benchmark.BENCHMARK_ROOT
            run_benchmark.BENCHMARK_ROOT = temporary_root
            try:
                run_benchmark.write_run_result({"scope": "case:BR-001", "datasetValidation": {"valid": False}, "selectedModels": [], "caseIds": [], "models": {}, "caseResults": []})
            finally:
                run_benchmark.BENCHMARK_ROOT = old_root

            self.assertTrue((results / "benchmark-run.json").is_file())
            self.assertEqual(manual_path.read_text(encoding="utf-8"), '{"reviews":[{"caseId":"BR-001","modelId":"current-rule"}]}')

    def test_acceptance_run_cannot_enable_downloads(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden"):
            run_benchmark.validate_run_mode(SimpleNamespace(all_cases=True, allow_model_download=True))

    def test_rss_peak_is_model_level_not_case_level(self) -> None:
        result = run_fixture()
        self.assertEqual(result["models"]["current-rule"]["processPeakRssMb"], 99.5)
        self.assertNotIn("processPeakRssMb", result["caseResults"][0]["performance"])


if __name__ == "__main__":
    unittest.main()
