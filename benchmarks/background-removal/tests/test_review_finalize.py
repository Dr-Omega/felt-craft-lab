from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import run_benchmark  # noqa: E402
import benchmark_lib  # noqa: E402
from benchmark_lib import canonical_environment_contract_sha256, classify_benchmark_status, sha256_file  # noqa: E402
from finalize_benchmark import merge_manual_reviews  # noqa: E402


def ensure_output() -> tuple[Path, str]:
    output = ROOT / "outputs" / "current-rule" / "BR-001.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (16, 16), (40, 80, 120, 255)).save(output)
    return output, sha256_file(output)


def run_fixture(*, run_id: str = "run-current") -> dict[str, object]:
    output, output_sha = ensure_output()
    source = ROOT / "cases" / "BR-001" / "source.png"
    ground_truth = ROOT / "cases" / "BR-001" / "ground_truth.png"
    metadata = ROOT / "cases" / "BR-001" / "case.json"
    case = json.loads(metadata.read_text(encoding="utf-8"))
    environment_contract = {"schemaVersion": "background-removal.acceptance-environment/1", "python": "3.12", "packages": {"rembg": "2.0.81", "onnxruntime": "1.29.0", "Pillow": "12.3.0", "numpy": "2.5.2", "psutil": "7.2.2"}}
    return {
        "runId": run_id,
        "configuration": {"modelOrder": ["current-rule"]},
        "scope": "case:BR-001",
        "datasetValidation": {"valid": False, "manifestSha256": None, "projectRealReviewedCaseCount": 0, "requiredProjectRealReviewedCaseCount": 15, "sourceLineageCount": 1, "selectedCaseIds": ["BR-001"], "completeCaseCount": 1, "requiredCaseCount": 1},
        "datasetSnapshot": {"acceptanceDatasetManifestSha256": None, "requiredProjectRealReviewedCaseCount": 15, "selectedCaseIds": ["BR-001"], "cases": [{"caseId": "BR-001", "sourceFile": "source.png", "sourceSha256": sha256_file(source), "groundTruthSha256": sha256_file(ground_truth), "caseMetadataSha256": sha256_file(metadata), "sourceLineageId": case["sourceLineageId"], "datasetRole": case["datasetRole"], "coverageTags": [], "groundTruthReview": None}]},
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
            "runtimeVersions": {"python": "3.12.7", "rembg": "2.0.81", "onnxruntime": "1.29.0", "Pillow": "12.3.0", "numpy": "2.5.2", "psutil": "7.2.2"},
            "environmentContract": environment_contract,
            "environmentContractSha256": canonical_environment_contract_sha256(environment_contract),
            "modelArtifacts": {"current-rule": {"artifactVerified": True, "expectedSha256": "NOT_APPLICABLE", "actualSha256": "NOT_APPLICABLE", "sha256Match": "NOT_APPLICABLE", "exactModelRevision": "not-applicable", "weightLicenseVerificationStatus": "NOT_APPLICABLE"}},
        },
        "notes": [],
    }


