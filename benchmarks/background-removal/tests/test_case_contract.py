from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CASE = ROOT / "cases" / "BR-001"


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


if __name__ == "__main__":
    unittest.main()
