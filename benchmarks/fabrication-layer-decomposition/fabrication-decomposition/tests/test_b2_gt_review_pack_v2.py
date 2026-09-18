from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = ROOT.parents[1]
B2_ROOT = ROOT / "fabrication-decomposition"
sys.path.insert(0, str(B2_ROOT / "src"))

from gt_review_pack import HIGH_VALUE_CASES  # noqa: E402
from gt_review_pack_v2 import (  # noqa: E402
    BUCKETS,
    BUCKET_LIMITS,
    FABRICATION_ROLES,
    PACK_STATUS,
    QUESTIONS_V2,
    REQUIRED_REVIEW_PAIRS,
)


class B2GtReviewPackV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = B2_ROOT / "reports" / "project-real-b2-gt-review-v2"
        cls.index = json.loads(
            (cls.root / "PROJECT_REAL_B2_GT_PACK_V2.json").read_text(encoding="utf-8")
        )

    def test_v1_is_preserved_and_v2_has_expected_scope(self):
        self.assertEqual(self.index["status"], PACK_STATUS)
        self.assertEqual(self.index["gtPackV1Status"], "AUDIT_SAMPLE_ONLY")
        self.assertEqual(tuple(row["caseId"] for row in self.index["cases"]), HIGH_VALUE_CASES)
        v1_root = B2_ROOT / "reports" / "project-real-b2-gt-review"
        self.assertEqual(len(list((v1_root / "cards").glob("*.png"))), 40)

    def test_v2_questions_add_not_applicable_and_roles(self):
        for key in ("samePhysicalPiece", "hiddenContinuousArea", "stacking"):
            self.assertIn("NOT_APPLICABLE", QUESTIONS_V2[key])
        self.assertEqual(
            FABRICATION_ROLES, ["BASE_FILL", "OVERLAY_FILL", "STROKE_DETAIL", "UNKNOWN"]
        )

    def test_all_candidates_are_unreviewed_and_have_cards(self):
        for row in self.index["cases"]:
            review = json.loads((REPOSITORY_ROOT / row["reviewFile"]).read_text(encoding="utf-8"))
            self.assertGreater(review["candidateCount"], 0)
            for candidate in review["candidates"]:
                self.assertEqual(candidate["reviewAnswers"], {key: None for key in QUESTIONS_V2})
                self.assertTrue(all(value is None for value in candidate["fabricationRole"].values()))
                self.assertIsNone(candidate["manualReason"])
                self.assertIsNone(candidate["selectionEvidence"]["semanticInference"])
                self.assertTrue((REPOSITORY_ROOT / candidate["reviewCard"]).is_file())

    def test_bucket_caps_and_stroke_control_limit_are_audited(self):
        standalone = json.loads(
            (self.root / "CANDIDATE_SELECTION_AUDIT.json").read_text(encoding="utf-8")
        )
        self.assertEqual(standalone["status"], "PASS")
        self.assertFalse(standalone["semanticLabelsGenerated"])
        for row in self.index["cases"]:
            audit = row["candidateSelectionAudit"]
            self.assertEqual(set(audit["selectedCounts"]), set(BUCKETS))
            for bucket in BUCKETS:
                self.assertLessEqual(audit["selectedCounts"][bucket], BUCKET_LIMITS[bucket])
            self.assertTrue(audit["strokeStressLimitPass"])
            self.assertLessEqual(audit["selectedCounts"]["STROKE_STRESS_CONTROL"], 2)
            self.assertEqual(audit["selectionBalanceStatus"], "PASS")

    def test_required_project_real_review_focus_is_covered_without_labels(self):
        for row in self.index["cases"]:
            audit = row["candidateSelectionAudit"]
            self.assertEqual(audit["requiredReviewFocusCoverage"]["status"], "PASS")
            self.assertEqual(audit["requiredReviewFocusCoverage"]["missing"], [])
            self.assertFalse(audit["requiredReviewFocusCoverage"]["semanticLabelsGenerated"])
            self.assertEqual(
                {tuple(pair) for pair in audit["requiredReviewFocusPairs"]},
                REQUIRED_REVIEW_PAIRS[row["caseId"]],
            )

    def test_stroke_mediated_candidates_have_real_two_hop_evidence(self):
        count = 0
        for row in self.index["cases"]:
            review = json.loads((REPOSITORY_ROOT / row["reviewFile"]).read_text(encoding="utf-8"))
            for candidate in review["candidates"]:
                if candidate["candidateType"] != "STROKE_MEDIATED_FILL_FILL_ADJACENCY":
                    continue
                count += 1
                self.assertGreater(len(candidate["selectionEvidence"]["mediatingStrokeRegionIds"]), 0)
        self.assertGreater(count, 0)

    def test_no_population_distribution_is_generated(self):
        self.assertEqual(
            self.index["global1180PieceDistribution"],
            "NOT_COMPUTED_NON_RANDOM_NON_EXHAUSTIVE_SAMPLE",
        )
        old_distribution = json.loads(
            (
                B2_ROOT
                / "reports"
                / "project-real-b2-gt-review"
                / "POST_REVIEW_DISTRIBUTION.json"
            ).read_text(encoding="utf-8")
        )
        self.assertIsNone(old_distribution["multipleComponentsToOnePhysicalPieceRatio"])
        self.assertIsNone(old_distribution["hiddenContourReconstructionRequiredRatio"])


if __name__ == "__main__":
    unittest.main()
