"""Exact broad-phase parity and warm-cache declaration/geometry independence."""
import copy
import random
import unittest

from shapely.affinity import translate
from shapely.geometry import box

from solid_plans import _AreaIndex, _intersects_area, validate_plan, SolidPlanError, _score
from test_seam_completeness import nested
from solid_plans import propose_plans


class EquivalentPerformanceTests(unittest.TestCase):
    def test_index_matches_brute_force_including_duplicate_and_touching_geometries(self):
        rng = random.Random(418)
        polygons = [box(0, 0, 1, 1), box(0, 0, 1, 1), box(1, 1, 2, 2),
                    box(1, 0, 2, 1), box(0, 0, 1e-6, 1e-6)]
        for _ in range(80):
            x, y = rng.uniform(-5, 5), rng.uniform(-5, 5)
            polygons.append(box(x, y, x+rng.random(), y+rng.random()))
        items = [{'id': i, 'polygon': p} for i, p in enumerate(polygons)]
        index = _AreaIndex(items, {})
        for p in polygons:
            expected = [x['id'] for x in items if _intersects_area(x['polygon'], p)]
            self.assertEqual([x['id'] for x in index.touching(p)], expected)

    def test_index_does_not_confuse_hole_envelope_with_positive_area(self):
        ring = box(0,0,10,10).difference(box(2,2,8,8))
        index = _AreaIndex([{'id':'ring', 'polygon':ring}], {})
        self.assertEqual(index.touching(box(3,3,7,7)), [])
        self.assertEqual(index.touching(box(2,2,8,8)), [])
        self.assertEqual(len(index.touching(box(1,1,3,3))), 1)

    def test_predicate_cache_keys_both_full_geometries_not_ids(self):
        cache = {}
        a, b = box(0,0,2,2), box(1,1,3,3)
        self.assertTrue(_intersects_area(a,b,cache))
        self.assertFalse(_intersects_area(a,translate(b,10,0),cache))
        self.assertFalse(_intersects_area(translate(a,10,0),b,cache))
        self.assertTrue(_intersects_area(a,b,cache))
        ring = box(0,0,10,10).difference(box(2,2,8,8))
        filled = box(0,0,10,10)
        query = box(3,3,7,7)
        self.assertEqual(_AreaIndex([{'id':'same','polygon':ring}],cache).touching(query), [])
        self.assertEqual(len(_AreaIndex([{'id':'same','polygon':filled}],cache).touching(query)),1)
        self.assertEqual(_AreaIndex([{'id':'same','polygon':ring}],cache).touching(query), [])
        # Same envelope, different operand interiors must not collide, either.
        index = _AreaIndex([{'id':'inside','polygon':query}],cache)
        self.assertEqual(index.touching(ring), [])
        self.assertEqual(len(index.touching(filled)),1)

    def test_warm_cache_rechecks_source_color_provenance_and_group_claims(self):
        observed = nested(); plan = propose_plans(observed)[0]; cache = {}
        expected = validate_plan(observed,plan,geometry_cache=cache)
        self.assertEqual(expected,validate_plan(observed,plan,geometry_cache=cache))
        self.assertTrue(any(k[0]=='positive-area-intersection' for k in cache))
        mutations = [lambda p:p['pieces'][0].update(colorSlotId='unknown'),
                     lambda p:p['pieces'][0].update(sourceComponentIds=['missing']),
                     lambda p:p['splitGroups'][0]['pieceIds'].pop(),
                     lambda p:p['splitGroups'][0]['seams'].pop()]
        for mutate in mutations:
            bad=copy.deepcopy(plan);mutate(bad)
            with self.assertRaises(SolidPlanError):_score(bad,observed,geometry_cache=cache)
        bad_sources=copy.deepcopy(observed);bad_sources[0]['boundaryProvenance']=None
        with self.assertRaises(SolidPlanError):validate_plan(bad_sources,plan,geometry_cache=cache)
        bad_sources=copy.deepcopy(observed);bad_sources[0]['polygon']=translate(bad_sources[0]['polygon'],1,0)
        with self.assertRaises(SolidPlanError):validate_plan(bad_sources,plan,geometry_cache=cache)

    def test_empty_index_is_empty(self):
        self.assertEqual(_AreaIndex([],{}).touching(box(0,0,1,1)),[])


if __name__ == '__main__':unittest.main()
