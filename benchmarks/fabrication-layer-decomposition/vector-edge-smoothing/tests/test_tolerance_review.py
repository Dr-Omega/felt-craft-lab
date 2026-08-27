from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from PIL import Image

POC_ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_ROOT = POC_ROOT.parent
sys.path.insert(0, str(POC_ROOT / "src"))

from runner import summarize_existing
from tolerance_review import FOCUS_CASES, STATUS, TOLERANCES, integrity_snapshot


class ToleranceReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metrics = json.loads((POC_ROOT / "reports" / "V2_TOLERANCE_METRICS.json").read_text(encoding="utf-8"))

    def test_complete_same_size_tolerance_contact_sheets_exist(self):
        sizes = {}
        for case_id in FOCUS_CASES:
            path = POC_ROOT / "reports" / "tolerance-contact-sheets" / f"{case_id}.png"
            self.assertTrue(path.is_file())
            with Image.open(path) as image:
                sizes[case_id] = image.size
            self.assertEqual(sizes[case_id][0], 420 * 4)

    def test_all_tolerances_and_profiles_are_reported_without_decision_language(self):
        self.assertEqual(self.metrics["status"], STATUS)
        for profile in ("cp-b-aggressive_rc-a", "cp-b-balanced_rc-a"):
            self.assertEqual(set(self.metrics["byProfile"][profile]), {str(value) for value in TOLERANCES})
        report = (POC_ROOT / "reports" / "V2_TOLERANCE_REVIEW.md").read_text(encoding="utf-8").upper()
        for forbidden in ("BEST", "WINNER", "PRODUCTION", "RECOMMENDED_TOLERANCE"):
            self.assertNotIn(forbidden, report)

    def test_fld007_has_stable_29_of_29_hole_correspondence(self):
        hole = self.metrics["holeReview"]
        self.assertEqual(hole["holeCount"], 29)
        self.assertEqual(hole["structuralZeroComponentCount"], 30)
        self.assertEqual(hole["principalVoidCount"], 6)
        self.assertTrue(hole["allRetained"])
        self.assertEqual([item["holeId"] for item in hole["correspondence"]], [f"H{index:03d}" for index in range(1, 30)])
        for item in hole["correspondence"]:
            self.assertTrue(all(route["retained"] for route in item["routes"].values()))
        self.assertTrue((POC_ROOT / "reports" / "FLD-007_HOLE_REVIEW.png").is_file())

    def test_focus_crops_cover_required_cases_and_small_holes(self):
        artifacts = self.metrics["artifacts"]
        crop_cases = {item["caseId"] for item in artifacts if item["kind"] == "FOCUS_CROP"}
        self.assertEqual(crop_cases, {"FLD-001", "FLD-004", "FLD-005", "FLD-006", "FLD-008"})
        hole_crops = [item for item in artifacts if item["kind"] == "HOLE_FOCUS_CROP"]
        self.assertEqual(len(hole_crops), 3)
        self.assertEqual(sum(item["name"].startswith("small-hole-") for item in hole_crops), 2)

    def test_report_only_does_not_rewrite_geometry_or_input_artifacts(self):
        before = integrity_snapshot(BENCHMARK_ROOT, POC_ROOT)
        summarize_existing(POC_ROOT)
        after = integrity_snapshot(BENCHMARK_ROOT, POC_ROOT)
        self.assertEqual(before, after)
        self.assertEqual(before["routeArtifactCount"], 112)
        self.assertEqual(before["inputArtifactCount"], 32)


if __name__ == "__main__":
    unittest.main()
