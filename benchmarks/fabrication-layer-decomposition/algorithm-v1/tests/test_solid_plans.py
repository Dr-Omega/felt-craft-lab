import copy
from pathlib import Path
import sys
import unittest

from shapely.geometry import Polygon, box, LineString
from shapely.ops import unary_union
from shapely.affinity import translate

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from solid_plans import SolidPlanError, decompose_solid, propose_plans, validate_plan, _local_plan


def observed(polygon, component="c1", slot="red", region=None):
    return {"id": component, "componentId": component, "regionId": region or "r-"+component,
            "colorSlotId": slot, "rgb": {"red": [220, 40, 35], "blue": [20, 60, 225]}[slot],
            "polygon": polygon, "boundaryProvenance": {"selectedVectorArtifactId": "dev-selected-vector", "edgeIds": [component+"-edge"]}}


class SolidPlansTest(unittest.TestCase):
    def assert_partition(self, domain, pieces):
        self.assertAlmostEqual(unary_union(pieces).symmetric_difference(domain).area, 0, places=8)
        self.assertAlmostEqual(sum(p.area for p in pieces), domain.area, places=8)
        for piece in pieces:
            self.assertTrue(piece.is_valid)
            self.assertGreater(piece.area, 0)
            self.assertEqual(len(piece.interiors), 0)
            self.assertEqual(piece.geom_type, "Polygon")

    def test_hole_partition_preserves_inherited_curved_polyline_boundary(self):
        outer = [(0,0),(8,-1),(14,0),(15,7),(12,13),(3,14),(-1,6)]
        domain = Polygon(outer, holes=[[(4,4),(9,3),(10,8),(5,9)]])
        for axis in ("x", "y"):
            pieces = decompose_solid(domain, axis)
            self.assertGreater(len(pieces), 1)
            self.assert_partition(domain, pieces)
            self.assertLess(unary_union(pieces).boundary.hausdorff_distance(domain.boundary), 1e-10)

    def test_solid_no_hole_path_preserves_original_polygon_identity(self):
        polygon = Polygon([(0,0),(4,0),(5,3),(2,6),(0,3)])
        for axis in ("x", "y"):
            parts = decompose_solid(polygon, axis)
            self.assertEqual(len(parts), 1)
            self.assertIs(parts[0], polygon)

    def test_call_local_partition_cache_changes_no_candidate_geometry(self):
        body = box(0,0,12,12)
        inner = box(3,3,9,9)
        sources = [observed(body.difference(inner)), observed(inner, "c2", "blue")]
        cache = {}
        for axis in ("x", "y"):
            for slot in ("red", "blue"):
                uncached = _local_plan(sources, body, 1, slot, axis)
                cached = _local_plan(sources, body, 1, slot, axis, cache)
                self.assertEqual(uncached, cached)
                self.assertEqual([p["polygon"].wkb for p in uncached["pieces"]],
                                 [p["polygon"].wkb for p in cached["pieces"]])
        self.assertEqual(len(cache), 6)

    def test_multiple_holes_greedily_recombine_cells(self):
        domain = Polygon(box(0,0,20,16).exterior.coords,
                         holes=[box(2,2,5,5).exterior.coords, box(12,8,17,13).exterior.coords])
        for axis in ("x", "y"):
            pieces = decompose_solid(domain, axis)
            self.assert_partition(domain, pieces)
            self.assertLessEqual(len(pieces), 4)
            self.assertTrue(all(len(p.exterior.coords) > 4 for p in pieces))

    def test_inner_other_color_is_not_global_hole_and_real_color_tradeoff(self):
        outer, inner = box(0,0,12,12), box(1,1,11,11)
        sources = [observed(outer.difference(inner)), observed(inner, "c2", "blue")]
        plans = propose_plans(sources)
        self.assertGreaterEqual(len(plans), 2)
        self.assertLess(sources[0]["polygon"].area, sources[1]["polygon"].area)
        self.assertEqual(plans[0]["baseChoices"][0]["colorSlotId"], "red")
        self.assertEqual(plans[0]["score"]["pieceCount"], 2)
        self.assertEqual(plans[0]["score"]["visibleSeamLengthCanonical"], 0)
        blue = next(p for p in plans if p["baseChoices"][0]["colorSlotId"] == "blue")
        self.assertGreater(blue["score"]["visibleSeamLengthCanonical"], 0)
        self.assertGreater(blue["score"]["interiorSeamLengthCanonical"], 0)
        self.assertGreater(blue["score"]["pieceCount"], plans[0]["score"]["pieceCount"])
        for plan in plans:
            bases = unary_union([p["polygon"] for p in plan["pieces"] if p["role"] == "BASE"])
            self.assertTrue(bases.equals(outer))
            self.assertEqual(plan["geometryChecks"]["sourceCoverage"], "PASS")

    def test_base_hole_is_split_and_all_base_seams_are_exposed_nonzero(self):
        domain = box(0,0,12,10).difference(box(3,3,8,7))
        sources = [observed(domain)]
        plans = propose_plans(sources)
        for plan in plans:
            self.assertTrue(all(p["role"] == "BASE" for p in plan["pieces"]))
            self.assert_partition(domain, [p["polygon"] for p in plan["pieces"]])
            self.assertGreater(plan["score"]["visibleSeamLengthCanonical"], 0)
            self.assertGreater(plan["score"]["interiorSeamLengthCanonical"], 0)
            self.assertEqual(len(plan["splitGroups"]), 1)
            self.assertGreater(len(plan["splitGroups"][0]["seams"]), 0)

    def test_samecolor_disconnected_or_diagonal_subjects_get_no_bridge(self):
        sources = [observed(box(0,0,2,2)), observed(box(2,2,4,4), "c2", region="r-c1"),
                   observed(box(10,0,12,2), "c3", region="r-c1")]
        plan = propose_plans(sources)[0]
        self.assertEqual(len(plan["pieces"]), 3)
        self.assertEqual(len(plan["baseChoices"]), 3)
        self.assertEqual(plan["splitGroups"], [])
        self.assertTrue(unary_union([p["polygon"] for p in plan["pieces"]]).equals(unary_union([s["polygon"] for s in sources])))
        self.assertEqual({tuple(p["sourceComponentIds"]) for p in plan["pieces"]}, {("c1",),("c2",),("c3",)})

    def test_seam_sides_endpoints_and_lengths_are_actual_geometry(self):
        sources = [observed(box(0,0,12,10).difference(box(3,3,8,7)))]
        plan = propose_plans(sources)[0]
        pieces = {p["id"]: p for p in plan["pieces"]}
        all_lines = []
        for group in plan["splitGroups"]:
            signatures = set()
            for seam in group["seams"]:
                a, b = seam["pieceIds"]
                self.assertNotEqual(a,b)
                self.assertIn(a, group["pieceIds"])
                self.assertIn(b, group["pieceIds"])
                line = seam["polyline"]
                self.assertAlmostEqual(line.length, seam["lengthCanonical"])
                self.assertGreater(seam["visibleLengthCanonical"], 0)
                self.assertAlmostEqual(line.difference(pieces[a]["polygon"].boundary).length, 0)
                self.assertAlmostEqual(line.difference(pieces[b]["polygon"].boundary).length, 0)
                self.assertEqual(len(line.coords[0]), 2)
                signature = (tuple(sorted([a,b])), line.wkb)
                self.assertNotIn(signature, signatures)
                signatures.add(signature)
                all_lines.append(line)
        self.assertAlmostEqual(plan["score"]["totalSeamLengthCanonical"], unary_union(all_lines).length)

    def test_reproducible_input_order_and_plan_identity(self):
        sources = [observed(box(0,0,4,4)), observed(box(4,0,8,4), "c2", "blue")]
        a, b = propose_plans(sources), propose_plans(list(reversed(sources)))
        self.assertEqual([p["id"] for p in a], [p["id"] for p in b])
        self.assertEqual([p["score"] for p in a], [p["score"] for p in b])

    def test_reject_self_intersection_and_overlapping_observed_domains(self):
        with self.assertRaises(SolidPlanError):
            propose_plans([observed(Polygon([(0,0),(3,3),(0,3),(3,0)]))])
        with self.assertRaisesRegex(SolidPlanError, "overlap"):
            propose_plans([observed(box(0,0,4,4)), observed(box(3,0,7,4), "c2", "blue")])

    def test_reject_missing_provenance_and_inconsistent_colors(self):
        source = observed(box(0,0,4,4))
        source["boundaryProvenance"] = {}
        with self.assertRaisesRegex(SolidPlanError, "provenance"):
            propose_plans([source])
        sources = [observed(box(0,0,4,4)), observed(box(5,0,9,4), "c2")]
        sources[1]["rgb"] = [220,40,36]
        with self.assertRaisesRegex(SolidPlanError, "RGB"):
            propose_plans(sources)

    def test_independent_validation_detects_moved_piece_and_wrong_exposure(self):
        sources = [observed(box(0,0,12,12).difference(box(4,4,8,8))), observed(box(4,4,8,8), "c2", "blue")]
        plan = propose_plans(sources)[0]
        altered = copy.deepcopy(plan)
        altered["pieces"][0]["polygon"] = translate(altered["pieces"][0]["polygon"], 1, 0)
        with self.assertRaises(SolidPlanError):
            validate_plan(sources, altered)
        altered = copy.deepcopy(plan)
        altered["baseExposures"][0]["polygon"] = box(0,0,12,12)
        with self.assertRaisesRegex(SolidPlanError, "coverage"):
            validate_plan(sources, altered)

    def test_independent_validation_detects_missing_bad_or_duplicate_seams(self):
        sources = [observed(box(0,0,12,10).difference(box(3,3,8,7)))]
        plan = propose_plans(sources)[0]
        changed = copy.deepcopy(plan)
        changed["splitGroups"][0]["seams"].pop()
        with self.assertRaisesRegex(SolidPlanError, "seam"):
            validate_plan(sources, changed)
        changed = copy.deepcopy(plan)
        changed["splitGroups"][0]["seams"][0]["lengthCanonical"] += 1
        with self.assertRaisesRegex(SolidPlanError, "length"):
            validate_plan(sources, changed)
        changed = copy.deepcopy(plan)
        changed["splitGroups"][0]["seams"][0]["polyline"] = LineString([(100,100),(110,100)])
        changed["splitGroups"][0]["seams"][0]["lengthCanonical"] = 10
        with self.assertRaisesRegex(SolidPlanError, "boundary"):
            validate_plan(sources, changed)

    def test_no_visible_piece_hidden_completion(self):
        sources = [observed(box(0,0,8,8).difference(box(2,2,6,6))), observed(box(2,2,6,6), "c2", "blue")]
        for plan in propose_plans(sources):
            for piece in plan["pieces"]:
                if piece["role"] == "VISIBLE":
                    original = next(s for s in sources if s["componentId"] == piece["sourceComponentIds"][0])
                    self.assertTrue(original["polygon"].covers(piece["polygon"]))

    def test_exact_geometry_cache_matches_fresh_checks_and_rejects_mutation(self):
        sources = [observed(box(0,0,12,12).difference(box(4,4,8,8))),
                   observed(box(4,4,8,8), "c2", "blue")]
        cache = {}
        plans = propose_plans(sources)
        for plan in plans:
            self.assertEqual(validate_plan(sources, plan),
                             validate_plan(sources, plan, geometry_cache=cache))
        self.assertTrue(cache)
        size = len(cache)
        validate_plan(sources, plans[0], geometry_cache=cache)
        self.assertEqual(len(cache), size)
        changed = copy.deepcopy(plans[0])
        # Same plan identity does not authorize a geometrically changed object.
        changed["pieces"][0]["polygon"] = translate(changed["pieces"][0]["polygon"], 1, 0)
        self.assertEqual(changed["id"], plans[0]["id"])
        with self.assertRaises(SolidPlanError):
            validate_plan(sources, changed, geometry_cache=cache)


if __name__ == "__main__":
    unittest.main()
