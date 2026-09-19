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
from promote_reviewed_candidate import promote_reviewed_candidate, sha256_file  # noqa: E402


def write_manifest(path: Path) -> None:
    path.write_text(json.dumps({"schemaVersion": "background-removal.acceptance-dataset/1", "requiredProjectRealReviewedCaseCount": 15, "cases": []}), encoding="utf-8")


def make_candidate(
    root: Path,
    *,
    rights: str = "CLEARED_FOR_PROJECT_EVAL",
    binary: bool = True,
    same_size: bool = True,
    transparent_source: bool = False,
) -> Path:
    candidate = root / "candidate"
    candidate.mkdir(parents=True)
    mode = "RGBA" if transparent_source else "RGB"
    color = (80, 120, 160, 0) if transparent_source else (80, 120, 160)
    Image.new(mode, (12, 10), color).save(candidate / "source.png")
    gt_size = (12, 10) if same_size else (11, 10)
    mask = Image.new("L", gt_size, 255)
    if not binary:
        mask.putpixel((0, 0), 127)
    mask.save(candidate / "draft_ground_truth.png")
    candidate_data = {
        "sourceLineageId": "project/source-one",
        "lineageStatus": "CONFIRMED",
        "originClass": "PROJECT_USER_ASSET",
        "backgroundRemovalSuitability": "SUITABLE",
        "category": "test",
        "description": "temp fixture",
        "criticalStructures": ["outline"],
        "coverageTags": ["unit-test"],
        "rightsStatus": rights,
    }
    (candidate / "candidate.json").write_text(json.dumps(candidate_data), encoding="utf-8")
    return candidate


def signed_review(candidate: Path, **overrides: str) -> dict[str, str]:
    review = {
        "state": "APPROVED",
        "signoff": "SIGNED_OFF",
        "reviewerRole": "PROJECT_DATASET_REVIEWER",
        "reviewedSourceSha256": sha256_file(candidate / "source.png"),
        "reviewedGroundTruthSha256": sha256_file(candidate / "draft_ground_truth.png"),
        "reviewedCandidateMetadataSha256": sha256_file(candidate / "candidate.json"),
    }
    review.update(overrides)
    return review


def write_review(candidate: Path, **overrides: str) -> None:
    (candidate / "gt-review.json").write_text(json.dumps(signed_review(candidate, **overrides)), encoding="utf-8")


