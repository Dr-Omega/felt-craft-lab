from __future__ import annotations

import sys
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from benchmark_lib import sha256_file  # noqa: E402
from run_benchmark import source_filename_for_case, write_comparison_html  # noqa: E402


class ComparisonHtmlTests(unittest.TestCase):
    def _output_row(self, *, status: str, matching_sha: bool = True) -> dict[str, object]:
        output = ROOT / "outputs" / "current-rule" / "BR-001.png"
        output.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGBA", (8, 8), (1, 2, 3, 255)).save(output)
        return {"caseId": "BR-001", "modelId": "current-rule", "status": status, "outputPath": "outputs/current-rule/BR-001.png", "outputSha256": sha256_file(output) if matching_sha else "0" * 64}

    def test_actual_jpeg_source_name_is_used(self) -> None:
        result = {"caseSources": {"BR-777": "source.jpeg"}}
        self.assertEqual(source_filename_for_case(result, "BR-777"), "source.jpeg")

    def test_html_uses_real_checkerboard_css(self) -> None:
        result = {
            "configuration": {"modelOrder": ["current-rule"]},
            "caseSources": {"BR-001": "source.png"},
            "caseResults": [self._output_row(status="SUCCESS")],
        }
        write_comparison_html(result)
        html = (ROOT / "results" / "comparison.html").read_text(encoding="utf-8")
        self.assertIn("conic-gradient", html)
        self.assertIn("background-size:16px 16px", html)
        self.assertNotIn("background:checkerboard", html)

    def test_old_png_is_not_shown_for_current_run_error(self) -> None:
        result = {
            "configuration": {"modelOrder": ["current-rule"]},
            "caseSources": {"BR-001": "source.png"},
            "caseResults": [self._output_row(status="ERROR")],
        }
        write_comparison_html(result)
        html = (ROOT / "results" / "comparison.html").read_text(encoding="utf-8")
        self.assertIn("Current Rule Algorithm<br>ERROR", html)
        self.assertNotIn('../outputs/current-rule/BR-001.png', html)

    def test_success_with_matching_output_sha_is_shown(self) -> None:
        result = {
            "configuration": {"modelOrder": ["current-rule"]},
            "caseSources": {"BR-001": "source.png"},
            "caseResults": [self._output_row(status="SUCCESS")],
        }
        write_comparison_html(result)
        html = (ROOT / "results" / "comparison.html").read_text(encoding="utf-8")
        self.assertIn('../outputs/current-rule/BR-001.png', html)


if __name__ == "__main__":
    unittest.main()
