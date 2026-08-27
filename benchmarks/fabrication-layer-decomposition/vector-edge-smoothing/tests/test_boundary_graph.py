from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

POC_ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_ROOT = POC_ROOT.parent
sys.path.insert(0, str(POC_ROOT / "src"))

from boundary_graph import BoundaryGraphError, build_boundary_graph, rasterize_paths, serialize_graph
from vector_contract import canonical_json_bytes, write_json_gz


class BoundaryGraphTests(unittest.TestCase):
    def test_shared_geometry_is_stored_once_and_referenced_in_both_directions(self):
        labels = np.array([[1, 2], [1, 2]], dtype=np.int32)
        graph = build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)
        shared = [edge for edge in graph["edges"] if edge["boundaryType"] == "SHARED"]
        self.assertEqual(len(shared), 1)
        edge_id = shared[0]["edgeId"]
        references = [
            reference["direction"]
            for ring in graph["_rings"]
            for reference in ring["edgeReferences"]
            if reference["edgeId"] == edge_id
        ]
        self.assertEqual(sorted(references), [-1, 1])

    def test_checkerboard_point_touch_is_locked_and_not_paired_through(self):
        labels = np.array([[1, 2], [2, 1]], dtype=np.int32)
        graph = build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)
        center = next(item for item in graph["vertices"] if item["position"] == [1, 1])
        self.assertEqual(center["junctionKind"], "CHECKERBOARD_POINT_TOUCH")
        self.assertTrue(center["fitLocked"])
        self.assertEqual(center["unitDegree"], 4)
        for edge_id in center["incidentEdgeIds"]:
            edge = graph["_edgeById"][edge_id]
            self.assertIn([1, 1], (edge["geometry"][0], edge["geometry"][-1]))
        regions = {item["regionId"]: len(item["components"]) for item in graph["regions"]}
        self.assertEqual(regions, {1: 2, 2: 2})
        self.assertTrue(np.array_equal(rasterize_paths(graph), labels))

    def test_hole_and_outer_are_derived_from_structural_zero_components(self):
        labels = np.ones((5, 5), dtype=np.int32)
        labels[2, 2] = 0
        graph = build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)
        self.assertEqual([(item["kind"], item["area"]) for item in graph["voids"]], [("HOLE", 1)])
        self.assertTrue(any(edge["boundaryType"] == "HOLE" for edge in graph["edges"]))
        self.assertTrue(any(edge["boundaryType"] == "OUTER" for edge in graph["edges"]))
        self.assertTrue(np.array_equal(rasterize_paths(graph), labels))

    def test_alpha_is_audit_only_and_mismatch_fails_closed(self):
        labels = np.array([[0, 1]], dtype=np.int32)
        with self.assertRaisesRegex(BoundaryGraphError, "STRUCTURAL_ALPHA_TOPOLOGY_MISMATCH"):
            build_boundary_graph(labels, np.array([[255, 255]], dtype=np.uint8))

    def test_canonical_graph_is_byte_deterministic(self):
        labels = np.array([[1, 1, 0], [1, 2, 2], [0, 2, 0]], dtype=np.int32)
        first = canonical_json_bytes(serialize_graph(build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)))
        second = canonical_json_bytes(serialize_graph(build_boundary_graph(labels, (labels > 0).astype(np.uint8) * 255)))
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as directory:
            left, right = Path(directory) / "a.json.gz", Path(directory) / "b.json.gz"
            write_json_gz(left, json.loads(first))
            write_json_gz(right, json.loads(second))
            self.assertEqual(left.read_bytes(), right.read_bytes())

    def test_all_frozen_cp_b_maps_have_byte_identical_v0_round_trip(self):
        for profile in ("cp-b-aggressive_rc-a", "cp-b-balanced_rc-a"):
            for index in range(1, 9):
                case_id = f"FLD-{index:03d}"
                case_root = BENCHMARK_ROOT / "outputs" / "color-purification" / profile / case_id
                labels = np.load(case_root / "structural_label_map.npz")["labels"]
                pixel = np.load(case_root / "pixel_label_map.npz")["labels"]
                alpha = np.asarray(Image.open(BENCHMARK_ROOT / "fixtures" / "source" / f"{case_id}.png").convert("RGBA"))[..., 3]
                self.assertTrue(np.array_equal(labels, pixel), (profile, case_id))
                graph = build_boundary_graph(labels, alpha)
                self.assertTrue(np.array_equal(rasterize_paths(graph), labels), (profile, case_id))


if __name__ == "__main__":
    unittest.main()
