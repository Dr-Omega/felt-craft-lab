from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import inventory_candidates  # noqa: E402
import run_benchmark  # noqa: E402
from build_gt_review_pack import build_review_pack  # noqa: E402
from promote_reviewed_candidate import promote_reviewed_candidate  # noqa: E402


def write_manifest(path: Path) -> None:
    path.write_text(json.dumps({"schemaVersion": "background-removal.acceptance-dataset/1", "requiredProjectRealReviewedCaseCount": 15, "cases": []}), encoding="utf-8")


def make_candidate(root: Path, *, rights: str = "CLEARED_FOR_PROJECT_EVAL", review: dict[str, str] | None = None, binary: bool = True, same_size: bool = True) -> Path:
    candidate = root / "candidate"
    candidate.mkdir(parents=True)
    Image.new("RGB", (12, 10), (80, 120, 160)).save(candidate / "source.png")
    gt_size = (12, 10) if same_size else (11, 10)
    mask = Image.new("L", gt_size, 255)
    if not binary:
        mask.putpixel((0, 0), 127)
    mask.save(candidate / "draft_ground_truth.png")
    (candidate / "candidate.json").write_text(json.dumps({"sourceLineageId": "project/source-one", "category": "test", "description": "temp fixture", "criticalStructures": ["outline"], "coverageTags": ["unit-test"], "rightsStatus": rights}), encoding="utf-8")
    if review is not None:
        (candidate / "gt-review.json").write_text(json.dumps(review), encoding="utf-8")
    return candidate


def approved_review() -> dict[str, str]:
    return {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"}


class M3C1IntakeTests(unittest.TestCase):
    def test_inventory_groups_duplicate_sha_and_blocks_transparent_sticker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first.png"
            duplicate = root / "duplicate.png"
            sticker = root / "sticker.png"
            Image.new("RGB", (4, 4), (1, 2, 3)).save(first)
            duplicate.write_bytes(first.read_bytes())
            Image.new("RGBA", (4, 4), (1, 2, 3, 0)).save(sticker)
            records = inventory_candidates.inventory_paths([first, duplicate, sticker], root)
            self.assertEqual(len({record["sourceLineageId"] for record in records}), 2)
            self.assertEqual(sum(record["duplicateOf"] is not None for record in records), 1)
            sticker_record = next(record for record in records if record["sourcePath"] == "sticker.png")
            self.assertEqual(sticker_record["backgroundRemovalSuitability"], "NOT_SUITABLE")
            self.assertEqual(sticker_record["acceptanceEligibility"], "BLOCKED")

    def test_inventory_blocks_derived_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "outputs" / "purified.png"
            output.parent.mkdir()
            Image.new("RGB", (4, 4), (1, 2, 3)).save(output)
            record = inventory_candidates.inventory_paths([output], root)[0]
            self.assertEqual(record["originClass"], "DERIVED_OUTPUT")
            self.assertEqual(record["acceptanceEligibility"], "BLOCKED")

    def test_review_pack_is_visual_only_and_preserves_gt_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = make_candidate(root)
            before = (candidate / "draft_ground_truth.png").read_bytes()
            hashes = build_review_pack(candidate, root / "pack")
            self.assertEqual(before, (candidate / "draft_ground_truth.png").read_bytes())
            self.assertEqual(len(hashes["draftGroundTruthSha256"]), 64)
            for name in ("source.png", "gt-mask.png", "boundary-overlay.png", "checkerboard-foreground.png"):
                self.assertTrue((root / "pack" / name).is_file())

    def test_promotion_rejects_unknown_rights_and_missing_or_invalid_gt_review(self) -> None:
        invalid_reviews = [None, {"state": "PENDING", "signoff": "SIGNED_OFF", "reviewerRole": "PROJECT_DATASET_REVIEWER"}, {"state": "APPROVED", "signoff": "NOT_SIGNED", "reviewerRole": "PROJECT_DATASET_REVIEWER"}, {"state": "APPROVED", "signoff": "SIGNED_OFF", "reviewerRole": "WRONG_ROLE"}]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = root / "cases"
            manifest = root / "acceptance-dataset.json"
            write_manifest(manifest)
            for index, review in enumerate(invalid_reviews):
                with self.subTest(review=review):
                    candidate = make_candidate(root / str(index), review=review)
                    with self.assertRaises(ValueError):
                        promote_reviewed_candidate(candidate, cases, manifest, f"BR-{index + 1:03d}")
            candidate = make_candidate(root / "rights", rights="NEEDS_CONFIRMATION", review=approved_review())
            with self.assertRaisesRegex(ValueError, "rightsStatus"):
                promote_reviewed_candidate(candidate, cases, manifest, "BR-090")

    def test_promotion_rejects_missing_nonbinary_and_dimension_mismatched_gt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "acceptance-dataset.json"
            write_manifest(manifest)
            cases = root / "cases"
            non_binary = make_candidate(root / "nonbinary", review=approved_review(), binary=False)
            with self.assertRaisesRegex(ValueError, "strictly binary"):
                promote_reviewed_candidate(non_binary, cases, manifest, "BR-101")
            mismatched = make_candidate(root / "mismatch", review=approved_review(), same_size=False)
            with self.assertRaisesRegex(ValueError, "dimensions"):
                promote_reviewed_candidate(mismatched, cases, manifest, "BR-102")
            missing = make_candidate(root / "missing", review=approved_review())
            (missing / "draft_ground_truth.png").unlink()
            with self.assertRaisesRegex(ValueError, "missing draft_ground_truth"):
                promote_reviewed_candidate(missing, cases, manifest, "BR-103")

    def test_signed_candidate_promotes_and_loader_accepts_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = root / "cases"
            manifest = root / "acceptance-dataset.json"
            write_manifest(manifest)
            candidate = make_candidate(root, review=approved_review())
            entry = promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
            self.assertEqual(entry["datasetRole"], "PROJECT_REAL_ACCEPTANCE")
            previous_root = run_benchmark.BENCHMARK_ROOT
            previous_manifest = run_benchmark.ACCEPTANCE_DATASET_PATH
            run_benchmark.BENCHMARK_ROOT = root
            run_benchmark.ACCEPTANCE_DATASET_PATH = manifest
            try:
                records, validation, _snapshot = run_benchmark.load_acceptance_cases()
            finally:
                run_benchmark.BENCHMARK_ROOT = previous_root
                run_benchmark.ACCEPTANCE_DATASET_PATH = previous_manifest
            self.assertEqual(len(records), 1)
            self.assertFalse(validation["valid"])
            self.assertEqual(validation["projectRealReviewedCaseCount"], 1)

    def test_promotion_rejects_duplicate_lineage_and_existing_case_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = root / "cases"
            manifest = root / "acceptance-dataset.json"
            write_manifest(manifest)
            first = make_candidate(root / "first", review=approved_review())
            promote_reviewed_candidate(first, cases, manifest, "BR-301")
            duplicate_lineage = make_candidate(root / "second", review=approved_review())
            with self.assertRaisesRegex(ValueError, "sourceLineageId"):
                promote_reviewed_candidate(duplicate_lineage, cases, manifest, "BR-302")
            with self.assertRaisesRegex(ValueError, "caseId"):
                promote_reviewed_candidate(first, cases, manifest, "BR-301")


if __name__ == "__main__":
    unittest.main()
