import copy
from pathlib import Path
import sys
import unittest

from shapely.geometry import box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from layered_completion import _group, _materialize, validate_layered_plan
from practical_plans import prepare_practical_baseline, PracticalPlanBudget
from monochrome_policy import (augment_cover_candidates, recommend_cover_plan,
    monochrome_schedule, verify_monochrome_schedule, cover_metrics)


def source(geom, name, color):
    return {'polygon': geom, 'componentId': name, 'regionId': 'R-'+color,
            'colorSlotId': color, 'rgb': {'light': [200, 200, 200],
            'middle': [100, 100, 100], 'dark': [20, 20, 20]}[color],
            'boundaryProvenance': {'edgeIds': [name]}}


def pocket():
    base, face, pool = box(0, 0, 30, 30), box(4, 4, 26, 26), box(10, 4, 20, 13)
    return [source(base.difference(face), 'a', 'light'),
            source(face.difference(pool), 'b', 'middle'), source(pool, 'c', 'dark')]


def search(sources):
    return prepare_practical_baseline(sources, budget=PracticalPlanBudget(0))


class MonochromePolicyTests(unittest.TestCase):
    def test_grouping_alone_changes_steps_not_physical_material(self):
        sources = pocket()
        plan = search(sources)['baseline']['plan']
        before = [p['polygon'].wkb for p in plan['pieces']]
        result = monochrome_schedule(sources, plan)
        self.assertEqual(result['monochromeWorkLayerCount'], 3)
        self.assertEqual(result['actualGeometricOverlapDepth'], 2)
        self.assertFalse(result['workStepSplittingAddsMaterial'])
        self.assertEqual(before, [p['polygon'].wkb for p in plan['pieces']])

    def test_real_supported_pocket_closure_adds_middle_material_and_reduces_butt_join(self):
        sources = pocket()
        prepared = search(sources)
        result = augment_cover_candidates(sources, prepared)
        decision = recommend_cover_plan(sources, result)
        plan = result['layeredCandidates'][decision['recommendedIndex']]
        medium = next(p for p in plan['pieces'] if p['colorSlotId'] == 'middle')
        dark = next(p for p in plan['pieces'] if p['colorSlotId'] == 'dark')
        self.assertTrue(medium['polygon'].covers(dark['polygon']))
        self.assertTrue(medium['hiddenPolygon'].equals(dark['polygon']))
        metrics = cover_metrics(sources, plan)
        self.assertEqual(metrics['actualGeometricOverlapDepth'], 3)
        self.assertEqual(metrics['monochromeWorkLayerCount'], 3)
        self.assertEqual(metrics['differentColorButtJoinLengthCanonical'], 0)
        self.assertGreater(cover_metrics(sources, prepared['baseline']['plan'])['differentColorButtJoinLengthCanonical'], 0)
        self.assertEqual(len(plan['pieces']), 3)
        validate_layered_plan(sources, plan)

    def test_disconnected_same_color_ready_pieces_share_step_without_bridging(self):
        sources = [source(box(0,0,4,4), 'a', 'light'), source(box(8,0,12,4), 'b', 'light')]
        plan = _materialize([_group(s) for s in sources], sources, 'x', 'test')
        schedule = monochrome_schedule(sources, plan)
        self.assertEqual(len(schedule['steps']), 1)
        self.assertEqual(len(schedule['steps'][0]['pieceIds']), 2)
        self.assertEqual(schedule['actualGeometricOverlapDepth'], 1)
        self.assertTrue(unary_union([p['polygon'] for p in plan['pieces']]).equals(unary_union([s['polygon'] for s in sources])))

    def test_same_color_can_recur_after_occluding_other_color(self):
        a,b,c = box(0,0,20,20), box(3,3,17,17), box(6,6,14,14)
        sources = [source(a.difference(b), 'a', 'light'), source(b.difference(c), 'b', 'dark'),
                   source(c, 'c', 'light')]
        groups = [dict(_group(s), full=f, evidence=[{'method':'test-supported-cover',
                  'inferredHiddenGeometry': True}]) for s,f in zip(sources,[a,b,c])]
        plan = _materialize(groups, sources, 'x', 'test')
        result = monochrome_schedule(sources,plan)
        self.assertEqual([s['colorSlotId'] for s in result['steps']], ['light','dark','light'])
        self.assertEqual(result['actualGeometricOverlapDepth'],3)

    def test_dependency_chain_is_not_maximum_coincident_material_depth(self):
        full = [box(0,0,6,4), box(4,0,10,4), box(8,0,14,4)]
        sources = [source(f.difference(unary_union(full[i+1:])), str(i), color)
                   for i,(f,color) in enumerate(zip(full,['light','middle','dark']))]
        groups = [dict(_group(s), full=f, evidence=[{'method':'test-supported-cover',
                  'inferredHiddenGeometry': True}]) for s,f in zip(sources,full)]
        plan = _materialize(groups,sources,'x','test')
        result = monochrome_schedule(sources,plan)
        self.assertEqual(result['occlusionDependencyDepth'],3)
        self.assertEqual(result['actualGeometricOverlapDepth'],2)

    def test_true_hole_and_separate_decoration_are_never_filled_or_connected(self):
        sources = [source(box(0,0,20,20).difference(box(5,5,15,15)), 'ring', 'light'),
                   source(box(24,2,28,6), 'detail', 'dark')]
        result = augment_cover_candidates(sources, search(sources))
        expected = unary_union([s['polygon'] for s in sources])
        for plan in result['layeredCandidates']:
            validate_layered_plan(sources,plan)
            self.assertTrue(unary_union([p['polygon'] for p in plan['pieces']]).equals(expected))

    def test_side_by_side_rectangles_not_turned_into_blanket_support(self):
        sources = [source(box(0,0,10,10),'a','light'),source(box(10,0,20,10),'b','dark')]
        result = augment_cover_candidates(sources, search(sources))
        self.assertEqual(result['diagnostics']['coverPriority']['attempted'],0)

    def test_reordered_same_color_global_batch_and_forged_depth_rejected(self):
        sources = pocket()
        result = augment_cover_candidates(sources,search(sources))
        d = recommend_cover_plan(sources,result)
        plan = result['layeredCandidates'][d['recommendedIndex']]
        actual = monochrome_schedule(sources,plan)
        for field in ('steps','actualGeometricOverlapDepth','monochromeWorkLayerCount'):
            bad = copy.deepcopy(actual)
            bad[field] = list(reversed(bad[field])) if field=='steps' else 999
            with self.assertRaises(ValueError):
                verify_monochrome_schedule(sources,plan,bad)

    def test_forged_pass_source_or_hidden_geometry_never_reused(self):
        sources = pocket()
        for fault in ('source','hidden'):
            prepared = search(sources)
            plan = prepared['layeredCandidates'][0]
            if fault=='source':
                plan['pieces'][0]['sourceComponentIds']=['wrong']
            else:
                plan['pieces'][0]['hiddenPolygon']=box(-5,-5,-1,-1)
            plan['geometryChecks']={'all':'PASS'}
            with self.assertRaises(ValueError):
                augment_cover_candidates(sources,prepared)

    def test_saved_score_never_decides_and_input_order_is_invariant(self):
        sources=pocket()
        a=augment_cover_candidates(sources,search(sources))
        b=augment_cover_candidates(list(reversed(sources)),search(list(reversed(sources))))
        for plan in b['layeredCandidates']:
            plan['score']={'layerDepth':1,'pieceCount':0}
        self.assertEqual(recommend_cover_plan(sources,a)['recommendedPlanId'],
                         recommend_cover_plan(sources,b)['recommendedPlanId'])


if __name__ == '__main__':
    unittest.main()
