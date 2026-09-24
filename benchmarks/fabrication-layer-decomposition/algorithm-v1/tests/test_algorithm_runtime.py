"""Actual public-entry integration; no mocked kernels or fabricated wire pieces."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from algorithm_runtime import run_algorithm
from generate_layered_examples import development_psd, development_svg
from m1_adapter import run_shared_validation
from m4_runtime import REPOSITORY_ROOT
from solid_plans import propose_plans, SolidPlanError


def ring_rgba():
    rgba = np.zeros((64, 64, 4), np.uint8)
    rgba[4:60, 4:60] = [220, 35, 35, 255]
    rgba[20:44, 20:44] = [25, 60, 220, 255]
    rgba[28:36, 28:36] = 0
    return rgba


class AlgorithmIntegrationTests(unittest.TestCase):
    def call(self, source, output, **kwargs):
        return run_algorithm(image_path=source, output_root=output,
                             foreground_source="DEVELOPMENT_SYNTHETIC explicit foreground", **kwargs)

    def test_flat_actual_chain_split_conservation_and_stable_result(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "ring.png"
            Image.fromarray(ring_rgba()).save(source)
            a = self.call(source, root / "a")
            b = self.call(source, root / "b")
            self.assertEqual(a["resultSha256"], b["resultSha256"])
            self.assertGreater(a["splitGroupCount"], 0)
            self.assertGreater(a["seamScore"]["seamCount"], 0)
            result = json.loads((root / "a/fabrication-result.json").read_text())
            assessment = json.loads((root / "a/structural-assessment.json").read_text())
            self.assertTrue(run_shared_validation(result=result, assessment=assessment)["ok"])
            self.assertEqual(assessment["status"], "REVIEW_REQUIRED")
            self.assertEqual(a["rerenderChecks"]["mismatchPixelCount"], 0)
            roles = {p["role"] for p in result["payload"]["pieces"]}
            self.assertEqual(roles, {"BASE", "VISIBLE"})
            with Image.open(root / "a/rerender.png") as img:
                self.assertEqual(img.convert("RGBA").getpixel((31, 31))[3], 0)
            self.assertTrue(any(r["status"] == "UNRESOLVED" for r in result["payload"]["relations"]))
            self.assertFalse(a["productionExportEligible"])
            for relative, digest in a["artifactSha256"].items():
                self.assertEqual(hashlib.sha256((root / "a" / relative).read_bytes()).hexdigest(), digest)

    def test_actual_svg_and_psd_with_direction_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for suffix, source_bytes in (("svg", development_svg()), ("psd", development_psd())):
                with self.subTest(format=suffix):
                    source = root / ("overlap." + suffix)
                    source.write_bytes(source_bytes)
                    output = root / suffix
                    report = self.call(source, output, selected_layer_ids=["*"])
                    self.assertEqual(report["sourceKind"], "LAYERED")
                    self.assertTrue(any(r["kind"] == "VISUAL_OCCLUSION_RELATION" and r["status"] == "RESOLVED" for r in report["relations"]))
                    self.assertEqual((output / ("source-snapshot." + suffix)).read_bytes(), source_bytes)
                    self.assertGreater(report["pieceCount"], 1)

    def test_direct_api_output_guards_before_any_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "input.png"
            Image.fromarray(ring_rgba()).save(source)
            target = root / "occupied"
            target.mkdir()
            (target / "keep.txt").write_bytes(b"unchanged\x00")
            before = (target / "keep.txt").read_bytes()
            with self.assertRaisesRegex(ValueError, "absent or empty"):
                self.call(source, target)
            self.assertEqual(list(p.name for p in target.iterdir()), ["keep.txt"])
            self.assertEqual((target / "keep.txt").read_bytes(), before)
            with self.assertRaisesRegex(ValueError, "isolated"):
                self.call(source, root)
            protected = REPOSITORY_ROOT / "benchmarks/background-removal/algorithm-v1-must-not-exist"
            self.assertFalse(protected.exists())
            with self.assertRaisesRegex(ValueError, "protected"):
                self.call(source, protected)
            self.assertFalse(protected.exists())

    def test_frozen_candidate_and_schema_subdirectories_reject_before_write(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'input.png'
            Image.fromarray(ring_rgba()).save(source)
            for name in ('candidates', 'schemas'):
                protected = REPOSITORY_ROOT / 'benchmarks/fabrication-layer-decomposition' / name / 'algorithm-v1-must-not-exist'
                self.assertFalse(protected.exists())
                with self.assertRaisesRegex(ValueError, 'protected'):
                    self.call(source, protected)
                self.assertFalse(protected.exists())

    def test_unsupported_layered_keeps_truthful_failure_not_complete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "unsupported.psd"
            source.write_bytes(development_psd(blend=b"mul "))
            with self.assertRaisesRegex(ValueError, "layered source cannot be processed"):
                self.call(source, root / "result", selected_layer_ids=["*"])
            self.assertFalse((root / "result/report.json").exists())
            self.assertFalse((root / "result/fabrication-result.json").exists())
            failure = json.loads((root / "result/failure.json").read_text())
            self.assertEqual(failure["status"], "FAILED")
            self.assertTrue((root / "result/layer-evidence.json").exists())

    def test_late_page_failure_never_publishes_complete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "ring.png"
            Image.fromarray(ring_rgba()).save(source)
            with patch("algorithm_runtime._page", side_effect=OSError("injected page failure")):
                with self.assertRaisesRegex(OSError, "injected"):
                    self.call(source, root / "result")
            self.assertFalse((root / "result/report.json").exists())
            failure = json.loads((root / "result/failure.json").read_text())
            self.assertIn("INDEPENDENT_PIECE_RERENDER", failure["completedStages"])
            self.assertIn("page failure", failure["error"])

    def test_real_generated_candidate_with_omitted_groups_fails_before_selection(self):
        def remove_groups(observed, **options):
            plans = propose_plans(observed, **options)
            self.assertTrue(plans[0]['splitGroups'])
            plans[0]['splitGroups'] = []
            for piece in plans[0]['pieces']:
                piece['splitGroupId'] = None
            # Keep the real old PASS and score to exercise the actual reusable
            # rank boundary inside run_algorithm, not just direct validate_plan.
            return plans

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'ring.png'
            Image.fromarray(ring_rgba()).save(source)
            with patch('algorithm_runtime.propose_plans', side_effect=remove_groups):
                with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup.*BASE/body-1'):
                    self.call(source, root / 'result')
            failure = json.loads((root / 'result/failure.json').read_text())
            self.assertIn('M6_VISUAL_EVIDENCE', failure['completedStages'])
            self.assertNotIn('M7_PLAN_AND_M6_REVIEW', failure['completedStages'])
            self.assertFalse((root / 'result/fabrication-result.json').exists())
            self.assertFalse((root / 'result/report.json').exists())


if __name__ == "__main__":
    unittest.main()
