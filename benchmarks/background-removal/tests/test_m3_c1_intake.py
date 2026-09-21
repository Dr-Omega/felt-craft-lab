from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import inventory_candidates  # noqa: E402
import promote_reviewed_candidate as promotion  # noqa: E402
import run_benchmark  # noqa: E402
from build_gt_review_pack import build_review_pack  # noqa: E402


def write_manifest(path: Path, *, schema: str = "background-removal.acceptance-dataset/2") -> None:
    path.write_text(json.dumps({"schemaVersion": schema, "requiredProjectRealReviewedCaseCount": 15, "cases": []}), encoding="utf-8")


def make_candidate(root: Path, *, alpha: int | None = None, origin: str = "PROJECT_USER_ASSET", lineage: str = "project/source-one", slot: str | None = "slot-01") -> Path:
    candidate = root / "candidate"
    candidate.mkdir(parents=True)
    if alpha is None:
        Image.new("RGB", (12, 10), (80, 120, 160)).save(candidate / "source.png")
    else:
        Image.new("RGBA", (12, 10), (80, 120, 160, alpha)).save(candidate / "source.png")
    Image.new("L", (12, 10), 255).save(candidate / "draft_ground_truth.png")
    data = {
        "sourceLineageId": lineage,
        "lineageStatus": "CONFIRMED",
        "originClass": origin,
        "backgroundRemovalSuitability": "SUITABLE",
        "category": "test",
        "description": "temp fixture",
        "criticalStructures": ["outline"],
        "coverageTags": ["unit-test"],
        "primaryCoverageSlot": slot,
        "rightsStatus": "CLEARED_FOR_PROJECT_EVAL",
    }
    (candidate / "candidate.json").write_text(json.dumps(data), encoding="utf-8")
    write_review(candidate)
    return candidate


def write_review(candidate: Path, **overrides: str) -> None:
    review = {
        "state": "APPROVED",
        "signoff": "SIGNED_OFF",
        "reviewerRole": "PROJECT_DATASET_REVIEWER",
        "reviewedSourceSha256": promotion.sha256_file(candidate / "source.png"),
        "reviewedGroundTruthSha256": promotion.sha256_file(candidate / "draft_ground_truth.png"),
        "reviewedCandidateMetadataSha256": promotion.sha256_file(candidate / "candidate.json"),
    }
    review.update(overrides)
    (candidate / "gt-review.json").write_text(json.dumps(review), encoding="utf-8")


