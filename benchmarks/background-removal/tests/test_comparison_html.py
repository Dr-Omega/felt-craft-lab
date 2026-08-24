from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from run_benchmark import source_filename_for_case, write_comparison_html  # noqa: E402


class ComparisonHtmlTests(unittest.TestCase):
    def test_actual_jpeg_source_name_is_used(self) -> None:
        result = {"caseSources": {"BR-777": "source.jpeg"}}
        self.assertEqual(source_filename_for_case(result, "BR-777"), "source.jpeg")

    def test_html_uses_real_checkerboard_css(self) -> None:
        result = {
            "configuration": {"modelOrder": ["current-rule"]},
            "caseSources": {"BR-001": "source.png"},
            "caseResults": [{"caseId": "BR-001", "modelId": "current-rule", "status": "SUCCESS"}],
        }
        write_comparison_html(result)
        html = (ROOT / "results" / "comparison.html").read_text(encoding="utf-8")
        self.assertIn("conic-gradient", html)
        self.assertIn("background-size:16px 16px", html)
        self.assertNotIn("background:checkerboard", html)


if __name__ == "__main__":
    unittest.main()
