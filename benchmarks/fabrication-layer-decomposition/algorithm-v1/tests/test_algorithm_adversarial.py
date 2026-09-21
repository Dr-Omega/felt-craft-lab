"""Bounded end-to-end counterexamples discovered during independent review."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from algorithm_runtime import run_algorithm
from layered_sources import parse_layered
from m1_adapter import artifact, canonical_bytes
from result_wire import build_assessment


class AlgorithmAdversarialTests(unittest.TestCase):
    def run_svg(self, root, text, selected):
        path = root / "development.svg"
        path.write_text(text, encoding="utf-8")
        return run_algorithm(image_path=path, output_root=root / "result",
                             foreground_source="DEVELOPMENT_SYNTHETIC_EXPLICIT_SELECTION",
                             selected_layer_ids=selected)

    def test_excluded_opaque_layer_cannot_replace_selected_visibility_evidence(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
          <rect id="red" x="4" y="4" width="52" height="52" fill="#dc2323"/>
          <rect id="blue" x="20" y="20" width="24" height="24" fill="#193cdc"/>
          <rect id="excluded" x="0" y="0" width="64" height="64" fill="#333333"/>
        </svg>'''
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = self.run_svg(root, svg, ["red", "blue"])
            directions = [r for r in report["relations"] if r["kind"] == "VISUAL_OCCLUSION_RELATION" and r["status"] == "RESOLVED"]
            self.assertTrue(directions, "Selected opaque blue really covers selected red; excluded layer must not destroy that evidence")
            evidence = json.loads((root / "result/relation-evidence.json").read_text("utf-8"))
            known = [e for e in evidence["visual"]["evidence"] if e.get("upperLayerId")]
            self.assertTrue(known)
            for record in known:
                self.assertEqual(record["lowerLayerId"], "red")
                self.assertEqual(record["upperLayerId"], "blue")

    def test_supported_letterboxed_svg_keeps_native_transform_and_runs_full_chain(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 64">
          <rect id="red" x="4" y="4" width="56" height="56" fill="#dc2323"/>
          <rect id="blue" x="24" y="24" width="16" height="16" fill="#193cdc"/>
        </svg>'''
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "development.svg"
            source.write_text(svg, encoding="utf-8")
            self.assertEqual(parse_layered(source, ["*"])["status"], "SUPPORTED")
            report = self.run_svg(root, svg, ["*"])
            self.assertEqual(report["rerenderChecks"]["mismatchPixelCount"], 0)
            source_input = json.loads((root / "result/fabrication-input.json").read_text("utf-8"))
            self.assertEqual(source_input["coordinates"]["frames"][0]["bounds"], [0.0, 0.0, 64.0, 64.0])
            self.assertEqual(source_input["coordinates"]["transforms"][0]["matrix"], [0.75, 0.0, 0.0, 0.75, 8.0, 0.0])

    def test_failed_render_evidence_cannot_be_turned_into_a_passing_render_gate(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
          <rect id="red" x="4" y="4" width="40" height="40" fill="#dc2323"/>
          <rect id="blue" x="18" y="18" width="12" height="12" fill="#193cdc"/>
        </svg>'''
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.run_svg(root, svg, ["*"])
            result = json.loads((root / "result/fabrication-result.json").read_text("utf-8"))
            checks = json.loads((root / "result/geometry-checks.json").read_text("utf-8"))
            checks["renderBackStatus"] = "FAIL"
            checks["mismatchPixelCount"] = 1
            evidence_path = root / "geometry-checks.json"
            evidence_path.write_bytes(canonical_bytes(checks))
            # An artifact identity is not affirmative proof of its measurements.
            # Both explicitly failed measurements and the absent-measurements
            # legacy call must fail closed.
            with self.assertRaises(ValueError):
                build_assessment(result, artifact(evidence_path), checks)
            with self.assertRaises((ValueError, TypeError)):
                build_assessment(result, artifact(evidence_path))


if __name__ == "__main__":
    unittest.main()