class M3C1IntakeTests(unittest.TestCase):
    def test_inventory_groups_duplicate_sha_and_blocks_transparent_sticker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, duplicate, sticker = root / "first.png", root / "duplicate.png", root / "sticker.png"
            Image.new("RGB", (4, 4), (1, 2, 3)).save(first)
            duplicate.write_bytes(first.read_bytes())
            Image.new("RGBA", (4, 4), (1, 2, 3, 0)).save(sticker)
            records = inventory_candidates.inventory_paths([first, duplicate, sticker], root)
            self.assertEqual(len({record["contentIdentitySha256"] for record in records}), 2)
            self.assertEqual(sum(record["duplicateOf"] is not None for record in records), 1)
            self.assertTrue(all(record["lineageStatus"] == "NEEDS_REVIEW" for record in records))
            sticker_record = next(record for record in records if record["sourcePath"] == "sticker.png")
            self.assertEqual(sticker_record["backgroundRemovalSuitability"], "NOT_SUITABLE")
            self.assertEqual(sticker_record["acceptanceEligibility"], "BLOCKED")

    def test_inventory_groups_thumbnail_variant_without_confirming_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, thumbnail = root / "subject.png", root / "subject_thumb.png"
            Image.new("RGB", (8, 8), (1, 2, 3)).save(source)
            Image.new("RGB", (4, 4), (1, 2, 3)).save(thumbnail)
            records = inventory_candidates.inventory_paths([source, thumbnail], root)
            self.assertEqual(len({record["contentIdentitySha256"] for record in records}), 2)
            self.assertEqual({record["sourceLineageId"] for record in records}, {"provisional:subject"})
            self.assertTrue(all(record["lineageStatus"] == "NEEDS_REVIEW" for record in records))
            self.assertIsNotNone(next(record for record in records if record["sourcePath"] == "subject_thumb.png")["variantOf"])

    def test_inventory_blocks_mock_and_derived_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            mock = root / "mock-background.png"
            output = root / "outputs" / "purified.png"
            output.parent.mkdir()
            Image.new("RGB", (8, 8), (1, 2, 3)).save(mock)
            Image.new("RGB", (4, 4), (1, 2, 3)).save(output)
            mock_record, output_record = inventory_candidates.inventory_paths([mock, output], root)
            self.assertEqual(mock_record["backgroundRemovalSuitability"], "NOT_SUITABLE")
            self.assertEqual(mock_record["acceptanceEligibility"], "BLOCKED")
            self.assertEqual(output_record["originClass"], "DERIVED_OUTPUT")
            self.assertEqual(output_record["acceptanceEligibility"], "BLOCKED")

    def test_review_pack_is_visual_only_and_writes_byte_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = make_candidate(root)
            before = (candidate / "draft_ground_truth.png").read_bytes()
            identity = build_review_pack(candidate, root / "pack")
            self.assertEqual(before, (candidate / "draft_ground_truth.png").read_bytes())
            self.assertEqual(identity["reviewedSourceSha256"], sha256_file(candidate / "source.png"))
            self.assertEqual(json.loads((root / "pack" / "review-identity.json").read_text(encoding="utf-8")), identity)
            for name in ("source.png", "gt-mask.png", "boundary-overlay.png", "checkerboard-foreground.png"):
                self.assertTrue((root / "pack" / name).is_file())

    def test_promotion_rejects_unknown_rights_and_invalid_gt_review(self) -> None:
        invalid_reviews = ({"state": "PENDING"}, {"signoff": "NOT_SIGNED"}, {"reviewerRole": "WRONG_ROLE"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases, manifest = root / "cases", root / "acceptance-dataset.json"
            write_manifest(manifest)
            for index, review in enumerate(invalid_reviews):
                candidate = make_candidate(root / str(index))
                write_review(candidate, **review)
                with self.assertRaises(ValueError):
                    promote_reviewed_candidate(candidate, cases, manifest, f"BR-{index + 1:03d}")
            candidate = make_candidate(root / "rights", rights="NEEDS_CONFIRMATION")
            write_review(candidate)
            with self.assertRaisesRegex(ValueError, "rightsStatus"):
                promote_reviewed_candidate(candidate, cases, manifest, "BR-090")

    def test_promotion_rejects_missing_nonbinary_and_dimension_mismatched_gt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, cases = root / "acceptance-dataset.json", root / "cases"
            write_manifest(manifest)
            non_binary = make_candidate(root / "nonbinary", binary=False); write_review(non_binary)
            with self.assertRaisesRegex(ValueError, "strictly binary"):
                promote_reviewed_candidate(non_binary, cases, manifest, "BR-101")
            mismatched = make_candidate(root / "mismatch", same_size=False); write_review(mismatched)
            with self.assertRaisesRegex(ValueError, "dimensions"):
                promote_reviewed_candidate(mismatched, cases, manifest, "BR-102")
            missing = make_candidate(root / "missing"); write_review(missing)
            (missing / "draft_ground_truth.png").unlink()
            with self.assertRaisesRegex(ValueError, "missing draft_ground_truth"):
                promote_reviewed_candidate(missing, cases, manifest, "BR-103")

    def test_signed_candidate_promotes_and_loader_accepts_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases, manifest = root / "cases", root / "acceptance-dataset.json"
            write_manifest(manifest)
            candidate = make_candidate(root); write_review(candidate)
            entry = promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
            self.assertEqual(entry["datasetRole"], "PROJECT_REAL_ACCEPTANCE")
            previous_root, previous_manifest = run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH
            run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH = root, manifest
            try:
                records, validation, _snapshot = run_benchmark.load_acceptance_cases()
            finally:
                run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH = previous_root, previous_manifest
            self.assertEqual(len(records), 1)
            self.assertFalse(validation["valid"])
            self.assertEqual(validation["projectRealReviewedCaseCount"], 1)

    def test_promotion_rejects_review_identity_drift_for_each_reviewed_file(self) -> None:
        mutations = ("source", "ground_truth", "metadata")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, cases = root / "acceptance-dataset.json", root / "cases"
            write_manifest(manifest)
            for index, mutation in enumerate(mutations):
                candidate = make_candidate(root / mutation); write_review(candidate)
                if mutation == "source":
                    Image.new("RGB", (12, 10), (1, 2, 3)).save(candidate / "source.png")
                    expected = "reviewedSourceSha256"
                elif mutation == "ground_truth":
                    Image.new("L", (12, 10), 0).save(candidate / "draft_ground_truth.png")
                    expected = "reviewedGroundTruthSha256"
                else:
                    metadata = json.loads((candidate / "candidate.json").read_text(encoding="utf-8"))
                    metadata["description"] = "changed after review"
                    (candidate / "candidate.json").write_text(json.dumps(metadata), encoding="utf-8")
                    expected = "reviewedCandidateMetadataSha256"
                with self.assertRaisesRegex(ValueError, expected):
                    promote_reviewed_candidate(candidate, cases, manifest, f"BR-{210 + index:03d}")
                self.assertFalse((cases / f"BR-{210 + index:03d}").exists())

    def test_promotion_requires_eligible_candidate_and_opaque_source(self) -> None:
        mutations = (
            ("lineageStatus", "NEEDS_REVIEW", "lineageStatus"),
            ("backgroundRemovalSuitability", "NOT_SUITABLE", "backgroundRemovalSuitability"),
            ("originClass", "DERIVED_OUTPUT", "originClass"),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, cases = root / "acceptance-dataset.json", root / "cases"
            write_manifest(manifest)
            for index, (field, value, expected) in enumerate(mutations):
                candidate = make_candidate(root / field)
                metadata = json.loads((candidate / "candidate.json").read_text(encoding="utf-8"))
                metadata[field] = value
                (candidate / "candidate.json").write_text(json.dumps(metadata), encoding="utf-8")
                write_review(candidate)
                with self.assertRaisesRegex(ValueError, expected):
                    promote_reviewed_candidate(candidate, cases, manifest, f"BR-{220 + index:03d}")
            transparent = make_candidate(root / "transparent", transparent_source=True); write_review(transparent)
            with self.assertRaisesRegex(ValueError, "transparent pixels"):
                promote_reviewed_candidate(transparent, cases, manifest, "BR-223")
            self.assertFalse((cases / "BR-223").exists())

    def test_promotion_rejects_malformed_case_ids_before_writing_target(self) -> None:
        invalid_ids = ("BR-X", "BR-1", "BR-0001", "BR-/../../x", "../BR-001", "BR-001/test")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, cases = root / "acceptance-dataset.json", root / "cases"
            write_manifest(manifest)
            candidate = make_candidate(root); write_review(candidate)
            for case_id in invalid_ids:
                with self.assertRaisesRegex(ValueError, "caseId"):
                    promote_reviewed_candidate(candidate, cases, manifest, case_id)
            self.assertFalse(cases.exists())

    def test_promotion_rejects_duplicate_lineage_and_existing_case_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases, manifest = root / "cases", root / "acceptance-dataset.json"
            write_manifest(manifest)
            first = make_candidate(root / "first"); write_review(first)
            promote_reviewed_candidate(first, cases, manifest, "BR-301")
            duplicate_lineage = make_candidate(root / "second"); write_review(duplicate_lineage)
            with self.assertRaisesRegex(ValueError, "sourceLineageId"):
                promote_reviewed_candidate(duplicate_lineage, cases, manifest, "BR-302")
            with self.assertRaisesRegex(ValueError, "caseId"):
                promote_reviewed_candidate(first, cases, manifest, "BR-301")


if __name__ == "__main__":
    unittest.main()
