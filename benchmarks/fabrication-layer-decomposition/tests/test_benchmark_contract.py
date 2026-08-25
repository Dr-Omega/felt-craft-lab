from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

from inspect_fixture import inspect_fixture  # noqa: E402
from validate_benchmark import BENCHMARK_ROOT, main, validate_benchmark  # noqa: E402


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def _valid_fixture() -> dict:
    return {
        "fixtureId": "FLD-001",
        "fixtureType": "synthetic_unit",
        "sourceFile": "fixtures/source/FLD-001.png",
        "groundTruthFile": "fixtures/ground-truth/FLD-001.json",
        "categoryHint": None,
        "geometryTags": ["G01_SIMPLE_FLAT"],
        "sourceCharacteristics": {"hasTransparentBackground": True, "hasColorDrift": False, "hasGradient": False, "hasShadow": False, "hasTexture": False, "hasGlobalVoid": False},
        "benchmarkUse": {"colorPurification": True, "genericDecomposition": True},
        "sourceAudit": {"originalSourcePath": "test-only", "selectionRationale": "unit fixture"},
        "notes": "",
    }


def _valid_gt(fixture_id: str = "FLD-001") -> dict:
    return {
        "fixtureId": fixture_id,
        "expectedColorRegions": {"approximateCount": 1, "mustKeepSeparate": []},
        "expectedPieces": {"minReasonableCount": 1, "maxReasonableCount": 1},
        "expectedStacking": {"requiredBelowRelations": []},
        "voidPolicy": {"globalVoidsExpected": 0, "mustPreserveGlobalVoid": False},
        "manufacturingNotes": [], "knownDifficulty": [], "manualJudgementNotes": "",
    }


def _make_root() -> Path:
    root = Path(tempfile.mkdtemp())
    (root / "fixtures" / "source").mkdir(parents=True)
    (root / "fixtures" / "ground-truth").mkdir(parents=True)
    source = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    source.putpixel((0, 0), (255, 0, 0, 0))
    source.save(root / "fixtures" / "source" / "FLD-001.png")
    _write_json(root / "fixtures" / "ground-truth" / "FLD-001.json", _valid_gt())
    _write_json(root / "benchmark_manifest.json", {"fixtures": [_valid_fixture()]})
    return root


