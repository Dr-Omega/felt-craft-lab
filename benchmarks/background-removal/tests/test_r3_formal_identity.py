from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import benchmark_lib  # noqa: E402
import finalize_benchmark  # noqa: E402
import run_benchmark  # noqa: E402


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


@contextmanager
def formal_sandbox():
    """Exercise the production validators against a complete, byte-pinned dataset."""
    with tempfile.TemporaryDirectory() as temporary:
        repo = Path(temporary) / "repo"
        bench = repo / "benchmarks" / "background-removal"
        for relative in (
            "benchmark-config.json",
            "acceptance-environment.json",
            "model-manifest.json",
            "scripts/benchmark_lib.py",
            "scripts/run_benchmark.py",
            "scripts/finalize_benchmark.py",
        ):
            destination = bench / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        backend = repo / "backend" / "services"
        backend.mkdir(parents=True)
        shutil.copy2(ROOT.parents[1] / "backend" / "services" / "image_postprocess.py", backend / "image_postprocess.py")

        manifest = json.loads((bench / "model-manifest.json").read_text(encoding="utf-8"))
        cache = bench / "models" / "rembg-cache"
        cache.mkdir(parents=True)
        for model_id, learned in manifest["models"].items():
            if model_id == "current-rule":
                continue
            learned_bytes = f"verified {model_id} test artifact".encode("utf-8")
            (cache / learned["cacheFile"]).write_bytes(learned_bytes)
            learned["modelSha256"] = __import__("hashlib").sha256(learned_bytes).hexdigest()
        write_json(bench / "model-manifest.json", manifest)

        cases: list[dict[str, object]] = []
        for number in range(1, 16):
            case_id = f"BR-{number:03d}"
            case_dir = bench / "cases" / case_id
            case_dir.mkdir(parents=True)
            metadata = {"caseId": case_id, "datasetRole": "PROJECT_REAL_ACCEPTANCE", "sourceLineageId": f"project/{case_id.lower()}", "category": "test", "description": "formal fixture", "criticalStructures": ["subject"]}
            write_json(case_dir / "case.json", metadata)
            Image.new("RGB", (4, 4), "white").save(case_dir / "source.png")
            Image.new("L", (4, 4), 255).save(case_dir / "ground_truth.png")
            evidence = bench / "evidence" / f"{case_id}.json"
            write_json(evidence, {"caseId": case_id, "review": "approved"})
            cases.append({
                "caseId": case_id,
                "datasetRole": "PROJECT_REAL_ACCEPTANCE",
                "sourceLineageId": metadata["sourceLineageId"],
                "sourceFile": "source.png",
                "sourceSha256": benchmark_lib.sha256_file(case_dir / "source.png"),
                "groundTruthSha256": benchmark_lib.sha256_file(case_dir / "ground_truth.png"),
                "caseMetadataSha256": benchmark_lib.sha256_file(case_dir / "case.json"),
                "coverageTags": ["unit-test", f"slot-{number:02d}"],
                "primaryCoverageSlot": f"slot-{number:02d}",
                "groundTruthReview": {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER", "evidence": {"file": f"evidence/{case_id}.json", "sha256": benchmark_lib.sha256_file(evidence)}},
            })
        dataset = {"schemaVersion": "background-removal.acceptance-dataset/2", "requiredProjectRealReviewedCaseCount": 15, "cases": cases}
        write_json(bench / "acceptance-dataset.json", dataset)

        freeze = json.loads((ROOT / "acceptance-freeze.json").read_text(encoding="utf-8"))
        freeze["files"]["benchmarks/background-removal/acceptance-dataset.json"] = benchmark_lib.sha256_file(bench / "acceptance-dataset.json")
        freeze["files"]["benchmarks/background-removal/model-manifest.json"] = benchmark_lib.sha256_file(bench / "model-manifest.json")
        write_json(bench / "acceptance-freeze.json", freeze)

        modules = (benchmark_lib, run_benchmark, finalize_benchmark)
        original = {module: {name: getattr(module, name) for name in ("BENCHMARK_ROOT", "FREEZE_PATH") if hasattr(module, name)} for module in modules}
        original[benchmark_lib].update({"REPO_ROOT": benchmark_lib.REPO_ROOT, "BACKEND_ROOT": benchmark_lib.BACKEND_ROOT, "MODEL_CACHE_ROOT": benchmark_lib.MODEL_CACHE_ROOT})
        original[run_benchmark]["ACCEPTANCE_DATASET_PATH"] = run_benchmark.ACCEPTANCE_DATASET_PATH
        try:
            benchmark_lib.BENCHMARK_ROOT, benchmark_lib.REPO_ROOT = bench, repo
            benchmark_lib.BACKEND_ROOT, benchmark_lib.MODEL_CACHE_ROOT, benchmark_lib.FREEZE_PATH = repo / "backend", cache, bench / "acceptance-freeze.json"
            run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH, run_benchmark.FREEZE_PATH = bench, bench / "acceptance-dataset.json", bench / "acceptance-freeze.json"
            finalize_benchmark.BENCHMARK_ROOT, finalize_benchmark.FREEZE_PATH = bench, bench / "acceptance-freeze.json"
            yield bench
        finally:
            for module, values in original.items():
                for name, value in values.items():
                    setattr(module, name, value)


def formal_run(models: list[str] | None = None) -> dict[str, object]:
    selected = models or list(benchmark_lib.FORMAL_MODEL_ORDER)
    cases, validation, snapshot = run_benchmark.load_acceptance_cases()
    return run_benchmark.initial_result(benchmark_lib.load_config(), selected, SimpleNamespace(all_cases=True), cases, benchmark_lib.load_manifest(), validation, snapshot)


class R3FormalIdentityTests(unittest.TestCase):
    def test_formal_freeze_environment_model_and_dataset_bindings_fail_closed(self) -> None:
        with formal_sandbox() as bench:
            valid = formal_run()
            finalize_benchmark.verify_dataset_snapshot_integrity(valid)
            for mutation in ("missingFreeze", "forgedFreeze", "environment", "package", "revision", "expectedSha", "license", "datasetRunFields"):
                with self.subTest(mutation=mutation):
                    run = copy.deepcopy(valid)
                    if mutation == "missingFreeze":
                        run.pop("acceptanceFreezeSha256")
                    elif mutation == "forgedFreeze":
                        run["acceptanceFreezeSha256"] = "0" * 64
                    elif mutation in {"environment", "package"}:
                        contract = run["reproducibility"]["environmentContract"]
                        if mutation == "environment":
                            contract["python"] = "9.99"
                        else:
                            contract["packages"]["Pillow"] = "drift"
                        run["reproducibility"]["environmentContractSha256"] = benchmark_lib.canonical_environment_contract_sha256(contract)
                    elif mutation == "datasetRunFields":
                        run["datasetValidation"]["manifestSha256"] = "0" * 64
                        run["datasetSnapshot"]["acceptanceDatasetManifestSha256"] = "0" * 64
                    else:
                        field = {"revision": "exactModelRevision", "expectedSha": "expectedSha256", "license": "weightLicenseVerificationStatus"}[mutation]
                        run["reproducibility"]["modelArtifacts"]["current-rule"][field] = "forged"
                    with self.assertRaises(ValueError):
                        finalize_benchmark.verify_dataset_snapshot_integrity(run)

            legacy = copy.deepcopy(valid)
            legacy["datasetValidation"]["manifestSchemaVersion"] = "background-removal.acceptance-dataset/1"
            with self.assertRaisesRegex(ValueError, "schema v2"):
                finalize_benchmark.verify_dataset_snapshot_integrity(legacy)

            cross_freeze = copy.deepcopy(valid)
            freeze_path = bench / "acceptance-freeze.json"
            changed = json.loads(freeze_path.read_text(encoding="utf-8")); changed["recipeVersion"] = "other-valid-recipe"
            write_json(freeze_path, changed)
            with self.assertRaisesRegex(ValueError, "freeze identity"):
                finalize_benchmark.verify_dataset_snapshot_integrity(cross_freeze)

    def test_artifact_and_review_evidence_are_reverified_from_bytes(self) -> None:
        with formal_sandbox() as bench:
            learned = formal_run()
            finalize_benchmark.verify_dataset_snapshot_integrity(learned)
            artifact = bench / "models" / "rembg-cache" / "isnet-anime.onnx"
            artifact.write_bytes(b"tampered")
            learned["reproducibility"]["modelArtifacts"]["isnet-anime"]["artifactVerified"] = True
            learned["reproducibility"]["modelArtifacts"]["isnet-anime"]["sha256Match"] = True
            with self.assertRaisesRegex(ValueError, "artifact"):
                finalize_benchmark.verify_dataset_snapshot_integrity(learned)

        with formal_sandbox() as bench:
            run = formal_run()
            evidence = bench / "evidence" / "BR-001.json"
            for mutation in ("missing", "bytes", "hash", "parent", "absolute"):
                with self.subTest(mutation=mutation):
                    changed = copy.deepcopy(run)
                    if mutation == "missing":
                        evidence.unlink()
                    elif mutation == "bytes":
                        evidence.write_text("changed", encoding="utf-8")
                    elif mutation == "hash":
                        changed["datasetSnapshot"]["cases"][0]["groundTruthReview"]["evidence"]["sha256"] = "0" * 64
                    elif mutation == "parent":
                        changed["datasetSnapshot"]["cases"][0]["groundTruthReview"]["evidence"]["file"] = "../outside.json"
                    else:
                        changed["datasetSnapshot"]["cases"][0]["groundTruthReview"]["evidence"]["file"] = str(evidence.resolve())
                    with self.assertRaises(ValueError):
                        finalize_benchmark.verify_dataset_snapshot_integrity(changed)
                    if mutation == "missing":
                        write_json(evidence, {"caseId": "BR-001", "review": "approved"})
                    elif mutation == "bytes":
                        write_json(evidence, {"caseId": "BR-001", "review": "approved"})

    def test_v2_slots_evidence_paths_and_semantics_are_strict(self) -> None:
        with formal_sandbox() as bench:
            records, _validation, _snapshot = run_benchmark.load_acceptance_cases()
            self.assertEqual(len(records), 15)
            dataset_path = bench / "acceptance-dataset.json"
            original = json.loads(dataset_path.read_text(encoding="utf-8"))
            for mutation in ("fourteenSlots", "oneCaseAllSlots", "duplicateLineage", "unapproved", "synthetic", "parentPath", "absolutePath"):
                with self.subTest(mutation=mutation):
                    changed = copy.deepcopy(original)
                    if mutation == "fourteenSlots":
                        changed["cases"][-1]["primaryCoverageSlot"] = "slot-14"
                    elif mutation == "oneCaseAllSlots":
                        changed["cases"][-1]["primaryCoverageSlot"] = "slot-01"
                        changed["cases"][-1]["coverageTags"] = [f"slot-{number:02d}" for number in range(1, 16)]
                    elif mutation == "duplicateLineage":
                        changed["cases"][1]["sourceLineageId"] = changed["cases"][0]["sourceLineageId"]
                    elif mutation == "unapproved":
                        changed["cases"][0]["groundTruthReview"]["state"] = "APPROVED"; changed["cases"][0]["groundTruthReview"]["signoff"] = "NOT_SIGNED"
                    elif mutation == "synthetic":
                        changed["cases"][0]["datasetRole"] = "SYNTHETIC_DEBUG"
                    elif mutation == "parentPath":
                        changed["cases"][0]["groundTruthReview"]["evidence"]["file"] = "../escape.json"
                    else:
                        changed["cases"][0]["groundTruthReview"]["evidence"]["file"] = str((bench / "evidence" / "BR-001.json").resolve())
                    write_json(dataset_path, changed)
                    with self.assertRaises(ValueError):
                        run_benchmark.load_acceptance_cases()
                    write_json(dataset_path, original)

            result = formal_run()
            result["caseResults"] = [{"caseId": "BR-001", "modelId": "current-rule", "status": "SUCCESS", "metrics": {}, "performance": {}, "manualReview": {"boundaryQuality": "A", "criticalStructure": "FAIL", "visibleInternalHole": False, "hardFailReasons": []}}]
            run_benchmark.write_results(result)
            semantics = result["acceptanceSemantics"]
            self.assertEqual(semantics["datasetAcceptanceStatus"], "DATASET_ACCEPTANCE_COMPLETE")
            self.assertEqual(semantics["modelQualityResult"], "REVIEWED_HARD_FAILURE_PRESENT")
            self.assertEqual(semantics["modelSelectionStatus"], "NOT_SELECTED")
            result["caseResults"][0]["manualReview"]["criticalStructure"] = "PASS"
            run_benchmark.write_results(result)
            self.assertEqual(result["acceptanceSemantics"]["modelQualityResult"], "QUALITY_NOT_SELECTED_BY_ACCEPTANCE")
            result["reproducibility"] = {}
            run_benchmark.write_results(result)
            self.assertEqual(result["acceptanceSemantics"]["reproducibilityStatus"], "REPRODUCIBILITY_INCOMPLETE")
            result["datasetSnapshot"]["cases"] = result["datasetSnapshot"]["cases"][:-1]
            run_benchmark.write_results(result)
            self.assertEqual(result["acceptanceSemantics"]["datasetAcceptanceStatus"], "DATASET_ACCEPTANCE_INCOMPLETE")

    def test_formal_model_configuration_and_snapshot_tampering_fail_closed(self) -> None:
        with formal_sandbox() as bench:
            valid = formal_run()
            finalize_benchmark.verify_dataset_snapshot_integrity(valid)
            for models in (
                ["current-rule"],
                ["isnet-anime"],
                list(benchmark_lib.FORMAL_MODEL_ORDER[:2]),
                list(benchmark_lib.FORMAL_MODEL_ORDER[:3]),
                list(reversed(benchmark_lib.FORMAL_MODEL_ORDER)),
                ["current-rule", "isnet-anime", "birefnet-general-lite", "other"],
            ):
                with self.subTest(models=models):
                    changed = copy.deepcopy(valid)
                    changed["selectedModels"] = models
                    changed["configuration"]["modelOrder"] = models
                    changed["models"] = {model_id: changed["models"][model_id] for model_id in models if model_id in changed["models"]}
                    changed["reproducibility"]["modelArtifacts"] = {model_id: changed["reproducibility"]["modelArtifacts"][model_id] for model_id in models if model_id in changed["reproducibility"]["modelArtifacts"]}
                    changed["caseResults"] = [row for row in changed["caseResults"] if row["modelId"] in models]
                    with self.assertRaises(ValueError):
                        finalize_benchmark.verify_dataset_snapshot_integrity(changed)
                    self.assertNotEqual(benchmark_lib.classify_benchmark_status(changed), "ACCEPTANCE_COMPLETE")

            for field, value in (("cpuOnly", False), ("alphaThreshold", 129), ("warmRuns", 6), ("rssSampleIntervalMs", 11), ("internalHoleErosionKernel", 3), ("requiredCaseCount", 16)):
                with self.subTest(config_field=field):
                    changed = copy.deepcopy(valid)
                    changed["configuration"][field] = value
                    with self.assertRaisesRegex(ValueError, "configuration"):
                        finalize_benchmark.verify_dataset_snapshot_integrity(changed)

            mutations = {
                "caseSubstitution": lambda snapshot: snapshot["cases"].__setitem__(0, {**snapshot["cases"][0], "caseId": "BR-002"}),
                "lineage": lambda snapshot: snapshot["cases"][0].__setitem__("sourceLineageId", "project/substituted"),
                "coverage": lambda snapshot: snapshot["cases"][0].__setitem__("coverageTags", ["drift"]),
                "slot": lambda snapshot: snapshot["cases"][0].__setitem__("primaryCoverageSlot", "slot-15"),
                "reviewState": lambda snapshot: snapshot["cases"][0]["groundTruthReview"].__setitem__("state", "PENDING"),
                "reviewSignoff": lambda snapshot: snapshot["cases"][0]["groundTruthReview"].__setitem__("signoff", "NOT_SIGNED"),
                "reviewRole": lambda snapshot: snapshot["cases"][0]["groundTruthReview"].__setitem__("reviewerRole", "OTHER"),
            }
            substitute = bench / "evidence" / "substitute.json"
            write_json(substitute, {"review": "different but valid"})
            for name, mutate in mutations.items():
                with self.subTest(snapshot=name):
                    changed = copy.deepcopy(valid)
                    mutate(changed["datasetSnapshot"])
                    with self.assertRaisesRegex(ValueError, "snapshot"):
                        finalize_benchmark.verify_dataset_snapshot_integrity(changed)
            evidence_substitution = copy.deepcopy(valid)
            evidence_substitution["datasetSnapshot"]["cases"][0]["groundTruthReview"]["evidence"] = {"file": "evidence/substitute.json", "sha256": benchmark_lib.sha256_file(substitute)}
            with self.assertRaisesRegex(ValueError, "snapshot"):
                finalize_benchmark.verify_dataset_snapshot_integrity(evidence_substitution)

    def test_freeze_paths_opacity_and_lineage_fail_closed(self) -> None:
        with formal_sandbox() as bench:
            self.assertEqual(len(run_benchmark.load_acceptance_cases()[0]), 15)
            freeze_path = bench / "acceptance-freeze.json"
            original = json.loads(freeze_path.read_text(encoding="utf-8"))
            for path in ("../outside.json", "../../outside.json", str((bench / "benchmark-config.json").resolve())):
                with self.subTest(path=path):
                    changed = copy.deepcopy(original)
                    changed["files"][path] = "0" * 64
                    write_json(freeze_path, changed)
                    with self.assertRaises(ValueError):
                        benchmark_lib.validate_acceptance_freeze()
                    write_json(freeze_path, original)

            case_dir = bench / "cases" / "BR-001"
            metadata_path, source = case_dir / "case.json", case_dir / "source.png"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            for lineage in ("", "provisional:x", "Provisional:x", "temporary:x", "temp:x", "TEMP:x"):
                with self.subTest(lineage=lineage):
                    metadata["sourceLineageId"] = lineage
                    write_json(metadata_path, metadata)
                    with self.assertRaises(ValueError):
                        run_benchmark.validate_case(case_dir)
            metadata["sourceLineageId"] = "project/stable"
            write_json(metadata_path, metadata)
            for alpha in (0, 1, 128, 254):
                with self.subTest(alpha=alpha):
                    Image.new("RGBA", (4, 4), (255, 255, 255, alpha)).save(source)
                    with self.assertRaisesRegex(ValueError, "fully opaque"):
                        run_benchmark.validate_case(case_dir)
            Image.new("RGBA", (4, 4), (255, 255, 255, 255)).save(source)
            run_benchmark.validate_case(case_dir)
            Image.new("RGB", (4, 4), "white").save(source)
            run_benchmark.validate_case(case_dir)


if __name__ == "__main__":
    unittest.main()
