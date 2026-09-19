from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CASE = ROOT / "cases" / "BR-001"
sys.path.insert(0, str(ROOT / "scripts"))

from run_benchmark import validate_case  # noqa: E402


class CaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "create_example_case.py")], check=True)

    def test_first_case_is_light_background_white_coat_fixture_with_binary_gt(self) -> None:
        metadata = json.loads((CASE / "case.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["caseId"], "BR-001")
        self.assertIn("浅灰背景", metadata["description"])
        self.assertIn("white coat torso", metadata["criticalStructures"])
        with Image.open(CASE / "source.png") as source, Image.open(CASE / "ground_truth.png") as ground_truth:
            self.assertEqual(source.size, ground_truth.size)
            self.assertEqual(set(ground_truth.convert("L").get_flattened_data()), {0, 255})

    def test_jpeg_source_is_accepted_and_preserved_by_case_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary) / "BR-777"
            case.mkdir()
            (case / "case.json").write_text('{"caseId":"BR-777","datasetRole":"SYNTHETIC_DEBUG","sourceLineageId":"synthetic/jpeg","category":"test","description":"jpeg","criticalStructures":["arm"]}', encoding="utf-8")
            Image.new("RGB", (8, 9), "white").save(case / "source.jpg")
            Image.new("L", (8, 9), 255).save(case / "ground_truth.png")

            _metadata, source, _ground_truth, _case_dir = validate_case(case)

            self.assertEqual(source.name, "source.jpg")

    def test_case_contract_rejects_mismatched_case_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary) / "BR-778"
            case.mkdir()
            (case / "case.json").write_text('{"caseId":"BR-other","datasetRole":"SYNTHETIC_DEBUG","sourceLineageId":"synthetic/bad","category":"test","description":"bad","criticalStructures":[]}', encoding="utf-8")
            Image.new("RGB", (8, 9), "white").save(case / "source.png")
            Image.new("L", (8, 9), 127).save(case / "ground_truth.png")

            with self.assertRaisesRegex(ValueError, "caseId must match"):
                validate_case(case)

    def test_case_contract_rejects_non_binary_ground_truth(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary) / "BR-779"
            case.mkdir()
            (case / "case.json").write_text('{"caseId":"BR-779","datasetRole":"SYNTHETIC_DEBUG","sourceLineageId":"synthetic/bad-mask","category":"test","description":"bad mask","criticalStructures":["arm"]}', encoding="utf-8")
            Image.new("RGB", (8, 9), "white").save(case / "source.png")
            Image.new("L", (8, 9), 127).save(case / "ground_truth.png")

            with self.assertRaisesRegex(ValueError, "strictly binary"):
                validate_case(case)


if __name__ == "__main__":
    unittest.main()
