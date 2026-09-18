from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = ROOT.parents[1]
B2_ROOT = ROOT / "fabrication-decomposition"
sys.path[:0] = [str(B2_ROOT / "src"), str(ROOT / "tools")]

from b2_contract import (  # noqa: E402
    B2ContractError,
    CASE_IDS,
    PRIMARY_PROFILE,
    assert_no_forbidden_keys,
    build_v0_case,
    canonical_bytes,
    validate_closed_ring,
    validate_overlap_relations,
)
from validate_b2_v0 import validate  # noqa: E402


class B2V0UnitTests(unittest.TestCase):
    def test_closed_ring_accepts_directed_frozen_edges(self):
        edges = {
            "a": {"edgeId": "a", "segments": [{"type": "LINE", "p0": [0, 0], "p1": [1, 0]}]},
            "b": {"edgeId": "b", "segments": [{"type": "LINE", "p0": [1, 1], "p1": [1, 0]}]},
            "c": {"edgeId": "c", "segments": [{"type": "LINE", "p0": [1, 1], "p1": [0, 1]}]},
            "d": {"edgeId": "d", "segments": [{"type": "LINE", "p0": [0, 1], "p1": [0, 0]}]},
        }
        ring = {"ringId": "r", "edgeReferences": [{"edgeId": "a", "direction": 1}, {"edgeId": "b", "direction": -1}, {"edgeId": "c", "direction": 1}, {"edgeId": "d", "direction": 1}]}
        validate_closed_ring(ring, edges)

    def test_open_ring_fails(self):
        edges = {"a": {"edgeId": "a", "segments": [{"type": "LINE", "p0": [0, 0], "p1": [1, 0]}]}}
        with self.assertRaises(B2ContractError):
            validate_closed_ring({"ringId": "r", "edgeReferences": [{"edgeId": "a", "direction": 1}]}, edges)

    def test_partial_order_cycle_fails(self):
        relations = [
            {"relationId": "1", "pieceA": "a", "pieceB": "b", "relation": "BELOW"},
            {"relationId": "2", "pieceA": "b", "pieceB": "a", "relation": "BELOW"},
        ]
        with self.assertRaises(B2ContractError):
            validate_overlap_relations({"a", "b"}, relations)

    def test_ambiguous_relation_does_not_fabricate_order(self):
        validate_overlap_relations({"a", "b"}, [{"relationId": "1", "pieceA": "a", "pieceB": "b", "relation": "AMBIGUOUS"}])

    def test_forbidden_repair_color_layer_and_material_fields_fail(self):
        for key in ("safeMerge", "SAFE_MERGE", "repairPolicy", "colorLayerId", "colorGroupId", "materialId"):
            with self.subTest(key=key), self.assertRaises(B2ContractError):
                assert_no_forbidden_keys({key: "forbidden"})


class B2V0IntegrationTests(unittest.TestCase):
    def test_all_eight_outputs_validate(self):
        self.assertEqual(validate(), [])

    def test_each_frozen_component_is_consumed_once(self):
        for fixture_id in CASE_IDS:
            result = json.loads((B2_ROOT / "outputs" / "v0" / fixture_id / "result.json").read_text(encoding="utf-8"))
            consumed = [(piece["sourceRegionIds"][0], piece["sourceComponentIds"][0]) for piece in result["pieces"]]
            self.assertEqual(len(consumed), len(set(consumed)))
            self.assertEqual(len(consumed), result["hardGate"]["frozenComponentCount"])

    def test_observed_only_has_no_hidden_or_boundary_mutation(self):
        for fixture_id in CASE_IDS:
            result = json.loads((B2_ROOT / "outputs" / "v0" / fixture_id / "result.json").read_text(encoding="utf-8"))
            self.assertTrue(all(piece["inferredGeometry"] is None for piece in result["pieces"]))
            self.assertTrue(all(piece["observedGeometry"] == piece["finalCutGeometry"] for piece in result["pieces"]))
            self.assertEqual(result["overlapContract"]["relations"], [])

    def test_component_and_hole_topology_is_derived_and_preserved(self):
        for fixture_id in CASE_IDS:
            result = json.loads((B2_ROOT / "outputs" / "v0" / fixture_id / "result.json").read_text(encoding="utf-8"))
            gate = result["hardGate"]
            observed_holes = sum(len(piece["observedGeometry"]["innerRings"]) for piece in result["pieces"])
            self.assertEqual(gate["observedInnerRingCount"], observed_holes)
            self.assertEqual(gate["frozenInnerRingCount"], observed_holes)
            self.assertTrue(gate["componentAndHoleSemanticsPreserved"])

    def test_region_piece_and_color_layer_identities_are_separate(self):
        result = build_v0_case(REPOSITORY_ROOT, ROOT, "FLD-002")
        self.assertEqual(result["profile"], PRIMARY_PROFILE)
        for piece in result["pieces"]:
            self.assertIsInstance(piece["sourceRegionIds"][0], int)
            self.assertTrue(piece["pieceId"].startswith("FP-FLD-002-"))
            self.assertNotIn("colorLayerId", piece)

    def test_generation_is_byte_deterministic(self):
        first = build_v0_case(REPOSITORY_ROOT, ROOT, "FLD-007")
        second = build_v0_case(REPOSITORY_ROOT, ROOT, "FLD-007")
        self.assertEqual(canonical_bytes(first), canonical_bytes(second))


if __name__ == "__main__":
    unittest.main()
