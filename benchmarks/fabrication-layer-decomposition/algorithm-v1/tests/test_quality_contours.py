"""Actual experimental shared fits and conservative geometry fallback."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tools"))

from m4_runtime import _vectorize, VECTOR_ROOT, validate_embedding
from polygon_simplify import persistent_corners
from quality_contours import refine_contours, DESIGN_BUDGETS_PX


CONFIG = json.loads((VECTOR_ROOT / "configs/poc.v1.json").read_text())


def circle():
    yy, xx = np.indices((64, 64))
    return (((xx - 32) ** 2 + (yy - 32) ** 2) < 25 ** 2).astype(np.int32)


def baseline(labels):
    return _vectorize(labels, ((labels > 0) * 255).astype(np.uint8),
                      "synthetic-contour-protection", "test-profile", CONFIG)[:2]


class QualityContourTests(unittest.TestCase):
    def test_actual_arc_improves_with_declared_budget_and_hard_gates(self):
        labels = circle()
        graph, original = baseline(labels)
        before = copy.deepcopy((graph, original, CONFIG))
        selected, report = refine_contours(graph, original, labels, CONFIG)
        self.assertEqual((graph, original, CONFIG), before)
        self.assertEqual(report["designDeviationBudgetsPx"], list(DESIGN_BUDGETS_PX))
        self.assertEqual(len(report["trials"]), 3)
        self.assertLess(report["selectedSegmentCount"], report["baselineSegmentCount"])
        self.assertTrue(report["changedEdges"])
        self.assertGreater(report["changedRasterPixelCount"], 0)
        self.assertTrue(selected["hardGate"]["pass"])
        self.assertLessEqual(selected["metrics"]["geometry"]["symmetricMaxBoundaryDeviation"],
                             1.0 + CONFIG["bezier"]["validationFlatnessPx"] + 1e-9)
        self.assertTrue(any(s["type"] == "CUBIC" for e in selected["geometry"] for s in e["segments"]))
        json.dumps(report, allow_nan=False)
        self.assertNotEqual(report["selectedVectorSha256"], report["inputVectorSha256"])

    def test_disabled_preserves_original_and_is_deterministic(self):
        labels = circle()
        graph, original = baseline(labels)
        selected, report = refine_contours(graph, original, labels, CONFIG, enabled=False)
        self.assertEqual(selected, original)
        self.assertIsNot(selected, original)
        self.assertEqual(report["status"], "DISABLED")
        self.assertEqual(report["changedEdges"], [])
        self.assertEqual(refine_contours(graph, original, labels, CONFIG),
                         refine_contours(graph, original, labels, CONFIG))

    def test_hole_and_fine_black_stroke_geometry_preserved(self):
        labels = circle()
        labels[26:39, 26:39] = 0
        labels[14:22, 30:32] = 2
        graph, original = baseline(labels)
        selected, report = refine_contours(graph, original, labels, CONFIG)
        self.assertIn(2, report["protectedThinRegionIds"])
        a = {item["edgeId"]: item["segments"] for item in original["geometry"]}
        b = {item["edgeId"]: item["segments"] for item in selected["geometry"]}
        for edge in graph["edges"]:
            if 2 in (edge["leftRegionId"], edge["rightRegionId"]):
                self.assertEqual(a[edge["edgeId"]], b[edge["edgeId"]])
        check = validate_embedding(graph, labels, b, CONFIG["bezier"]["validationFlatnessPx"])
        self.assertTrue(check["pass"])
        self.assertTrue(check["holeCountMatch"])
        self.assertTrue(np.all(check["raster"][26:39, 26:39] == 0))
        self.assertTrue(np.all(check["raster"][14:22, 30:32] == 2))

    def test_shared_geometry_single_identity_and_junction_corner_anchors(self):
        labels = circle()
        yy, xx = np.indices(labels.shape)
        labels[(labels > 0) & (xx >= 32)] = 2
        labels[(labels > 0) & (yy >= 32)] = 3
        graph, original = baseline(labels)
        graph_copy = copy.deepcopy(graph)
        selected, _ = refine_contours(graph, original, labels, CONFIG)
        self.assertEqual(graph, graph_copy)
        geometries = {item["edgeId"]: item["segments"] for item in selected["geometry"]}
        self.assertEqual(len(geometries), len(selected["geometry"]))
        self.assertEqual(set(geometries), {edge["edgeId"] for edge in graph["edges"]})
        corner = CONFIG["cornerDetection"]
        for edge in graph["edges"]:
            points = [tuple(map(float, p)) for p in edge["geometry"]]
            indices, _ = persistent_corners(points, edge["closed"], corner["spans"],
                                             corner["persistentTurnDegrees"], corner["requiredScaleCount"])
            anchors = {tuple(s[k]) for s in geometries[edge["edgeId"]] for k in ("p0", "p1")}
            self.assertTrue({points[i] for i in indices}.issubset(anchors))
            if not edge["closed"]:
                self.assertIn(points[0], anchors)
                self.assertIn(points[-1], anchors)
        self.assertTrue(selected["hardGate"]["zeroIllegalIntersections"])
        self.assertTrue(selected["hardGate"]["adjacencyMatch"])

    def test_same_colour_disconnected_decoration_is_protected_separately(self):
        labels = circle()
        labels[1:4, 1:4] = 1
        graph, original = baseline(labels)
        selected, report = refine_contours(graph, original, labels, CONFIG)
        self.assertNotIn(1, report["protectedThinRegionIds"])
        self.assertTrue(any(item["bboxXYWH"] == [1, 1, 3, 3]
                            for item in report["protectedThinComponents"]))
        a = {item["edgeId"]: item["segments"] for item in original["geometry"]}
        b = {item["edgeId"]: item["segments"] for item in selected["geometry"]}
        self.assertTrue(report["protectedThinEdgeIds"])
        for edge_id in report["protectedThinEdgeIds"]:
            self.assertEqual(a[edge_id], b[edge_id])
        self.assertLess(report["selectedSegmentCount"], report["baselineSegmentCount"])

    def test_mixed_width_black_body_branch_retained_without_freezing_arc(self):
        yy, xx = np.indices((96, 96))
        labels = (((xx-38)**2 + (yy-48)**2) < 26**2).astype(np.int32)
        # Region 1 represents a black body with a three-pixel-wide connected
        # stroke. It is not classified as a complete narrow component.
        labels[47:50, 61:91] = 1
        graph, original = baseline(labels)
        selected, report = refine_contours(graph, original, labels, CONFIG)
        self.assertNotIn(1, report["protectedThinRegionIds"])
        self.assertTrue(report["localBranchProtection"]["regions"])
        self.assertTrue(report["localBranchProtection"]["edgeVertexIndices"])
        geometries = {item["edgeId"]: item["segments"] for item in selected["geometry"]}
        check = validate_embedding(graph, labels, geometries, CONFIG["bezier"]["validationFlatnessPx"])
        self.assertTrue(check["pass"])
        np.testing.assert_array_equal(check["raster"][44:53, 69:94], labels[44:53, 69:94])
        self.assertLess(report["selectedSegmentCount"], report["baselineSegmentCount"])
        self.assertTrue(report["changedEdges"])

    def test_invalid_baseline_and_missing_edge_fail_closed(self):
        labels = circle()
        graph, original = baseline(labels)
        invalid = copy.deepcopy(original)
        invalid["hardGate"]["pass"] = False
        with self.assertRaisesRegex(ValueError, "valid baseline"):
            refine_contours(graph, invalid, labels, CONFIG)
        invalid = copy.deepcopy(original)
        invalid["geometry"].pop()
        with self.assertRaisesRegex(ValueError, "edge identity"):
            refine_contours(graph, invalid, labels, CONFIG)
        invalid = copy.deepcopy(original)
        invalid["geometry"].append(copy.deepcopy(invalid["geometry"][0]))
        with self.assertRaisesRegex(ValueError, "edge identity"):
            refine_contours(graph, invalid, labels, CONFIG)
        changed = labels.copy()
        changed[32, 32] = 2
        with self.assertRaisesRegex(ValueError, "source-label identity"):
            refine_contours(graph, original, changed, CONFIG)

    def test_numerical_failure_retains_baseline_and_does_not_swallow_programming_error(self):
        labels = circle()
        graph, original = baseline(labels)
        with patch("m4_runtime.fit_chain", side_effect=np.linalg.LinAlgError("injected")):
            selected, report = refine_contours(graph, original, labels, CONFIG)
        self.assertEqual(selected, original)
        self.assertTrue(all("NUMERICAL_FIT_FAILURE:LinAlgError" in trial["edgeReasons"].values()
                            for trial in report["trials"]))
        with patch("m4_runtime.fit_chain", side_effect=ValueError("programming error")):
            with self.assertRaisesRegex(ValueError, "programming error"):
                refine_contours(graph, original, labels, CONFIG)

    def test_illegal_trial_is_rejected_by_unchanged_embedding_or_deviation(self):
        labels = circle()
        graph, original = baseline(labels)
        bad = [{"type": "LINE", "p0": [-100.0, -100.0], "p1": [200.0, 200.0]}]
        with patch("m4_runtime.fit_chain", return_value=(bad, {})):
            selected, report = refine_contours(graph, original, labels, CONFIG)
        self.assertEqual(selected, original)
        self.assertTrue(all(any("EMBEDDING" in reason or "DEVIATION" in reason
                                for reason in trial["edgeReasons"].values()) for trial in report["trials"]))


if __name__ == "__main__":
    unittest.main()