class BenchmarkContractTests(unittest.TestCase):
    def _root(self) -> Path:
        root = _make_root()
        self.addCleanup(shutil.rmtree, root)
        return root

    def _errors_for(self, mutate) -> list[str]:
        root = self._root()
        mutate(root)
        return validate_benchmark(root)

    @staticmethod
    def _manifest(root: Path) -> dict:
        return json.loads((root / "benchmark_manifest.json").read_text())

    def _mutate_manifest(self, root: Path, mutate) -> None:
        manifest = self._manifest(root)
        mutate(manifest)
        _write_json(root / "benchmark_manifest.json", manifest)

    def _mutate_gt(self, root: Path, mutate) -> None:
        path = root / "fixtures" / "ground-truth" / "FLD-001.json"
        gt = json.loads(path.read_text())
        mutate(gt)
        _write_json(path, gt)

    def _project_real_root(self) -> Path:
        root = self._root()
        original = root / "project-originals" / "FLD-001.png"
        original.parent.mkdir()
        shutil.copyfile(root / "fixtures" / "source" / "FLD-001.png", original)
        self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0].update({
            "fixtureType": "project_real",
            "sourceAudit": {"originalSourcePath": "project-originals/FLD-001.png", "selectionRationale": "copied test source"},
        }))
        return root

    def test_valid_benchmark_passes(self):
        self.assertEqual(self._errors_for(lambda _root: None), [])

    def test_duplicate_fixture_id_fails(self):
        errors = self._errors_for(lambda root: self._mutate_manifest(root, lambda manifest: manifest["fixtures"].append(copy.deepcopy(manifest["fixtures"][0]))))
        self.assertTrue(any("duplicate fixtureId" in item for item in errors))

    def test_missing_source_or_ground_truth_fails(self):
        self.assertTrue(any("missing source" in item for item in self._errors_for(lambda root: (root / "fixtures/source/FLD-001.png").unlink())))
        self.assertTrue(any("missing GT" in item for item in self._errors_for(lambda root: (root / "fixtures/ground-truth/FLD-001.json").unlink())))

    def test_malformed_json_fails(self):
        errors = self._errors_for(lambda root: (root / "fixtures/ground-truth/FLD-001.json").write_text("{"))
        self.assertTrue(any("invalid JSON" in item for item in errors))

    def test_unknown_geometry_tag_and_id_mismatch_fail(self):
        tag_errors = self._errors_for(lambda root: self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0].update({"geometryTags": ["NOT_A_TAG"]})))
        mismatch_errors = self._errors_for(lambda root: self._mutate_gt(root, lambda gt: gt.update({"fixtureId": "FLD-999"})))
        self.assertTrue(any("unknown geometry tag" in item for item in tag_errors))
        self.assertTrue(any("ID mismatch" in item for item in mismatch_errors))

    def test_invalid_image_fails(self):
        errors = self._errors_for(lambda root: (root / "fixtures/source/FLD-001.png").write_bytes(b"not-png"))
        self.assertTrue(any("invalid image" in item for item in errors))

    def test_unknown_fixture_top_level_field_fails(self):
        errors = self._errors_for(lambda root: self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0].update({"unexpected": True})))
        self.assertTrue(any("unknown fixture fields" in item for item in errors))

    def test_unknown_ground_truth_top_level_field_fails(self):
        errors = self._errors_for(lambda root: self._mutate_gt(root, lambda gt: gt.update({"unexpected": True})))
        self.assertTrue(any("unknown GT fields" in item for item in errors))

    def test_unknown_nested_fixture_and_ground_truth_fields_fail(self):
        fixture_errors = self._errors_for(lambda root: self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0]["sourceCharacteristics"].update({"extra": False})))
        gt_errors = self._errors_for(lambda root: self._mutate_gt(root, lambda gt: gt["expectedPieces"].update({"extra": 1})))
        self.assertTrue(any("invalid sourceCharacteristics" in item for item in fixture_errors))
        self.assertTrue(any("invalid expectedPieces" in item for item in gt_errors))

    def test_source_and_ground_truth_paths_must_match_fixture_id(self):
        source_errors = self._errors_for(lambda root: self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0].update({"sourceFile": "fixtures/source/other.png"})))
        gt_errors = self._errors_for(lambda root: self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0].update({"groundTruthFile": "fixtures/ground-truth/other.json"})))
        self.assertTrue(any("sourceFile must be fixtures/source/FLD-001.png" in item for item in source_errors))
        self.assertTrue(any("groundTruthFile must be fixtures/ground-truth/FLD-001.json" in item for item in gt_errors))

    def test_invalid_expected_piece_range_fails(self):
        errors = self._errors_for(lambda root: self._mutate_gt(root, lambda gt: gt.update({"expectedPieces": {"minReasonableCount": 0, "maxReasonableCount": 0}})))
        self.assertTrue(any("invalid expectedPieces" in item for item in errors))

    def test_all_opaque_image_cannot_claim_transparent_background(self):
        def mutate(root: Path) -> None:
            Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(root / "fixtures" / "source" / "FLD-001.png")
        errors = self._errors_for(mutate)
        self.assertTrue(any("requires transparent pixels" in item for item in errors))

    def test_fully_transparent_image_fails(self):
        def mutate(root: Path) -> None:
            Image.new("RGBA", (8, 8), (255, 0, 0, 0)).save(root / "fixtures" / "source" / "FLD-001.png")
        errors = self._errors_for(mutate)
        self.assertTrue(any("fully transparent" in item for item in errors))

    def test_project_real_missing_original_source_fails(self):
        root = self._root()
        self._mutate_manifest(root, lambda manifest: manifest["fixtures"][0].update({
            "fixtureType": "project_real",
            "sourceAudit": {"originalSourcePath": "missing/FLD-001.png", "selectionRationale": "missing source test"},
        }))
        self.assertTrue(any("original source is missing" in item for item in validate_benchmark(root)))

    def test_project_real_copied_source_sha_mismatch_fails(self):
        root = self._project_real_root()
        (root / "project-originals" / "FLD-001.png").write_bytes(b"different bytes")
        self.assertTrue(any("copied source SHA mismatch" in item for item in validate_benchmark(root)))

    def test_fld004_separates_geometry_from_shared_color(self):
        gt = json.loads((BENCHMARK_ROOT / "fixtures/ground-truth/FLD-004.json").read_text())
        self.assertNotIn("mustMerge", gt["expectedColorRegions"])
        self.assertEqual(gt["expectedGeometryComponents"]["mustRemainSeparate"], [["rear petal left", "rear petal right"]])
        self.assertEqual(gt["expectedColorRelations"]["mustShareColor"], [["rear petal left", "rear petal right"]])

    def test_global_void_rejects_holed_single_piece_contract(self):
        errors = self._errors_for(lambda root: self._mutate_gt(root, lambda gt: gt.update({
            "expectedPieces": {"minReasonableCount": 1, "maxReasonableCount": 1},
            "voidPolicy": {"globalVoidsExpected": 1, "mustPreserveGlobalVoid": True},
            "expectedDisposition": {"allowedOutcomes": ["MANUAL_REQUIRED"]},
        })))
        self.assertTrue(any("global void requires at least two solid pieces" in item for item in errors))

    def test_fld007_allows_only_solid_multi_piece_or_manual_required(self):
        gt = json.loads((BENCHMARK_ROOT / "fixtures/ground-truth/FLD-007.json").read_text())
        self.assertGreaterEqual(gt["expectedPieces"]["minReasonableCount"], 2)
        self.assertEqual(set(gt["expectedDisposition"]["allowedOutcomes"]), {"MULTI_SOLID_PIECE", "MANUAL_REQUIRED"})

    def test_success_summary_counts_fixture_and_ground_truth_records_dynamically(self):
        root = self._root()
        manifest = self._manifest(root)
        second = copy.deepcopy(manifest["fixtures"][0])
        second.update({"fixtureId": "FLD-002", "sourceFile": "fixtures/source/FLD-002.png", "groundTruthFile": "fixtures/ground-truth/FLD-002.json"})
        manifest["fixtures"].append(second)
        _write_json(root / "benchmark_manifest.json", manifest)
        shutil.copyfile(root / "fixtures/source/FLD-001.png", root / "fixtures/source/FLD-002.png")
        _write_json(root / "fixtures/ground-truth/FLD-002.json", _valid_gt("FLD-002"))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(main(root), 0)
        self.assertIn("2 fixtures, 2 structural ground-truth records", output.getvalue())

    def test_inspect_fixture_does_not_mutate_source(self):
        root = self._root()
        source = root / "fixtures/source/FLD-001.png"
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        summary = inspect_fixture("FLD-001", root)
        after = hashlib.sha256(source.read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(summary["fixtureId"], "FLD-001")
        self.assertEqual(summary["source"]["mode"], "RGBA")


if __name__ == "__main__":
    unittest.main()
