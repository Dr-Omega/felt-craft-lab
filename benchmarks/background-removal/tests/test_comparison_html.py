from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from run_benchmark import source_filename_for_case  # noqa: E402


class ComparisonHtmlTests(unittest.TestCase):
    def test_actual_jpeg_source_name_is_used(self) -> None:
        result = {"caseSources": {"BR-777": "source.jpeg"}}
        self.assertEqual(source_filename_for_case(result, "BR-777"), "source.jpeg")


if __name__ == "__main__":
    unittest.main()
