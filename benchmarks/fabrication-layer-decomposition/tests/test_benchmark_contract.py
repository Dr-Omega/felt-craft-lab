from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

from inspect_fixture import inspect_fixture  # noqa: E402
from validate_benchmark import validate_benchmark  # noqa: E402


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
        "expectedColorRegions": {"approximateCount": 1, "mustKeepSeparate": [], "mustMerge": []},
        "expectedPieces": {"minReasonableCount": 1, "maxReasonableCount": 1},
        "expectedStacking": {"requiredBelowRelations": []},
        "voidPolicy": {"globalVoidsExpected": 0, "mustPreserveGlobalVoid": False},
        "manufacturingNotes": [], "knownDifficulty": [], "manualJudgementNotes": "",
    }


def _make_root() -> Path:
    root = Path(tempfile.mkdtemp())
    (root / "fixtures" / "source").mkdir(parents=True)
    (root / "fixtures" / "ground-truth").mkdir(parents=True)
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(root / "fixtures" / "source" / "FLD-001.png")
    _write_json(root / "fixtures" / "ground-truth" / "FLD-001.json", _valid_gt())
    _write_json(root / "benchmark_manifest.json", {"fixtures": [_valid_fixture()]})
    return root


class BenchmarkContractTests(unittest.TestCase):
    def _errors_for(self, mutate) -> list[str]:
        root = _make_root()
        self.addCleanup(lambda: __import__("shutil").rmtree(root))
        mutate(root)
        return validate_benchmark(root)

    def test_valid_benchmark_passes(self):
        self.assertEqual(self._errors_for(lambda _root: None), [])

    def test_duplicate_fixture_id_fails(self):
        def mutate(root):
            manifest = json.loads((root / "benchmark_manifest.json").read_text())
            manifest["fixtures"].append(copy.deepcopy(manifest["fixtures"][0]))
            _write_json(root / "benchmark_manifest.json", manifest)
        self.assertTrue(any("duplicate fixtureId" in item for item in self._errors_for(mutate)))

    def test_missing_source_or_ground_truth_fails(self):
        self.assertTrue(any("missing source" in item for item in self._errors_for(lambda root: (root / "fixtures/source/FLD-001.png").unlink())))
        self.assertTrue(any("missing GT" in item for item in self._errors_for(lambda root: (root / "fixtures/ground-truth/FLD-001.json").unlink())))

    def test_malformed_json_fails(self):
        self.assertTrue(any("invalid JSON" in item for item in self._errors_for(lambda root: (root / "fixtures/ground-truth/FLD-001.json").write_text("{"))))

    def test_unknown_geometry_tag_and_id_mismatch_fail(self):
        def mutate_tag(root):
            manifest = json.loads((root / "benchmark_manifest.json").read_text())
            manifest["fixtures"][0]["geometryTags"] = ["NOT_A_TAG"]
            _write_json(root / "benchmark_manifest.json", manifest)
        self.assertTrue(any("unknown geometry tag" in item for item in self._errors_for(mutate_tag)))
        self.assertTrue(any("ID mismatch" in item for item in self._errors_for(lambda root: _write_json(root / "fixtures/ground-truth/FLD-001.json", _valid_gt("FLD-999")))))

    def test_invalid_image_fails(self):
        self.assertTrue(any("invalid image" in item for item in self._errors_for(lambda root: (root / "fixtures/source/FLD-001.png").write_bytes(b"not-png"))))

    def test_inspect_fixture_does_not_mutate_source(self):
        root = _make_root()
        self.addCleanup(lambda: __import__("shutil").rmtree(root))
        source = root / "fixtures/source/FLD-001.png"
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        summary = inspect_fixture("FLD-001", root)
        after = hashlib.sha256(source.read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(summary["fixtureId"], "FLD-001")
        self.assertEqual(summary["source"]["mode"], "RGBA")


if __name__ == "__main__":
    unittest.main()
