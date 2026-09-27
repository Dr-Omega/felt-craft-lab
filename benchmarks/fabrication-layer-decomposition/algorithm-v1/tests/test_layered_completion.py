import copy
from pathlib import Path
import sys
import unittest

from shapely.geometry import box, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from layered_completion import (LayeredPlanError, propose_layered_plans,
                                rank_layered_plans, validate_layered_plan,
                                _hidden_domain)


def observed(polygon, name, color):
    rgb = {"white": [245, 245, 235], "black": [15, 15, 20], "red": [220, 45, 30],
           "yellow": [230, 195, 25]}[color]
    return {"polygon": polygon, "componentId": name, "regionId": "region-"+color,
            "colorSlotId": color, "rgb": rgb,
            "boundaryProvenance": {"selectedVectorArtifactId": "selected", "edgeIds": [name]}}


def nested(colors):
    squares = [box(i*2, i*2, 20-i*2, 20-i*2) for i in range(len(colors))]
    return [observed(squares[i].difference(squares[i+1]) if i+1 < len(colors) else squares[i],
                     "c"+str(i), color) for i, color in enumerate(colors)]


class LayeredCompletionTests(unittest.TestCase):
    def test_nonorthogonal_hidden_intersection_does_not_cancel_remote_boundary(self):
        # Independently generated convex polygon / rotated rectangle (seed 319),
        # not coordinates or a shape extracted from any material-library image.
        full = Polygon([(9.290655025828848, .5250667124816466),
                        (.0141893665862924, 4.861699569696992),
                        (2.0207456741814256, 9.547182686297788),
                        (9.451035997344611, 4.991344078336233)])
        above = Polygon([(9.343614504884847, 5.188271724556769),
                         (5.611364157790723, 8.894740036388907),
                         (.9042903321179678, 4.154924006238955),
                         (4.636540679212093, .4484556944068161)])
        source_visible = full.difference(above).intersection(full)
        cancellation = full.difference(source_visible)
        actual = full.intersection(above)
        # Area-only comparison cannot detect this remote, near-zero-area edge.
        self.assertLess(cancellation.symmetric_difference(actual).area, 1e-10)
        self.assertGreater(cancellation.boundary.hausdorff_distance(actual.boundary), 1.)
        self.assertTrue(_hidden_domain(full, above).equals(actual))
        self.assertEqual(_hidden_domain(full, above).boundary.hausdorff_distance(actual.boundary), 0.)

    def test_reusable_rank_rejects_tiny_hidden_forgery_with_remote_boundary(self):
        sources = nested(["red", "white", "black"])
        plan = copy.deepcopy(propose_layered_plans(sources)[0])
        piece = next(p for p in plan["pieces"] if p["colorSlotId"] == "red")
        tiny = Polygon([(0.5, 0.5), (0.75, 0.5), (0.5, 0.5+1e-13)])
        piece["hiddenPolygon"] = piece["hiddenPolygon"].union(tiny)
        with self.assertRaisesRegex(LayeredPlanError, "hidden geometry"):
            rank_layered_plans(sources, [plan])

    def test_three_actual_layers_complete_middle_eye_not_only_base(self):
        sources = nested(["red", "white", "black"])
        selected = propose_layered_plans(sources)[0]
        self.assertEqual(selected["score"]["pieceCount"], 3)
        self.assertEqual(selected["score"]["layerDepth"], 3)
        white = next(p for p in selected["pieces"] if p["colorSlotId"] == "white")
        self.assertTrue(white["polygon"].equals(box(2, 2, 18, 18)))
        self.assertGreater(white["hiddenPolygon"].area, 0)
        self.assertEqual(selected["physicalSeams"], [])

    def test_four_actual_layers_with_same_color_at_distinct_depths(self):
        sources = nested(["red", "white", "red", "black"])
        selected = propose_layered_plans(sources)[0]
        self.assertEqual(selected["score"]["pieceCount"], 4)
        self.assertEqual(selected["score"]["layerDepth"], 4)
        ordered = {p["id"]: p for p in selected["pieces"]}
        self.assertEqual([ordered[i]["colorSlotId"] for i in selected["bottomToTop"]],
                         ["red", "white", "red", "black"])

    def test_same_color_interrupted_shape_joins_only_under_real_occluder(self):
        sources = [observed(box(0, 0, 4, 4), "left", "white"),
                   observed(box(6, 0, 10, 4), "right", "white"),
                   observed(box(4, 0, 6, 4), "occluder", "black")]
        selected = propose_layered_plans(sources)[0]
        self.assertEqual(selected["score"]["pieceCount"], 2)
        white = next(p for p in selected["pieces"] if p["colorSlotId"] == "white")
        self.assertEqual(white["sourceComponentIds"], ["left", "right"])
        self.assertTrue(white["polygon"].equals(box(0, 0, 10, 4)))
        self.assertTrue(white["hiddenPolygon"].equals(box(4, 0, 6, 4)))

    def test_transparency_gap_never_bridged(self):
        sources = [observed(box(0, 0, 4, 4), "left", "white"),
                   observed(box(6, 0, 10, 4), "right", "white")]
        for plan in propose_layered_plans(sources):
            self.assertEqual(plan["score"]["pieceCount"], 2)
            self.assertEqual(plan["score"]["hiddenAreaCanonical"], 0)

    def test_true_hole_remains_transparent_and_final_pieces_are_hole_free(self):
        domain = box(0, 0, 10, 10).difference(box(3, 3, 7, 7))
        sources = [observed(domain, "ring", "white")]
        for plan in propose_layered_plans(sources):
            self.assertTrue(all(not p["polygon"].interiors for p in plan["pieces"]))
            self.assertTrue(unary_union([p["polygon"] for p in plan["pieces"]]).equals(domain))
            self.assertGreater(plan["score"]["physicalSeamRecordCount"], 0)

    def test_point_contact_is_not_zero_width_material_bridge(self):
        sources = [observed(box(0, 0, 4, 4), "a", "white"),
                   observed(box(4, 4, 8, 8), "b", "white")]
        selected = propose_layered_plans(sources)[0]
        self.assertEqual(selected["score"]["pieceCount"], 2)
        self.assertEqual(selected["score"]["hiddenAreaCanonical"], 0)

    def test_completion_order_conflict_is_bounded_alternative_not_global_color_order(self):
        a, b = box(0, 0, 4, 4), box(6, 0, 10, 4)
        surround = box(-1, -1, 11, 5).difference(a.union(b))
        sources = [observed(a, "a", "white"), observed(b, "b", "white"),
                   observed(surround, "surround", "black")]
        plans = propose_layered_plans(sources)
        self.assertLessEqual(len(plans), 9)
        # Black completion puts white above black; the separate bridge-first
        # construction puts white below black cut pieces. Both are real options.
        orders = set()
        for plan in plans:
            pieces = {p["id"]: p for p in plan["pieces"]}
            orders.add(tuple(pieces[i]["colorSlotId"] for i in plan["bottomToTop"]))
            validate_layered_plan(sources, plan)
        self.assertTrue(any(order[0] == "black" for order in orders))
        self.assertTrue(any(order[0] == "white" for order in orders))

    def test_tiny_partial_occluder_cannot_authorize_transparent_bridge(self):
        sources = [observed(box(0, 0, 4, 4), "left", "white"),
                   observed(box(6, 0, 10, 4), "right", "white"),
                   observed(box(4, 1.99, 6, 2.01), "thin", "black")]
        for plan in propose_layered_plans(sources):
            foreground = unary_union([s["polygon"] for s in sources])
            self.assertEqual(unary_union([p["polygon"] for p in plan["pieces"]]).difference(foreground).area, 0)
            # Reused historical support may follow the actual narrow foreground;
            # the new convex completion must never widen it into transparency.
            if plan["proposal"]["mode"] != "LEGACY_BASE_SUPPORT_REUSED":
                self.assertEqual(plan["score"]["pieceCount"], 3)
                self.assertEqual(plan["score"]["hiddenAreaCanonical"], 0)

    def test_rank_rejects_forged_order_even_if_declared_score_is_perfect(self):
        sources = nested(["red", "white", "black"])
        selected = copy.deepcopy(propose_layered_plans(sources)[0])
        selected["bottomToTop"].reverse()
        selected["score"] = {"pieceCount": 0}
        with self.assertRaises((LayeredPlanError, ValueError)):
            rank_layered_plans(sources, [selected])

    def test_rehashed_metadata_does_not_authorize_wrong_component_membership(self):
        sources = nested(["red", "white", "black"])
        plan = copy.deepcopy(propose_layered_plans(sources)[0])
        plan["pieces"][0]["sourceComponentIds"] = ["forged"]
        plan["id"] = "new-valid-looking-identity"
        with self.assertRaisesRegex(LayeredPlanError, "membership"):
            validate_layered_plan(sources, plan)

    def test_missing_occluder_rejected(self):
        sources = nested(["red", "white", "black"])
        plan = copy.deepcopy(propose_layered_plans(sources)[0])
        next(p for p in plan["pieces"] if p["occluderIds"])["occluderIds"] = []
        with self.assertRaisesRegex(LayeredPlanError, "occluder"):
            validate_layered_plan(sources, plan)

    def test_persisted_old_score_not_trusted_and_input_order_is_irrelevant(self):
        sources = nested(["red", "white", "black"])
        a = propose_layered_plans(sources)
        b = propose_layered_plans(list(reversed(sources)))
        self.assertEqual([p["id"] for p in a], [p["id"] for p in b])
        a[0]["score"]["pieceCount"] = -1
        ranked = rank_layered_plans(sources, a)
        self.assertEqual(ranked[0]["score"]["pieceCount"], 3)


if __name__ == "__main__":
    unittest.main()
