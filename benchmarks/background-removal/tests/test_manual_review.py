from __future__ import annotations

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from benchmark_lib import final_verdict_for_review  # noqa: E402


class ManualReviewTests(unittest.TestCase):
    def test_unreviewed_stays_explicit(self) -> None:
        self.assertEqual(final_verdict_for_review({"hardFailReasons": []}), "UNREVIEWED")

    def test_hard_failure_overrides_other_manual_grades(self) -> None:
        review = {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": False, "hardFailReasons": ["largeSubjectDeletion"]}
        self.assertEqual(final_verdict_for_review(review), "FAIL")

    def test_critical_structure_fail_is_hard_fail(self) -> None:
        review = {"boundaryQuality": "A", "criticalStructure": "FAIL", "visibleInternalHole": False, "hardFailReasons": []}
        self.assertEqual(final_verdict_for_review(review), "FAIL")

    def test_visible_hole_is_hard_fail(self) -> None:
        review = {"boundaryQuality": "A", "criticalStructure": "PASS", "visibleInternalHole": True, "hardFailReasons": []}
        self.assertEqual(final_verdict_for_review(review), "FAIL")


if __name__ == "__main__":
    unittest.main()
