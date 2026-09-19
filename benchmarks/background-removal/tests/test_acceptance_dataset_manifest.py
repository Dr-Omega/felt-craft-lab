from __future__ import annotations

import json
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import run_benchmark  # noqa: E402
from benchmark_lib import sha256_file  # noqa: E402


def write_case(root: Path, case_id: str, *, role: str = "PROJECT_REAL_ACCEPTANCE", lineage: str | None = None) -> dict[str, object]:
    case_dir = root / "cases" / case_id
    case_dir.mkdir(parents=True)
    metadata = {"caseId": case_id, "datasetRole": role, "sourceLineageId": lineage or f"project/{case_id.lower()}", "category": "test", "description": "temporary unit-test fixture", "criticalStructures": ["subject"]}
    metadata_path = case_dir / "case.json"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    Image.new("RGB", (4, 4), "white").save(case_dir / "source.png")
    Image.new("L", (4, 4), 255).save(case_dir / "ground_truth.png")
    return {
        "caseId": case_id,
        "datasetRole": role,
        "sourceLineageId": metadata["sourceLineageId"],
        "sourceFile": "source.png",
        "sourceSha256": sha256_file(case_dir / "source.png"),
        "groundTruthSha256": sha256_file(case_dir / "ground_truth.png"),
        "caseMetadataSha256": sha256_file(metadata_path),
        "coverageTags": ["unit-test"],
        "groundTruthReview": {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"},
    }


def write_manifest(root: Path, cases: list[dict[str, object]]) -> None:
    (root / "acceptance-dataset.json").write_text(json.dumps({"schemaVersion": "background-removal.acceptance-dataset/1", "requiredProjectRealReviewedCaseCount": 15, "cases": cases}), encoding="utf-8")


@contextmanager
def temporary_benchmark_root(root: Path):
    previous_root, previous_manifest = run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH
    run_benchmark.BENCHMARK_ROOT = root
    run_benchmark.ACCEPTANCE_DATASET_PATH = root / "acceptance-dataset.json"
    try:
        yield
    finally:
        run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH = previous_root, previous_manifest


class AcceptanceDatasetManifestTests(unittest.TestCase):
    def _fifteen_real_cases(self, root: Path) -> list[dict[str, object]]:
        return [write_case(root, f"BR-{index:03d}") for index in range(1, 16)]

    def test_empty_manifest_cannot_make_debug_case_acceptance_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_case(root, "BR-001", role="SYNTHETIC_DEBUG", lineage="synthetic/br-001")
            write_manifest(root, [])
            with temporary_benchmark_root(root), self.assertRaisesRegex(ValueError, "requires 15 approved project-real"):
                run_benchmark.load_cases(type("Args", (), {"all_cases": True, "case": None})(), {"requiredCaseCount": 15})

    def test_fifteen_synthetic_cases_cannot_satisfy_formal_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = [write_case(root, f"BR-{index:03d}", role="SYNTHETIC_DEBUG", lineage=f"synthetic/{index}") for index in range(1, 16)]
            write_manifest(root, cases)
            with temporary_benchmark_root(root), self.assertRaisesRegex(ValueError, "formal manifest may contain only"):
                run_benchmark.load_acceptance_cases()

    def test_debug_plus_fourteen_real_cases_cannot_satisfy_formal_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            debug = write_case(root, "BR-001", role="SYNTHETIC_DEBUG", lineage="synthetic/br-001")
            real = [write_case(root, f"BR-{index:03d}") for index in range(2, 16)]
            write_manifest(root, [debug, *real])
            with temporary_benchmark_root(root), self.assertRaisesRegex(ValueError, "formal manifest may contain only"):
                run_benchmark.load_acceptance_cases()

    def test_fifteen_signed_project_real_cases_pass_and_unlisted_debug_is_excluded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = self._fifteen_real_cases(root)
            write_case(root, "BR-999", role="SYNTHETIC_DEBUG", lineage="synthetic/br-999")
            write_manifest(root, cases)
            with temporary_benchmark_root(root):
                records, validation, snapshot = run_benchmark.load_acceptance_cases()
            self.assertEqual(len(records), 15)
            self.assertTrue(validation["valid"])
            self.assertEqual(validation["projectRealReviewedCaseCount"], 15)
            self.assertEqual(validation["sourceLineageCount"], 15)
            self.assertNotIn("BR-999", validation["selectedCaseIds"])
            self.assertIn("BR-999", validation["excludedDebugCaseIds"])
            self.assertEqual(len(snapshot["cases"]), 15)

    def test_review_states_and_roles_never_count(self) -> None:
        for review in (
            {"state": "PENDING", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"},
            {"state": "REJECTED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"},
            {"state": "APPROVED", "signoff": "NOT_SIGNED", "reviewerRole": "PROJECT_DATASET_REVIEWER"},
            {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "OTHER"},
        ):
            with self.subTest(review=review), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); cases = self._fifteen_real_cases(root); cases[0]["groundTruthReview"] = review; write_manifest(root, cases)
                with temporary_benchmark_root(root), self.assertRaisesRegex(ValueError, "ground truth review"):
                    run_benchmark.load_acceptance_cases()

    def test_identity_mismatches_duplicates_and_case_identity_drift_fail_closed(self) -> None:
        mutations = ("source", "groundTruth", "metadata", "duplicateCase", "duplicateLineage", "role", "lineage")
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); cases = self._fifteen_real_cases(root)
                if mutation == "source": (root / "cases" / "BR-001" / "source.png").write_bytes(b"changed")
                elif mutation == "groundTruth": (root / "cases" / "BR-001" / "ground_truth.png").write_bytes(b"changed")
                elif mutation == "metadata": (root / "cases" / "BR-001" / "case.json").write_text("{}", encoding="utf-8")
                elif mutation == "duplicateCase": cases.append(dict(cases[0]))
                elif mutation == "duplicateLineage": cases[1]["sourceLineageId"] = cases[0]["sourceLineageId"]
                elif mutation == "role":
                    metadata = root / "cases" / "BR-001" / "case.json"; payload = json.loads(metadata.read_text(encoding="utf-8")); payload["datasetRole"] = "SYNTHETIC_DEBUG"; metadata.write_text(json.dumps(payload), encoding="utf-8")
                elif mutation == "lineage":
                    metadata = root / "cases" / "BR-001" / "case.json"; payload = json.loads(metadata.read_text(encoding="utf-8")); payload["sourceLineageId"] = "changed-lineage"; metadata.write_text(json.dumps(payload), encoding="utf-8")
                write_manifest(root, cases)
                with temporary_benchmark_root(root), self.assertRaises(ValueError):
                    run_benchmark.load_acceptance_cases()


if __name__ == "__main__":
    unittest.main()
