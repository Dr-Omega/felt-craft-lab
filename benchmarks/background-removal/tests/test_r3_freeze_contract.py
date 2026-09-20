from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import benchmark_lib
import run_benchmark


class R3FreezeContractTests(unittest.TestCase):
    def test_freeze_is_non_self_referential_and_valid(self) -> None:
        freeze = benchmark_lib.validate_acceptance_freeze()
        self.assertNotIn("acceptance-freeze.json", freeze["files"])
        self.assertEqual(freeze["formalModelOrder"], benchmark_lib.FORMAL_MODEL_ORDER)

    def test_each_bound_file_tamper_fails_closed(self) -> None:
        freeze = benchmark_lib.validate_acceptance_freeze()
        for target in freeze["files"]:
            with self.subTest(target=target):
                path = benchmark_lib.REPO_ROOT / target
                original = path.read_bytes()
                try:
                    path.write_bytes(original + b" ")
                    with self.assertRaisesRegex(ValueError, "identity mismatch"):
                        benchmark_lib.validate_acceptance_freeze()
                finally:
                    path.write_bytes(original)

    def test_formal_model_set_mutations_fail_closed(self) -> None:
        config_path = ROOT / "benchmark-config.json"
        original = config_path.read_bytes()
        try:
            data = json.loads(original)
            for models in (["current-rule"], [*benchmark_lib.FORMAL_MODEL_ORDER, "extra"], list(reversed(benchmark_lib.FORMAL_MODEL_ORDER)), ["current-rule", "other", *benchmark_lib.FORMAL_MODEL_ORDER[2:]]):
                data["modelOrder"] = models
                config_path.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError):
                    benchmark_lib.validate_acceptance_freeze()
        finally:
            config_path.write_bytes(original)

    def test_formal_source_requires_full_opacity_and_stable_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary) / "BR-001"; case.mkdir()
            base = {"caseId": "BR-001", "datasetRole": "PROJECT_REAL_ACCEPTANCE", "sourceLineageId": "provisional:x", "category": "x", "description": "x", "criticalStructures": ["x"]}
            (case / "case.json").write_text(json.dumps(base), encoding="utf-8")
            Image.new("RGBA", (4, 4), (255, 255, 255, 254)).save(case / "source.png")
            Image.new("L", (4, 4), 255).save(case / "ground_truth.png")
            with self.assertRaises(ValueError): run_benchmark.validate_case(case)
            base["sourceLineageId"] = "project/stable"
            (case / "case.json").write_text(json.dumps(base), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "fully opaque"): run_benchmark.validate_case(case)
            Image.new("RGB", (4, 4), "white").save(case / "source.png")
            run_benchmark.validate_case(case)

    def test_each_non_opaque_alpha_and_temporary_lineage_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary) / "BR-002"; case.mkdir()
            Image.new("L", (4, 4), 255).save(case / "ground_truth.png")
            for lineage in ("provisional:x", "temporary:x", "temp:x", "Provisional:x", "TEMP:x"):
                with self.subTest(lineage=lineage):
                    (case / "case.json").write_text(json.dumps({"caseId":"BR-002","datasetRole":"PROJECT_REAL_ACCEPTANCE","sourceLineageId":lineage,"category":"x","description":"x","criticalStructures":["x"]}), encoding="utf-8")
                    Image.new("RGB", (4, 4), "white").save(case / "source.png")
                    with self.assertRaises(ValueError): run_benchmark.validate_case(case)
            (case / "case.json").write_text(json.dumps({"caseId":"BR-002","datasetRole":"PROJECT_REAL_ACCEPTANCE","sourceLineageId":"project/stable","category":"x","description":"x","criticalStructures":["x"]}), encoding="utf-8")
            for alpha in (0, 1, 128, 254):
                with self.subTest(alpha=alpha):
                    Image.new("RGBA", (4, 4), (255, 255, 255, alpha)).save(case / "source.png")
                    with self.assertRaisesRegex(ValueError, "fully opaque"): run_benchmark.validate_case(case)


if __name__ == "__main__":
    unittest.main()
