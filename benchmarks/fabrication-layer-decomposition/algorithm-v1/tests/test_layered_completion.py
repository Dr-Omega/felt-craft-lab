import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from shapely.geometry import box, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from layered_completion import (LayeredPlanError, propose_layered_plans,
                                rank_layered_plans, validate_layered_plan,
                                _hidden_domain, _group, _materialize)
from solid_plans import decompose_solid


def old_union_coverage(full, upper):
    """Preserve the historical faulty arithmetic as explicit fault injection."""
    merged = unary_union([g for _, g in upper])
    return (full.difference(merged), _hidden_domain(full, merged),
            sorted(k for k, g in upper if full.intersection(g).area > 0))


def old_axis_partition(polygon, axis='x'):
    return decompose_solid(polygon, axis, clip_numeric_parts=True)


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


def fractional_nested():
    outer = Polygon([(.2, 1.7), (9.3, .4), (11.6, 8.9), (6.7, 11.2), (1.1, 9.8)])
    middle = Polygon([(2.23, 3.18), (7.47, 1.91), (9.37, 7.86), (5.13, 8.73)])
    upper = Polygon([(4.39, 4.67), (6.23, 3.41), (7.59, 6.17), (5.11, 7.03)])
    return [observed(outer.difference(middle), 'outer', 'red'),
            observed(middle.difference(upper), 'middle', 'white'),
            observed(upper, 'upper', 'black')]


class LayeredCompletionTests(unittest.TestCase):
    def test_partition_contact_lines_do_not_become_material_or_undefined_boundaries(self):
        from vertex_partition import partition
        full = box(0, 0, 5, 4)
        red = [observed(box(0, 0, 1, 4), 'left-red', 'red'),
               observed(box(4, 0, 5, 1), 'right-red', 'red')]
        upper = [observed(box(1, 0, 4, 4), 'middle-white', 'white'),
                 observed(box(4, 1, 5, 4), 'right-white', 'white')]
        sources = red + upper
        visible = unary_union([s['polygon'] for s in red])
        self.assertEqual(box(0, 0, 4, 4).intersection(visible).geom_type, 'GeometryCollection')
        base = {'sources': red, 'full': full, 'visible': visible,
                'evidence': [{'method': 'test-support', 'inferredHiddenGeometry': True}]}
        def split(polygon, axis):
            return [box(0, 0, 4, 4), box(4, 0, 5, 4)] if polygon.equals(full) else partition(polygon, axis)
        with patch('layered_completion.vertex_partition', side_effect=split):
            plan = _materialize([base] + [_group(s) for s in upper], sources, 'x', 'test-support')
        self.assertTrue(all(p['visiblePolygon'].geom_type in ('Polygon', 'MultiPolygon') for p in plan['pieces']))
        self.assertEqual(validate_layered_plan(sources, plan)['exactVisibleCoverage'], 'PASS')
        rank_layered_plans(sources, [plan])

    def test_public_rank_rejects_fractional_invalid_candidates_not_only_best_plan(self):
        sources = fractional_nested()
        for axis in ('x', 'y'):
            with self.subTest(axis=axis):
                # Fault injection creates the formerly accepted candidate;
                # actual public ranking below executes the real complete gate.
                with patch('layered_completion.validate_layered_plan', return_value={'injected': True}), \
                        patch('layered_completion.vertex_partition', side_effect=old_axis_partition), \
                        patch('layered_completion.ordered_coverage', side_effect=old_union_coverage):
                    bad = _materialize([_group(s) for s in sources], sources, axis, 'observed-solid-partition')
                with self.assertRaises(LayeredPlanError):
                    rank_layered_plans(sources, [bad])
        valid = propose_layered_plans(sources)
        self.assertEqual(valid[0]['score']['pieceCount'], 3)
        self.assertEqual(valid[0]['score']['layerDepth'], 3)
        repaired = [trial for trial in valid[0]['proposalSearch']
                    if trial['mode'] == 'observed-solid-partition']
        self.assertEqual(len(repaired), 2)
        self.assertTrue(all(trial['status'] == 'VALID' for trial in repaired))

    def test_tiny_union_hidden_without_real_occluder_cannot_gain_forged_hypothesis(self):
        sources = fractional_nested()
        with patch('layered_completion.validate_layered_plan', return_value={'injected': True}), \
                patch('layered_completion.vertex_partition', side_effect=old_axis_partition), \
                patch('layered_completion.ordered_coverage', side_effect=old_union_coverage):
            bad = _materialize([_group(s) for s in sources], sources, 'x', 'observed-solid-partition')
        suspect = [p for p in bad['pieces'] if p['hiddenPolygon'].area > 0 and not p['occluderIds']]
        self.assertTrue(suspect)
        for p in suspect:
            p['completionEvidence'] = [{'method': 'forged-hypothesis', 'inferredHiddenGeometry': True}]
        with self.assertRaises(LayeredPlanError):
            rank_layered_plans(sources, [bad])

    def test_hidden_material_requires_explicit_hypothesis_in_public_rank(self):
        sources = nested(['red', 'white', 'black'])
        plan = copy.deepcopy(propose_layered_plans(sources)[0])
        piece = next(p for p in plan['pieces'] if p['hiddenPolygon'].area > 0)
        piece['completionEvidence'] = [{'method': 'observed-domain', 'inferredHiddenGeometry': False}]
        with self.assertRaisesRegex(LayeredPlanError, 'hypothesis'):
            rank_layered_plans(sources, [plan])

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
