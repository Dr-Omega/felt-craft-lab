from __future__ import annotations

import json
import subprocess
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


def write_palette_source(path: Path, *, transparency: int | None) -> None:
    image = Image.new("P", (12, 10), 0)
    image.putpalette([80, 120, 160] + [0, 0, 0] * 255)
    if transparency is not None:
        alpha_table = bytearray([255] * 256)
        alpha_table[0] = transparency
        image.info["transparency"] = bytes(alpha_table)
    image.save(path)


def write_formal_case(root: Path, source_writer) -> Path:
    case = root / "BR-201"
    case.mkdir(parents=True)
    source_writer(case / "source.png")
    Image.new("L", (12, 10), 255).save(case / "ground_truth.png")
    (case / "case.json").write_text(
        json.dumps(
            {
                "caseId": "BR-201",
                "datasetRole": "PROJECT_REAL_ACCEPTANCE",
                "sourceLineageId": "project/source-one",
                "category": "test",
                "description": "formal source alpha fixture",
                "criticalStructures": ["outline"],
            }
        ),
        encoding="utf-8",
    )
    return case


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
            self.assertEqual((target / "gt-review.json").read_bytes(), promotion.canonical_review_json_bytes(json.loads((candidate / "gt-review.json").read_text(encoding="utf-8"))))
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

        for transparency in (0, 1, 128, 254):
            with self.subTest(palette_transparency=transparency), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root)
                write_palette_source(candidate / "source.png", transparency=transparency); write_review(candidate)
                manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
                with self.assertRaisesRegex(ValueError, "fully opaque"):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
        for transparency in (255, None):
            with self.subTest(opaque_palette=transparency), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root)
                write_palette_source(candidate / "source.png", transparency=transparency); write_review(candidate)
                self.promote(root, candidate)

    def test_formal_loader_uses_effective_rgba_alpha_for_all_image_modes(self) -> None:
        writers = {
            "rgb": lambda path: Image.new("RGB", (12, 10), "blue").save(path),
            "rgba-opaque": lambda path: Image.new("RGBA", (12, 10), (0, 0, 255, 255)).save(path),
            "palette-opaque": lambda path: write_palette_source(path, transparency=None),
            "palette-explicit-opaque": lambda path: write_palette_source(path, transparency=255),
        }
        for name, writer in writers.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                run_benchmark.validate_case(write_formal_case(Path(temporary), writer))
        rejecting = {
            "rgba-transparent": lambda path: Image.new("RGBA", (12, 10), (0, 0, 255, 0)).save(path),
            "rgba-semitransparent": lambda path: Image.new("RGBA", (12, 10), (0, 0, 255, 128)).save(path),
            "palette-transparent": lambda path: write_palette_source(path, transparency=0),
            "palette-semitransparent": lambda path: write_palette_source(path, transparency=128),
        }
        for name, writer in rejecting.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(ValueError, "fully opaque"):
                    run_benchmark.validate_case(write_formal_case(Path(temporary), writer))

    def test_formal_layout_is_rejected_before_any_write(self) -> None:
        layouts = (("other-cases", "acceptance-dataset.json"), ("cases", "foo.json"))
        for cases_name, manifest_name in layouts:
            with self.subTest(cases_name=cases_name, manifest_name=manifest_name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); candidate = make_candidate(root)
                manifest = root / manifest_name; write_manifest(manifest); before = manifest.read_bytes()
                cases = root / cases_name
                with self.assertRaisesRegex(ValueError, "formal promotion requires"):
                    promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
                self.assertEqual(manifest.read_bytes(), before)
                self.assertFalse(cases.exists())
                self.assertEqual({path.name for path in root.iterdir()}, {"candidate", manifest_name})

    def test_crlf_review_is_canonicalized_and_survives_git_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / "repo"; repo.mkdir()
            benchmark = repo / "benchmarks" / "background-removal"; benchmark.mkdir(parents=True)
            (repo / ".gitattributes").write_text("/benchmarks/background-removal/**/*.json text eol=lf\n", encoding="utf-8")
            candidate = make_candidate(benchmark)
            review = json.loads((candidate / "gt-review.json").read_text(encoding="utf-8"))
            crlf = (json.dumps(review, ensure_ascii=False, indent=2) + "\n").replace("\n", "\r\n").encode("utf-8")
            (candidate / "gt-review.json").write_bytes(crlf)
            manifest, cases = benchmark / "acceptance-dataset.json", benchmark / "cases"; write_manifest(manifest)
            entry = promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
            self.assertEqual((candidate / "gt-review.json").read_bytes(), crlf)
            final_review = cases / "BR-201" / "gt-review.json"
            self.assertNotIn(b"\r\n", final_review.read_bytes())
            expected = entry["groundTruthReview"]["evidence"]["sha256"]
            self.assertEqual(expected, promotion.sha256_file(final_review))
            commands = (
                ["git", "init"],
                ["git", "config", "user.email", "test@example.invalid"],
                ["git", "config", "user.name", "R4 Test"],
                ["git", "add", "."],
                ["git", "commit", "-m", "fixture"],
            )
            for command in commands:
                subprocess.run(command, cwd=repo, check=True, capture_output=True)
            checkout = Path(temporary) / "checkout"
            subprocess.run(["git", "clone", "--quiet", str(repo), str(checkout)], check=True, capture_output=True)
            checked_benchmark = checkout / "benchmarks" / "background-removal"
            checked_review = checked_benchmark / "cases" / "BR-201" / "gt-review.json"
            self.assertEqual(expected, promotion.sha256_file(checked_review))
            checked_manifest = json.loads((checked_benchmark / "acceptance-dataset.json").read_text(encoding="utf-8"))
            self.assertEqual(expected, checked_manifest["cases"][0]["groundTruthReview"]["evidence"]["sha256"])

    def test_readme_keeps_acceptance_completion_separate_from_model_selection(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("dataset, execution,\nreview, and reproducibility contracts are complete", readme)
        self.assertIn("does not automatically\nmean that a model has been selected", readme)
        self.assertIn("`modelSelectionStatus` remains `NOT_SELECTED`", readme)
        self.assertIn("Production Ready", readme)

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

    def test_inventory_blocks_effective_transparency_and_derived_fixture_variants(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = root / "benchmarks" / "fabrication-layer-decomposition" / "fixtures" / "source"
            fixture.mkdir(parents=True)
            thumb = fixture / "foo_thumb.png"; Image.new("RGB", (4, 4), "red").save(thumb)
            semitransparent = fixture / "foo.png"; Image.new("RGBA", (4, 4), (1, 2, 3, 128)).save(semitransparent)
            palette = fixture / "palette.png"; write_palette_source(palette, transparency=128)
            records = {record["sourcePath"]: record for record in inventory_candidates.inventory_paths([thumb, semitransparent, palette], root)}
            thumb_record = records[thumb.relative_to(root).as_posix()]
            self.assertEqual(thumb_record["originClass"], "DERIVED_REVIEW_ARTIFACT")
            self.assertEqual(thumb_record["acceptanceEligibility"], "BLOCKED")
            for path in (semitransparent, palette):
                record = records[path.relative_to(root).as_posix()]
                self.assertGreater(record["imageFacts"]["semiTransparentPixelCount"], 0)
                self.assertEqual(record["acceptanceEligibility"], "BLOCKED")

    def test_generated_inventory_markdown_stays_clean_with_autocrlf_true(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source"
            checkout = Path(temporary) / "checkout"
            benchmark = source / "benchmarks" / "background-removal"
            benchmark.mkdir(parents=True)
            (source / ".gitattributes").write_bytes((ROOT.parents[1] / ".gitattributes").read_bytes())
            inventory_candidates.write_inventory(
                [],
                benchmark / "M3-C1_CANDIDATE_INVENTORY.json",
                benchmark / "M3-C1_CANDIDATE_INVENTORY.md",
            )
            commands = (
                ["git", "init"],
                ["git", "config", "core.autocrlf", "false"],
                ["git", "config", "user.email", "test@example.invalid"],
                ["git", "config", "user.name", "R4 EOL Test"],
                ["git", "add", "."],
                ["git", "commit", "-m", "fixture"],
            )
            for command in commands:
                subprocess.run(command, cwd=source, check=True, capture_output=True)
            subprocess.run(
                ["git", "-c", "core.autocrlf=true", "clone", "--quiet", str(source), str(checkout)],
                check=True,
                capture_output=True,
            )
            checked_benchmark = checkout / "benchmarks" / "background-removal"
            markdown = checked_benchmark / "M3-C1_CANDIDATE_INVENTORY.md"
            attributes = subprocess.run(
                ["git", "check-attr", "text", "eol", "--", markdown.relative_to(checkout).as_posix()],
                cwd=checkout,
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertIn(": text: set", attributes)
            self.assertIn(": eol: lf", attributes)
            self.assertNotIn(b"\r\n", markdown.read_bytes())
            inventory_candidates.write_inventory(
                [],
                checked_benchmark / "M3-C1_CANDIDATE_INVENTORY.json",
                markdown,
            )
            self.assertNotIn(b"\r\n", markdown.read_bytes())
            status = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=checkout,
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertEqual(status, "")

    def test_rollback_cleanup_failure_reports_residual_path_and_original_cause(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); candidate = make_candidate(root)
            manifest, cases = root / "acceptance-dataset.json", root / "cases"; write_manifest(manifest)
            real_replace = promotion.os.replace; calls = 0

            def fail_second_replace(source: str | Path, destination: str | Path) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("injected manifest replacement failure")
                real_replace(source, destination)

            with (
                patch.object(promotion.os, "replace", side_effect=fail_second_replace),
                patch.object(promotion.shutil, "rmtree", side_effect=OSError("injected rollback removal failure")),
                self.assertRaisesRegex(RuntimeError, "manual cleanup is required") as raised,
            ):
                promotion.promote_reviewed_candidate(candidate, cases, manifest, "BR-201")
            self.assertIsInstance(raised.exception.__cause__, OSError)
            self.assertIn(str(cases / "BR-201"), str(raised.exception))
            self.assertTrue((cases / "BR-201").exists())
            self.assertIn("injected manifest replacement failure", str(raised.exception.__cause__))

    def test_review_pack_remains_visual_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); candidate = make_candidate(root)
            before = (candidate / "draft_ground_truth.png").read_bytes()
            identity = build_review_pack(candidate, root / "pack")
            self.assertEqual(before, (candidate / "draft_ground_truth.png").read_bytes())
            self.assertEqual(identity["reviewedSourceSha256"], promotion.sha256_file(candidate / "source.png"))


if __name__ == "__main__":
    unittest.main()