def complete_review_document(run_id: str) -> dict[str, object]:
    return {"runId": run_id, "reviews": {("BR-001", "current-rule"): {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": False, "hardFailReasons": []}}}


def formal_run_fixture() -> dict[str, object]:
    """A synthetic in-memory formal report used only to exercise binding gates before I/O."""
    run = run_fixture()
    freeze = benchmark_lib.validate_acceptance_freeze()
    manifest_sha = freeze["files"]["benchmarks/background-removal/acceptance-dataset.json"]
    manifest = benchmark_lib.load_manifest()
    case_ids = [f"BR-{index:03d}" for index in range(1, 16)]
    template = copy.deepcopy(run["datasetSnapshot"]["cases"][0])
    cases = []
    for case_id in case_ids:
        entry = copy.deepcopy(template)
        entry.update({
            "caseId": case_id,
            "sourceLineageId": f"project/{case_id.lower()}",
            "datasetRole": "PROJECT_REAL_ACCEPTANCE",
            "coverageTags": ["unit-test"],
            "groundTruthReview": {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"},
        })
        cases.append(entry)
    run.update({
        "scope": "all-cases",
        "configuration": {"modelOrder": ["current-rule"]},
        "selectedModels": ["current-rule"],
        "caseIds": case_ids,
        "acceptanceFreezeSha256": sha256_file(benchmark_lib.FREEZE_PATH),
        "datasetValidation": {"valid": True, "manifestSchemaVersion": "background-removal.acceptance-dataset/2", "manifestSha256": manifest_sha, "projectRealReviewedCaseCount": 15, "requiredProjectRealReviewedCaseCount": 15, "sourceLineageCount": 15, "selectedCaseIds": list(case_ids)},
        "datasetSnapshot": {"acceptanceDatasetManifestSha256": manifest_sha, "requiredProjectRealReviewedCaseCount": 15, "selectedCaseIds": list(case_ids), "cases": cases},
    })
    run["reproducibility"]["environmentFileSha256"] = freeze["files"]["benchmarks/background-removal/acceptance-environment.json"]
    run["reproducibility"]["environmentContract"] = benchmark_lib.load_acceptance_environment()
    run["reproducibility"]["environmentContractSha256"] = canonical_environment_contract_sha256(run["reproducibility"]["environmentContract"])
    run["reproducibility"]["modelArtifacts"]["current-rule"]["expectedSha256"] = manifest["current-rule"]["modelSha256"]
    return run


class ReviewFinalizeTests(unittest.TestCase):
    def test_missing_review_complete_finalize_writes_all_final_artifacts_without_crashing(self) -> None:
        finalized = merge_manual_reviews(run_fixture(), {"runId": "run-current", "reviews": {}})
        run_benchmark.write_results(finalized)

        self.assertEqual(finalized["status"], "PARTIAL")
        self.assertTrue((ROOT / "results" / "benchmark-results.json").is_file())
        self.assertTrue((ROOT / "results" / "benchmark-summary.md").is_file())
        self.assertTrue((ROOT / "results" / "comparison.html").is_file())

    def test_same_run_id_allows_merge_and_debug_review_remains_partial(self) -> None:
        accepted = merge_manual_reviews(run_fixture(), complete_review_document("run-current"))
        self.assertEqual(classify_benchmark_status(accepted), "PARTIAL")

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

    def test_source_gt_or_case_metadata_change_rejects_finalize(self) -> None:
        for relative in ("source.png", "ground_truth.png", "case.json"):
            with self.subTest(relative=relative):
                run = run_fixture()
                path = ROOT / "cases" / "BR-001" / relative
                original = path.read_bytes()
                try:
                    path.write_bytes(b"changed-after-run")
                    with self.assertRaises(ValueError):
                        merge_manual_reviews(run, complete_review_document("run-current"))
                finally:
                    path.write_bytes(original)

    def test_frozen_environment_snapshot_survives_worktree_contract_drift(self) -> None:
        run = run_fixture()
        accepted = merge_manual_reviews(run, complete_review_document("run-current"))
        with tempfile.TemporaryDirectory() as temporary:
            previous_root = benchmark_lib.BENCHMARK_ROOT
            benchmark_lib.BENCHMARK_ROOT = Path(temporary)
            try:
                (Path(temporary) / "acceptance-environment.json").write_text('{"schemaVersion":"changed"}', encoding="utf-8")
                self.assertEqual(classify_benchmark_status(accepted), "PARTIAL")
            finally:
                benchmark_lib.BENCHMARK_ROOT = previous_root

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

    def test_formal_runner_rejects_model_subsets_but_debug_allows_current_rule(self) -> None:
        config = {"modelOrder": ["current-rule", "isnet-anime", "birefnet-general-lite", "birefnet-general"]}
        for subset in (["current-rule"], ["isnet-anime"], config["modelOrder"][:2], config["modelOrder"][:3]):
            with self.subTest(subset=subset):
                with self.assertRaisesRegex(ValueError, "complete.*modelOrder"):
                    run_benchmark.validate_formal_model_selection(SimpleNamespace(all_cases=True), subset, config)
        run_benchmark.validate_formal_model_selection(SimpleNamespace(all_cases=True), config["modelOrder"], config)
        run_benchmark.validate_formal_model_selection(SimpleNamespace(all_cases=False), ["current-rule"], config)

    def test_formal_finalization_rejects_synthetic_frozen_snapshot(self) -> None:
        run = formal_run_fixture()
        snapshot_cases = []
        for index in range(1, 16):
            entry = copy.deepcopy(run["datasetSnapshot"]["cases"][0])
            entry["caseId"] = f"BR-{index:03d}"
            entry["sourceLineageId"] = f"synthetic/{index}"
            entry["datasetRole"] = "SYNTHETIC_DEBUG"
            entry["coverageTags"] = ["test"]
            entry["groundTruthReview"] = {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"}
            snapshot_cases.append(entry)
        manifest_sha = run["datasetSnapshot"]["acceptanceDatasetManifestSha256"]
        run["datasetSnapshot"] = {"acceptanceDatasetManifestSha256": manifest_sha, "requiredProjectRealReviewedCaseCount": 15, "selectedCaseIds": [entry["caseId"] for entry in snapshot_cases], "cases": snapshot_cases}
        run["datasetValidation"] = {"valid": True, "manifestSchemaVersion": "background-removal.acceptance-dataset/2", "manifestSha256": manifest_sha, "projectRealReviewedCaseCount": 15, "requiredProjectRealReviewedCaseCount": 15, "sourceLineageCount": 15, "selectedCaseIds": [entry["caseId"] for entry in snapshot_cases]}
        run["caseIds"] = [entry["caseId"] for entry in snapshot_cases]
        with self.assertRaisesRegex(ValueError, "PROJECT_REAL_ACCEPTANCE"):
            merge_manual_reviews(run, complete_review_document("run-current"))

    def test_formal_finalization_rejects_case_or_model_binding_drift(self) -> None:
        mismatched_case_ids = formal_run_fixture()
        mismatched_case_ids["caseIds"] = ["BR-OUTSIDE"]
        with self.assertRaisesRegex(ValueError, "caseIds do not match"):
            merge_manual_reviews(mismatched_case_ids, complete_review_document("run-current"))

        outside_case_result = formal_run_fixture()
        outside_case_result["caseResults"][0]["caseId"] = "BR-OUTSIDE"
        with self.assertRaisesRegex(ValueError, "outside frozen dataset snapshot"):
            merge_manual_reviews(outside_case_result, complete_review_document("run-current"))

        subset_models = formal_run_fixture()
        subset_models["configuration"] = {"modelOrder": ["current-rule", "isnet-anime"]}
        with self.assertRaisesRegex(ValueError, "selectedModels do not match"):
            merge_manual_reviews(subset_models, complete_review_document("run-current"))

    def test_each_raw_run_result_gets_a_distinct_run_id(self) -> None:
        args = SimpleNamespace(all_cases=False, case="BR-001")
        case = ({"caseId": "BR-001", "datasetRole": "SYNTHETIC_DEBUG", "sourceLineageId": "synthetic/br-001"}, ROOT / "cases" / "BR-001" / "source.png", ROOT / "cases" / "BR-001" / "ground_truth.png", ROOT / "cases" / "BR-001")
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
