from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import m4_runtime  # noqa: E402


def _save(path: Path, rgba: np.ndarray) -> Path:
    Image.fromarray(rgba, "RGBA").save(path)
    return path


def _foreground_array(size: int = 18) -> np.ndarray:
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    rgba[2:-2, 2:-2] = (210, 42, 38, 255)
    rgba[6:-6, 6:-6, :3] = (30, 110, 210)
    return rgba


class M4InputContractTests(unittest.TestCase):
    def test_embedded_alpha_and_external_mask_modes_preserve_effective_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            embedded = _save(root / "embedded.png", _foreground_array())
            loaded = m4_runtime.load_foreground(
                embedded,
                mode="embedded-alpha",
                mask_path=None,
                foreground_source="TEST_CALLER",
                manual_confirmation="PENDING_REVIEW",
            )
            self.assertTrue(np.array_equal(loaded.rgba[..., 3], _foreground_array()[..., 3]))

            opaque = np.full((18, 18, 4), 255, dtype=np.uint8)
            image = _save(root / "opaque.png", opaque)
            mask = np.zeros((18, 18), dtype=np.uint8)
            mask[2:-2, 2:-2] = 255
            mask[2, 2] = 80
            mask_path = root / "mask.png"
            Image.fromarray(mask, "L").save(mask_path)
            external = m4_runtime.load_foreground(
                image,
                mode="external-mask",
                mask_path=mask_path,
                foreground_source="TEST_MASK",
                manual_confirmation="CONFIRMED",
            )
            self.assertTrue(np.array_equal(external.rgba[..., 3], mask))
            self.assertTrue(external.provenance["externalMask"]["softAlphaPreserved"])

    def test_opaque_embedded_input_requires_explicit_whole_image_declaration(self):
        with tempfile.TemporaryDirectory() as temporary:
            image = _save(Path(temporary) / "opaque.png", np.full((8, 8, 4), 255, dtype=np.uint8))
            with self.assertRaisesRegex(m4_runtime.M4RuntimeError, "whole-image-foreground"):
                m4_runtime.load_foreground(image, mode="embedded-alpha", mask_path=None, foreground_source="CALLER", manual_confirmation="CONFIRMED")
            accepted = m4_runtime.load_foreground(
                image,
                mode="embedded-alpha",
                mask_path=None,
                foreground_source="CALLER",
                manual_confirmation="CONFIRMED",
                whole_image_foreground=True,
            )
            self.assertEqual(accepted.provenance["foregroundInterpretation"], "CALLER_DECLARED_WHOLE_IMAGE_FOREGROUND")

    def test_dual_alpha_sources_and_bad_mask_are_rejected_without_guessing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = _save(root / "image.png", _foreground_array(10))
            mask_path = root / "mask.png"
            Image.fromarray(np.full((10, 10), 255, dtype=np.uint8), "L").save(mask_path)
            with self.assertRaisesRegex(m4_runtime.M4RuntimeError, "dual alpha"):
                m4_runtime.load_foreground(image, mode="external-mask", mask_path=mask_path, foreground_source="CALLER", manual_confirmation="CONFIRMED")

            opaque = _save(root / "opaque.png", np.full((10, 10, 4), 255, dtype=np.uint8))
            Image.fromarray(np.zeros((9, 10), dtype=np.uint8), "L").save(mask_path)
            with self.assertRaisesRegex(m4_runtime.M4RuntimeError, "dimensions"):
                m4_runtime.load_foreground(opaque, mode="external-mask", mask_path=mask_path, foreground_source="CALLER", manual_confirmation="CONFIRMED")
            Image.fromarray(np.zeros((10, 10, 3), dtype=np.uint8), "RGB").save(mask_path)
            with self.assertRaisesRegex(m4_runtime.M4RuntimeError, "single-channel"):
                m4_runtime.load_foreground(opaque, mode="external-mask", mask_path=mask_path, foreground_source="CALLER", manual_confirmation="CONFIRMED")

    def test_protected_and_nonempty_output_paths_are_rejected_before_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = _save(root / "source.png", _foreground_array(8))
            protected = ROOT / "fixtures" / "m4-forbidden"
            with self.assertRaisesRegex(m4_runtime.M4RuntimeError, "protected"):
                m4_runtime.validate_output_root(protected, [source])
            occupied = root / "occupied"
            occupied.mkdir()
            (occupied / "keep.txt").write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(m4_runtime.M4RuntimeError, "absent or empty"):
                m4_runtime.validate_output_root(occupied, [source])
            self.assertEqual((occupied / "keep.txt").read_text(encoding="utf-8"), "keep")


