from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import numpy as np

POC_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(POC_ROOT / "src"))

from bezier_fit import fit_chain, flatten_segments
from boundary_graph import build_boundary_graph
from geometry_validation import geometry_deviation, illegal_intersections, validate_embedding
from polygon_simplify import exact_line_segments, persistent_corners, simplify_chain
from vector_contract import canonical_json_bytes

CONFIG = json.loads((POC_ROOT / "configs" / "poc.v1.json").read_text(encoding="utf-8"))


class VectorRouteTests(unittest.TestCase):
    def test_corner_detector_rejects_some_raster_stair_steps(self):
        points = [(0.0, 4.0), (1.0, 4.0), (1.0, 3.0), (2.0, 3.0), (2.0, 2.0), (3.0, 2.0), (3.0, 1.0), (4.0, 1.0), (4.0, 0.0)]
        _, diagnostics = persistent_corners(points, False, [2, 4], 42.0, 2)
        self.assertGreater(diagnostics["candidateCount"], 0)
        self.assertGreater(diagnostics["rejectedRasterStepCount"], 0)

    def test_rdp_preserves_chain_end_junctions(self):
        edge = {"geometry": [[0, 0], [1, 0], [2, 1], [3, 1]], "closed": False}
        segments, _ = simplify_chain(edge, 1.0, CONFIG["cornerDetection"])
        self.assertEqual(segments[0]["p0"], [0.0, 0.0])
        self.assertEqual(segments[-1]["p1"], [3.0, 1.0])

    def test_bezier_keeps_endpoints_and_straight_runs_as_lines(self):
        straight = {"geometry": [[0, 0], [1, 0], [2, 0], [3, 0]], "closed": False}
        segments, diagnostics = fit_chain(straight, 1.0, CONFIG["cornerDetection"], CONFIG["bezier"])
        self.assertEqual({item["type"] for item in segments}, {"LINE"})
        self.assertEqual(segments[0]["p0"], [0.0, 0.0])
        self.assertEqual(segments[-1]["p1"], [3.0, 0.0])
        self.assertEqual(diagnostics["cubicSegmentCount"], 0)

    def test_adaptive_flattening_and_bidirectional_deviation_are_recorded(self):
        edge = {"geometry": [[0, 0], [0, 1], [1, 2], [2, 2]], "closed": False}
        segments, _ = fit_chain(edge, 1.0, CONFIG["cornerDetection"], CONFIG["bezier"])
        flattened = flatten_segments(segments, CONFIG["bezier"]["validationFlatnessPx"])
        self.assertGreaterEqual(len(flattened), 2)
        record = geometry_deviation([tuple(map(float, point)) for point in edge["geometry"]], segments, CONFIG["bezier"]["validationFlatnessPx"])
        self.assertIn("originalToCandidateMax", record)
        self.assertIn("candidateToOriginalMax", record)
        self.assertGreaterEqual(record["symmetricMax"], record["mean"])

    def test_global_validator_rejects_nonadjacent_crossing(self):
        labels = np.array([[1, 1], [2, 2]], dtype=np.int32)
        graph = build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)
        geometries = {edge["edgeId"]: exact_line_segments(edge) for edge in graph["edges"]}
        outer = [edge["edgeId"] for edge in graph["edges"] if edge["boundaryType"] == "OUTER"]
        self.assertGreaterEqual(len(outer), 2)
        geometries[outer[0]] = [{"type": "LINE", "p0": [0.0, 0.0], "p1": [2.0, 2.0]}]
        geometries[outer[1]] = [{"type": "LINE", "p0": [2.0, 0.0], "p1": [0.0, 2.0]}]
        record = illegal_intersections(graph, geometries, 0.0625)
        self.assertGreater(record["count"], 0)

    def test_exact_embedding_preserves_components_holes_and_adjacency(self):
        labels = np.array([[1, 1, 0, 2], [1, 0, 0, 2], [1, 1, 2, 2]], dtype=np.int32)
        graph = build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)
        exact = {edge["edgeId"]: exact_line_segments(edge) for edge in graph["edges"]}
        validation = validate_embedding(graph, labels, exact, 0.0625)
        self.assertTrue(validation["pass"])

    def test_v1_and_v2_geometry_artifacts_are_byte_identical_across_three_runs(self):
        labels = np.array([[0, 1, 1, 0], [1, 1, 1, 1], [1, 1, 1, 1], [0, 1, 1, 0]], dtype=np.int32)
        graph = build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)

        def generate() -> bytes:
            payload = {"V1": {}, "V2": {}}
            for edge in graph["edges"]:
                edge_id = edge["edgeId"]
                payload["V1"][edge_id] = simplify_chain(edge, 1.0, CONFIG["cornerDetection"])[0]
                payload["V2"][edge_id] = fit_chain(edge, 1.0, CONFIG["cornerDetection"], CONFIG["bezier"])[0]
            return canonical_json_bytes(payload)

        first, second, third = generate(), generate(), generate()
        self.assertEqual(first, second)
        self.assertEqual(second, third)


if __name__ == "__main__":
    unittest.main()
