from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import run_benchmark  # noqa: E402
from benchmark_lib import classify_benchmark_status, sha256_file  # noqa: E402
from finalize_benchmark import merge_manual_reviews  # noqa: E402


def ensure_output() -> tuple[Path, str]:
    output = ROOT / "outputs" / "current-rule" / "BR-001.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (16, 16), (40, 80, 120, 255)).save(output)
    return output, sha256_file(output)


def run_fixture(*, run_id: str = "run-current") -> dict[str, object]:
    output, output_sha = ensure_output()
    return {
        "runId": run_id,
        "configuration": {"modelOrder": ["current-rule"]},
        "scope": "all-cases",
        "datasetValidation": {"valid": True, "completeCaseCount": 1, "requiredCaseCount": 1},
        "selectedModels": ["current-rule"],
        "caseIds": ["BR-001"],
        "caseSources": {"BR-001": "source.png"},
        "models": {"current-rule": {"status": "RUN_COMPLETE", "initializeStatus": "SUCCESS", "processPeakRssMb": 99.5}},
        "caseResults": [{
            "caseId": "BR-001", "modelId": "current-rule", "status": "SUCCESS",
            "metrics": {"subjectRetention": 1.0, "backgroundClearRate": 1.0, "internalHoleRate": 0.0, "foregroundIoU": 1.0},
            "performance": {"initializeMs": 1.0, "firstInferenceMs": 2.0, "warmInferenceMedianMs": 2.0, "warmInferenceP95Ms": 2.0},
            "outputPath": str(output.relative_to(ROOT)), "outputSha256": output_sha,
        }],
        "reproducibility": {
            "runtimeVersions": {"rembg": "2", "onnxruntime": "1", "Pillow": "10"},
            "modelArtifacts": {"current-rule": {"artifactVerified": True, "expectedSha256": "NOT_APPLICABLE", "actualSha256": "NOT_APPLICABLE", "sha256Match": "NOT_APPLICABLE", "exactModelRevision": "not-applicable", "weightLicenseVerificationStatus": "NOT_APPLICABLE"}},
        },
        "notes": [],
    }


def complete_review_document(run_id: str) -> dict[str, object]:
    return {"runId": run_id, "reviews": {("BR-001", "current-rule"): {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": False, "hardFailReasons": []}}}


class ReviewFinalizeTests(unittest.TestCase):
    def test_missing_review_complete_finalize_writes_all_final_artifacts_without_crashing(self) -> None:
        finalized = merge_manual_reviews(run_fixture(), {"runId": "run-current", "reviews": {}})
        run_benchmark.write_results(finalized)

        self.assertEqual(finalized["status"], "RUN_COMPLETE_UNREVIEWED")
        self.assertTrue((ROOT / "results" / "benchmark-results.json").is_file())
        self.assertTrue((ROOT / "results" / "benchmark-summary.md").is_file())
        self.assertTrue((ROOT / "results" / "comparison.html").is_file())

    def test_same_run_id_allows_merge_and_complete_review_reaches_acceptance(self) -> None:
        accepted = merge_manual_reviews(run_fixture(), complete_review_document("run-current"))
        self.assertEqual(classify_benchmark_status(accepted), "ACCEPTANCE_COMPLETE")

        unverified = copy.deepcopy(accepted)
        unverified["reproducibility"]["runtimeVersions"]["rembg"] = None
        self.assertEqual(classify_benchmark_status(unverified), "RUN_COMPLETE_UNVERIFIED")

    def test_different_run_id_rejects_finalize_and_blocks_old_review_reuse(self) -> None:
        with self.assertRaisesRegex(ValueError, "runId does not match"):
            merge_manual_reviews(run_fixture(run_id="run-new"), complete_review_document("run-old"))

    def test_modified_output_rejects_finalize(self) -> None:
        run = run_fixture()
        output = ROOT / run["caseResults"][0]["outputPath"]
        original = output.read_bytes()
        try:
            output.write_bytes(b"modified")
            with self.assertRaisesRegex(ValueError, "output SHA-256 mismatch"):
                merge_manual_reviews(run, complete_review_document("run-current"))
        finally:
            output.write_bytes(original)

    def test_writing_a_new_raw_run_never_overwrites_manual_reviews(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            results = temporary_root / "results"
            results.mkdir()
            manual_path = results / "manual-reviews.json"
            manual_path.write_text('{"runId":"old-run","reviews":[]}', encoding="utf-8")
            old_root = run_benchmark.BENCHMARK_ROOT
            run_benchmark.BENCHMARK_ROOT = temporary_root
            try:
                run_benchmark.write_run_result({"runId": "new-run", "scope": "case:BR-001", "datasetValidation": {"valid": False}, "selectedModels": [], "caseIds": [], "models": {}, "caseResults": []})
            finally:
                run_benchmark.BENCHMARK_ROOT = old_root

            self.assertTrue((results / "benchmark-run.json").is_file())
            self.assertEqual(manual_path.read_text(encoding="utf-8"), '{"runId":"old-run","reviews":[]}')

    def test_acceptance_run_cannot_enable_downloads(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden"):
            run_benchmark.validate_run_mode(SimpleNamespace(all_cases=True, allow_model_download=True))

    def test_each_raw_run_result_gets_a_distinct_run_id(self) -> None:
        args = SimpleNamespace(all_cases=False, case="BR-001")
        case = ({"caseId": "BR-001"}, ROOT / "cases" / "BR-001" / "source.png", ROOT / "cases" / "BR-001" / "ground_truth.png", ROOT / "cases" / "BR-001")
        manifest = {"current-rule": {"exactModelRevision": "not-applicable", "weightLicenseVerificationStatus": "NOT_APPLICABLE"}}
        first = run_benchmark.initial_result({"requiredCaseCount": 1}, ["current-rule"], args, [case], manifest)
        second = run_benchmark.initial_result({"requiredCaseCount": 1}, ["current-rule"], args, [case], manifest)
        self.assertNotEqual(first["runId"], second["runId"])

    def test_rss_peak_is_model_level_not_case_level(self) -> None:
        result = run_fixture()
        self.assertEqual(result["models"]["current-rule"]["processPeakRssMb"], 99.5)
        self.assertNotIn("processPeakRssMb", result["caseResults"][0]["performance"])


if __name__ == "__main__":
    unittest.main()