class M4RuntimeIntegrationTests(unittest.TestCase):
    def _run(self, root: Path, rgba: np.ndarray, runtime_id: str = "runtime-test") -> tuple[dict, Path]:
        image = _save(root / f"{runtime_id}.png", rgba)
        foreground = m4_runtime.load_foreground(
            image,
            mode="embedded-alpha",
            mask_path=None,
            foreground_source="SYNTHETIC_TEST",
            manual_confirmation="PENDING_REVIEW",
        )
        output = root / f"out-{runtime_id}"
        m4_runtime.validate_output_root(output, [image])
        return m4_runtime.run_runtime(foreground, runtime_id=runtime_id, profile="aggressive", output_root=output), output

    def test_real_kernels_complete_non_fixture_run_and_emit_loadable_page(self):
        with tempfile.TemporaryDirectory() as temporary:
            report, output = self._run(Path(temporary), _foreground_array())
            self.assertEqual(report["status"], "COMPLETE_PENDING_MANUAL_QUALITY_REVIEW")
            self.assertIsNone(report["metrics"]["ground_truth_approx_region_count"])
            self.assertEqual(report["metrics"]["manual_quality_grade"], "PENDING_MANUAL_REVIEW")
            self.assertTrue(report["contracts"]["alphaBitIdentical"])
            self.assertTrue(report["contracts"]["vectorHardGate"]["pass"])
            self.assertGreater(report["counts"]["observedCandidateCount"], 0)
            page = (output / "index.html").read_text(encoding="utf-8")
            self.assertIn("data:image/png;base64,", page)
            self.assertIn("production export is not eligible", page)
            self.assertTrue(all((output / name).is_file() for name in report["artifacts"].values()))

    def test_external_mask_mode_runs_the_same_real_chain_with_soft_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = _save(root / "opaque.png", np.full((16, 16, 4), (90, 170, 50, 255), dtype=np.uint8))
            mask = np.zeros((16, 16), dtype=np.uint8)
            mask[2:14, 2:14] = 255
            mask[2, 2:14] = 80
            mask_path = root / "mask.png"
            Image.fromarray(mask, "L").save(mask_path)
            foreground = m4_runtime.load_foreground(
                image,
                mode="external-mask",
                mask_path=mask_path,
                foreground_source="CALLER_MASK_TEST",
                manual_confirmation="CONFIRMED",
            )
            output = root / "external-output"
            report = m4_runtime.run_runtime(foreground, runtime_id="external-mask-run", profile="balanced", output_root=output)
            purified = np.asarray(Image.open(output / "purified.png").convert("RGBA"))
            self.assertTrue(np.array_equal(purified[..., 3], mask))
            self.assertEqual(report["input"]["foregroundMode"], "external-mask")
            self.assertTrue(report["contracts"]["vectorHardGate"]["pass"])
            self.assertEqual(report["review"]["status"], "PENDING_MANUAL_REVIEW")

    def test_diagonal_same_region_has_two_four_connected_components_and_candidates(self):
        rgba = np.zeros((8, 8, 4), dtype=np.uint8)
        rgba[2, 2] = (180, 40, 40, 255)
        rgba[3, 3] = (180, 40, 40, 255)
        with tempfile.TemporaryDirectory() as temporary:
            report, output = self._run(Path(temporary), rgba, "diagonal-touch")
            labels = np.load(output / "structural_label_map.npz")["labels"]
            self.assertEqual(int(labels[2, 2]), int(labels[3, 3]))
            self.assertEqual(report["counts"]["localRegionCount"], 1)
            self.assertEqual(report["counts"]["geometryComponentCount"], 2)
            self.assertEqual(report["counts"]["observedCandidateCount"], 2)

    def test_disconnected_same_color_does_not_merge_and_hole_survives(self):
        rgba = np.zeros((20, 20, 4), dtype=np.uint8)
        rgba[2:8, 2:8] = (180, 40, 40, 255)
        rgba[12:18, 12:18] = (180, 40, 40, 255)
        rgba[3:7, 13:17] = (40, 150, 40, 255)
        rgba[4:6, 14:16] = 0
        with tempfile.TemporaryDirectory() as temporary:
            report, output = self._run(Path(temporary), rgba, "disconnect-hole")
            labels = np.load(output / "structural_label_map.npz")["labels"]
            self.assertNotEqual(int(labels[3, 3]), int(labels[13, 13]))
            self.assertGreaterEqual(report["topology"]["voids"]["holeCount"], 1)
            candidates = json.loads((output / "observed-candidates.json").read_text(encoding="utf-8"))
            self.assertTrue(any(item["observedGeometry"]["innerRings"] for item in candidates))

    def test_fringe_and_orphan_are_preserved_but_not_structural_geometry(self):
        rgba = np.zeros((18, 18, 4), dtype=np.uint8)
        rgba[7:11, 7:11] = (100, 100, 220, 255)
        rgba[6, 7] = (100, 100, 220, 30)
        rgba[1, 1] = (100, 100, 220, 30)
        with tempfile.TemporaryDirectory() as temporary:
            report, output = self._run(Path(temporary), rgba, "fringe-orphan")
            pixels = np.load(output / "pixel_label_map.npz")["labels"]
            structural = np.load(output / "structural_label_map.npz")["labels"]
            self.assertGreater(report["metrics"]["fringe_assigned_count"], 0)
            self.assertGreater(report["metrics"]["orphan_fringe_count"], 0)
            self.assertEqual(int(structural[1, 1]), 0)
            self.assertEqual(int(pixels[1, 1]), -1)

    def test_observed_references_are_traceable_and_never_manufacturing_eligible(self):
        with tempfile.TemporaryDirectory() as temporary:
            report, output = self._run(Path(temporary), _foreground_array(), "traceable")
            graph = json.loads((output / "boundary-graph.json").read_text(encoding="utf-8"))
            edges = {item["edgeId"] for item in graph["edges"]}
            candidates = json.loads((output / "observed-candidates.json").read_text(encoding="utf-8"))
            keys = {(item["sourceComponentKey"]["regionId"], item["sourceComponentKey"]["componentId"]) for item in candidates}
            self.assertEqual(len(keys), len(candidates))
            for candidate in candidates:
                self.assertTrue(set(candidate["observedGeometry"]["edgeIds"]) <= edges)
                self.assertFalse(candidate["productionExportEligible"])
                self.assertIsNone(candidate["finalCutGeometry"])
            self.assertIsNone(report["counts"]["formalPieceCount"])

    def test_algorithm_hard_failure_stops_downstream_and_writes_diagnostic_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = _save(root / "source.png", _foreground_array())
            foreground = m4_runtime.load_foreground(image, mode="embedded-alpha", mask_path=None, foreground_source="TEST", manual_confirmation="PENDING_REVIEW")
            output = root / "failed"
            failing = mock.Mock()
            failing.propose.side_effect = RuntimeError("intentional kernel failure")
            with mock.patch.object(m4_runtime, "get_candidate", return_value=failing):
                with self.assertRaisesRegex(RuntimeError, "intentional kernel failure"):
                    m4_runtime.run_runtime(foreground, runtime_id="hard-fail", profile="aggressive", output_root=output)
            failure = json.loads((output / "failure.json").read_text(encoding="utf-8"))
            self.assertTrue(failure["downstreamStopped"])
            self.assertFalse((output / "purified.png").exists())
            self.assertFalse((output / "observed-candidates.json").exists())

    def test_deterministic_products_match_across_clean_output_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, out_a = self._run(root, _foreground_array(), "repeatable")
            image_a = (out_a / "purified.png").read_bytes()
            labels_a = np.load(out_a / "structural_label_map.npz")["labels"]
            candidates_a = (out_a / "observed-candidates.json").read_bytes()
            out_a.rename(root / "saved-first")
            second, out_b = self._run(root, _foreground_array(), "repeatable")
            self.assertEqual(image_a, (out_b / "purified.png").read_bytes())
            self.assertTrue(np.array_equal(labels_a, np.load(out_b / "structural_label_map.npz")["labels"]))
            self.assertEqual(candidates_a, (out_b / "observed-candidates.json").read_bytes())
            self.assertEqual(first["selectedVector"], second["selectedVector"])


if __name__ == "__main__":
    unittest.main()
