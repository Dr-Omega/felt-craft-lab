from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = ROOT.parents[1]
B2_ROOT = ROOT / "fabrication-decomposition"
sys.path.insert(0, str(B2_ROOT / "src"))

from gt_review_pack import HIGH_VALUE_CASES, QUESTIONS  # noqa: E402


class B2GtReviewPackTests(unittest.TestCase):
    def test_pack_contains_exactly_high_value_fixtures(self):
        root = B2_ROOT / "reports" / "project-real-b2-gt-review"
        index = json.loads((root / "PROJECT_REAL_B2_GT_PACK.json").read_text(encoding="utf-8"))
        self.assertEqual(tuple(row["caseId"] for row in index["cases"]), HIGH_VALUE_CASES)
        self.assertTrue(all((REPOSITORY_ROOT / row["contactSheet"]).is_file() for row in index["cases"]))

    def test_no_candidate_is_auto_confirmed(self):
        root = B2_ROOT / "reports" / "project-real-b2-gt-review"
        for case_id in HIGH_VALUE_CASES:
            review = json.loads((root / f"{case_id}.review.json").read_text(encoding="utf-8"))
            self.assertGreater(review["candidateCount"], 0)
            for candidate in review["candidates"]:
                self.assertEqual(candidate["reviewAnswers"], {key: None for key in QUESTIONS})
                self.assertIsNone(candidate["manualReason"])
                self.assertTrue((REPOSITORY_ROOT / candidate["reviewCard"]).is_file())

    def test_gt_drafts_are_empty_and_pending(self):
        root = B2_ROOT / "reports" / "project-real-b2-gt-review"
        for case_id in HIGH_VALUE_CASES:
            draft = json.loads((root / f"{case_id}.gt-draft.json").read_text(encoding="utf-8"))
            self.assertEqual(draft["reviewStatus"], "PENDING_EXTERNAL_REVIEW")
            for key in ("physicalPieces", "overlapRelations", "hiddenCompletion", "mustNotMerge", "mustNotInferZones"):
                self.assertEqual(draft[key], [])

    def test_review_questions_match_approved_choices(self):
        self.assertEqual(QUESTIONS["samePhysicalPiece"], ["YES", "NO", "AMBIGUOUS"])
        self.assertEqual(QUESTIONS["hiddenGeometryNeeded"], ["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "AMBIGUOUS"])

    def test_post_review_distribution_is_unfilled(self):
        path = B2_ROOT / "reports" / "project-real-b2-gt-review" / "POST_REVIEW_DISTRIBUTION.json"
        distribution = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(distribution["status"], "PENDING_EXTERNAL_REVIEW")
        self.assertEqual(distribution["totalV0PieceCount"], 1180)
        self.assertIsNone(distribution["nextV1PrimaryProblem"])


if __name__ == "__main__":
    unittest.main()