class M3C1IntakeTests(unittest.TestCase):
    def promote(self, root: Path, candidate: Path, case_id: str = "BR-201") -> tuple[dict[str, object], Path, Path]:
        manifest, cases = root / "acceptance-dataset.json", root / "cases"
        write_manifest(manifest)
        return promotion.promote_reviewed_candidate(candidate, cases, manifest, case_id), cases, manifest

    def test_normal_v2_promotion_finalizes_evidence_and_preserves_freeze(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); candidate = make_candidate(root)
            freeze = root / "acceptance-freeze.json"; freeze.write_bytes(b"frozen bytes")
            entry, cases, manifest = self.promote(root, candidate)
            target = cases / "BR-201"
            self.assertEqual(entry["primaryCoverageSlot"], "slot-01")
            self.assertEqual(set(path.name for path in target.iterdir()), {"source.png", "ground_truth.png", "case.json", "gt-review.json"})
            evidence = entry["groundTruthReview"]["evidence"]
            self.assertEqual(evidence["file"], "cases/BR-201/gt-review.json")
            self.assertEqual(evidence["sha256"], promotion.sha256_file(target / "gt-review.json"))
            self.assertEqual(freeze.read_bytes(), b"frozen bytes")
            previous_root, previous_manifest = run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH
            run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH = root, manifest
            try:
                self.assertEqual(len(run_benchmark.load_acceptance_cases()[0]), 1)
                (target / "gt-review.json").write_text("tampered", encoding="utf-8")
                with self.assertRaises(ValueError):
                    run_benchmark.load_acceptance_cases()
            finally:
                run_benchmark.BENCHMARK_ROOT, run_benchmark.ACCEPTANCE_DATASET_PATH = previous_root, previous_manifest

    def test_replace_failures_rollback_case_manifest_and_temporary_artifacts(self) -> None:
        for failure_call in (1, 2):
            with self.subTest(failure_call=failure_call), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root)
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                before = manifest.read_bytes(); real_replace = promotion.os.replace; calls = 0

                def failing_replace(source: str | Path, destination: str | Path) -> None:
                    nonlocal calls
                    calls += 1
                    if calls == failure_call:
                        raise OSError("injected replacement failure")
                    real_replace(source, destination)

                with patch.object(promotion.os, "replace", side_effect=failing_replace), self.assertRaises(OSError):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
                self.assertFalse((cases / "BR-201").exists())
                self.assertEqual(manifest.read_bytes(), before)
                self.assertTrue(not cases.exists() or not any(path.name.startswith(".promotion-") for path in cases.glob("*")))
                self.assertFalse((root / ".acceptance-dataset.json.promotion-tmp").exists())

    def test_full_opacity_and_rgb_sources(self) -> None:
        for alpha in (0, 1, 128, 254):
            with self.subTest(alpha=alpha), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root, alpha=alpha)
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                with self.assertRaisesRegex(ValueError, "fully opaque"):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
        for alpha in (255, None):
            with self.subTest(alpha=alpha), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root, alpha=alpha)
                self.promote(root, candidate)

    def test_origin_allowlist_and_stable_lineage_fail_closed(self) -> None:
        for origin in promotion.ALLOWED_ORIGIN_CLASSES:
            with self.subTest(origin=origin), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); self.promote(root, make_candidate(root, origin=origin))
        for origin in ("UNKNOWN", "DERIVED_REVIEW_ARTIFACT", "DERIVED_OUTPUT", "NEW_UNKNOWN_ENUM", ""):
            with self.subTest(origin=origin), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root, origin=origin)
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                with self.assertRaisesRegex(ValueError, "originClass"):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
        for lineage in ("provisional:x", "Provisional:x", "temporary:x", "temp:x", "TEMP:x", ""):
            with self.subTest(lineage=lineage), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root, lineage=lineage)
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                with self.assertRaises(ValueError):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")

    def test_v2_slot_review_identity_and_case_contract_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); candidate = make_candidate(root)
            manifest, cases = root / "acceptance-dataset.json", root / "cases"
            write_manifest(manifest, schema="background-removal.acceptance-dataset/1")
            with self.assertRaisesRegex(ValueError, "v2"):
                promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
        for slot in (None, "slot-16", "hint-not-a-slot"):
            with self.subTest(slot=slot), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root, slot=slot)
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                with self.assertRaisesRegex(ValueError, "primaryCoverageSlot"):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
        for changed in ("source", "gt", "metadata"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root)
                if changed == "source": Image.new("RGB", (12, 10), "black").save(candidate / "source.png")
                elif changed == "gt": Image.new("L", (12, 10), 0).save(candidate / "draft_ground_truth.png")
                else: (candidate / "candidate.json").write_text("{}", encoding="utf-8")
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                with self.assertRaises(ValueError):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")

    def test_inventory_filename_grouping_is_path_aware_and_content_duplicates_remain_separate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            same_a, same_thumb, other = root / "a" / "foo.png", root / "a" / "foo_thumb.png", root / "b" / "foo.png"
            for path, color in ((same_a, (1, 2, 3)), (same_thumb, (4, 5, 6)), (other, (7, 8, 9))):
                path.parent.mkdir(parents=True, exist_ok=True); Image.new("RGB", (4, 4), color).save(path)
            records = inventory_candidates.inventory_paths([same_a, same_thumb, other], root)
            by_path = {record["sourcePath"]: record for record in records}
            self.assertEqual(by_path["a/foo.png"]["sourceLineageId"], by_path["a/foo_thumb.png"]["sourceLineageId"])
            self.assertNotEqual(by_path["a/foo.png"]["sourceLineageId"], by_path["b/foo.png"]["sourceLineageId"])
            duplicate = root / "b" / "copy.png"; duplicate.write_bytes(same_a.read_bytes())
            records = inventory_candidates.inventory_paths([same_a, duplicate], root)
            self.assertEqual(sum(record["duplicateOf"] is not None for record in records), 1)
            duplicate_record = next(record for record in records if record["duplicateOf"] is not None)
            self.assertIsNone(duplicate_record["variantOf"])

    def test_review_pack_remains_visual_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); candidate = make_candidate(root)
            before = (candidate / "draft_ground_truth.png").read_bytes()
            identity = build_review_pack(candidate, root / "pack")
            self.assertEqual(before, (candidate / "draft_ground_truth.png").read_bytes())
            self.assertEqual(identity["reviewedSourceSha256"], promotion.sha256_file(candidate / "source.png"))


if __name__ == "__main__":
    unittest.main()
