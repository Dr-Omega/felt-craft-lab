"""Independent parent reconstruction, reusable gates and genuinely rehashed wire."""
import copy
import unittest

from shapely.affinity import translate
from shapely.geometry import box, LineString, mapping
from shapely.ops import unary_union

from test_rerender import source, serialize, rehash
from m1_adapter import run_shared_validation
from relations import assembly_relations, RelationError
from result_wire import build_result, ResultWireError
from rerender import verify_and_render, RerenderError
from solid_plans import propose_plans, validate_plan, _score, _group_seams, rank_plans, SolidPlanError


def omitted(plan, role=None):
    changed = copy.deepcopy(plan)
    removed = {g['id'] for g in changed['splitGroups'] if role is None or
               next(p for p in changed['pieces'] if p['id'] == g['pieceIds'][0])['role'] == role}
    changed['splitGroups'] = [g for g in changed['splitGroups'] if g['id'] not in removed]
    for piece in changed['pieces']:
        if piece['splitGroupId'] in removed:
            piece['splitGroupId'] = None
    return changed


def nested():
    # Both Base and visible parents contain the same global void; some physical
    # seams coincide in projection, but still have different roles and sides.
    return [source(box(0, 0, 12, 10).difference(box(2, 2, 10, 8))),
            source(box(2, 2, 10, 8).difference(box(3, 3, 8, 7)), 'c2', 'blue')]


def four_member_bodies():
    """Legal partitions independent of the X/Y generator: two full Base bodies."""
    ring = box(0, 0, 12, 10).difference(box(3, 3, 8, 7))
    observed = [source(ring), source(translate(ring, xoff=16), 'c2', region='r-c1')]
    plan = {'id': 'opaque-id', 'pieces': [], 'baseExposures': [], 'splitGroups': [], 'baseChoices': []}
    cells = [box(0, 0, 3, 10), box(3, 0, 12, 3), box(8, 3, 12, 10), box(3, 7, 8, 10)]
    for body_index, src in enumerate(observed):
        group_id = f'g{body_index}'
        members = []
        for index, cell in enumerate(cells):
            piece = {'id': f'arbitrary-{body_index}-{index}', 'role': 'BASE', 'colorSlotId': 'red',
                     'sourceRegionIds': [src['regionId']], 'sourceComponentIds': [src['componentId']],
                     'polygon': translate(cell, xoff=body_index*16), 'splitGroupId': group_id}
            members.append(piece)
            plan['baseExposures'].append({'basePieceId': piece['id'], 'sourceRegionId': src['regionId'],
                                         'sourceComponentId': src['componentId'], 'polygon': piece['polygon']})
        plan['pieces'].extend(members)
        plan['splitGroups'].append({'id': group_id, 'pieceIds': [p['id'] for p in members],
            'sourceRegionIds': [src['regionId']], 'sourceComponentIds': [src['componentId']],
            'sourcePolygon': src['polygon'], 'seams': _group_seams(members, group_id)})
    plan['geometryChecks'] = validate_plan(observed, plan)
    return observed, plan


def fake_subgroups(plan):
    bad = copy.deepcopy(plan)
    original = bad['splitGroups'].pop(0)
    for index, ids in enumerate((original['pieceIds'][:2], original['pieceIds'][2:])):
        gid = f'fake-{index}'
        members = [p for p in bad['pieces'] if p['id'] in ids]
        for piece in members:
            piece['splitGroupId'] = gid
        bad['splitGroups'].append({**original, 'id': gid, 'pieceIds': ids,
            'sourcePolygon': unary_union([p['polygon'] for p in members]), 'seams': _group_seams(members, gid)})
    return bad


class SeamCompletenessTests(unittest.TestCase):
    def test_all_groups_omission_rejected_with_unchanged_geometry_and_cached_pass(self):
        observed = nested()
        for plan in propose_plans(observed):
            bad = omitted(plan)
            self.assertEqual([p['polygon'].wkb for p in bad['pieces']], [p['polygon'].wkb for p in plan['pieces']])
            self.assertEqual(bad['geometryChecks'], plan['geometryChecks'])
            with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup.*BASE/body-1'):
                validate_plan(observed, bad)

    def test_base_only_group_omission_rejected(self):
        observed = nested()
        plan = propose_plans(observed)[0]
        with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup.*BASE/body-1'):
            validate_plan(observed, omitted(plan, 'BASE'))

    def test_visible_only_group_omission_rejected(self):
        observed = nested()
        plan = propose_plans(observed)[0]
        self.assertTrue(any(p['role'] == 'VISIBLE' and p['splitGroupId'] for p in plan['pieces']))
        with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup.*VISIBLE/c'):
            validate_plan(observed, omitted(plan, 'VISIBLE'))

    def test_legal_multigroup_then_locally_consistent_two_member_fake_subgroups(self):
        observed, plan = four_member_bodies()
        self.assertEqual(len(plan['splitGroups']), 2)
        self.assertEqual(validate_plan(observed, plan)['splitDeclarationCompleteness'], 'PASS')
        bad = fake_subgroups(plan)
        for group in bad['splitGroups']:
            self.assertGreaterEqual(len(group['pieceIds']), 2)
            members = [p for p in bad['pieces'] if p['id'] in group['pieceIds']]
            self.assertTrue(unary_union([p['polygon'] for p in members]).equals(group['sourcePolygon']))
            self.assertGreater(len(group['seams']), 0)
            self.assertEqual(len(group['seams']), len(_group_seams(members, group['id'])))
        self.assertLess(sum(len(g['seams']) for g in bad['splitGroups']), sum(len(g['seams']) for g in plan['splitGroups']))
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*complete actual parent Pieces'):
            validate_plan(observed, bad)

    def test_false_parent_source_and_member_declarations(self):
        observed, plan = four_member_bodies()
        bad = copy.deepcopy(plan)
        bad['splitGroups'][0]['sourcePolygon'] = bad['pieces'][0]['polygon']
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*false source parent'):
            validate_plan(observed, bad)
        bad = copy.deepcopy(plan)
        bad['splitGroups'][0]['sourceComponentIds'] = ['c2']
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*source Component mismatch'):
            validate_plan(observed, bad)
        bad = copy.deepcopy(plan)
        bad['pieces'][0]['sourceComponentIds'] = ['c2']  # same Region/color, different actual Component
        with self.assertRaisesRegex(SolidPlanError, 'Piece arbitrary-0-0.*actual source Components'):
            validate_plan(observed, bad)
        bad = copy.deepcopy(plan)
        bad['splitGroups'][0]['pieceIds'].pop()
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*complete actual parent Pieces'):
            validate_plan(observed, bad)

    def test_seam_omission_duplicate_wrong_endpoint_geometry_and_length(self):
        observed, plan = four_member_bodies()
        mutations = [
            (lambda g: g['seams'].pop(), 'missing or duplicate seam'),
            (lambda g: g['seams'].append(copy.deepcopy(g['seams'][0])), 'missing or duplicate seam'),
            (lambda g: g['seams'][0].update(pieceIds=[g['pieceIds'][0]]*2), 'seam .* endpoints'),
            (lambda g: g['seams'][0].update(polyline=translate(g['seams'][0]['polyline'], xoff=0.1)), 'actual shared cut boundary'),
            (lambda g: g['seams'][0].update(lengthCanonical=g['seams'][0]['lengthCanonical']+1), 'seam .* length measurement'),
        ]
        for mutate, message in mutations:
            with self.subTest(reason=message):
                bad = copy.deepcopy(plan)
                mutate(bad['splitGroups'][0])
                with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*'+message):
                    validate_plan(observed, bad)

    def test_scoring_and_ranking_revalidate_instead_of_trusting_zero_or_cached_score(self):
        observed = nested()
        plans = propose_plans(observed)
        original = [(p['id'], p['score']) for p in plans]
        changed = copy.deepcopy(plans)
        for p in changed:
            p['score'] = {'totalSeamLengthCanonical': 0}
            p['rankingKey'] = [-999]
        self.assertEqual([(p['id'], p['score']) for p in rank_plans(observed, list(reversed(changed)))], original)
        bad = omitted(plans[0])
        for score in (lambda: _score(bad, observed), lambda: rank_plans(observed, [bad])):
            with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup'):
                score()

    def test_warm_geometry_cache_does_not_cache_metadata_verdict(self):
        observed = nested()
        plan = propose_plans(observed)[0]
        cache = {}
        validate_plan(observed, plan, geometry_cache=cache)
        _score(plan, observed, geometry_cache=cache)
        assembly_relations(observed, plan, {'records': [], 'evidence': []}, geometry_cache=cache)
        self.assertTrue(cache)
        bad = omitted(plan)
        self.assertEqual(bad['id'], plan['id'])
        with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup'):
            validate_plan(observed, bad, geometry_cache=cache)
        with self.assertRaisesRegex(SolidPlanError, 'missing actual parent SplitGroup'):
            _score(bad, observed, geometry_cache=cache)
        with self.assertRaisesRegex(RelationError, 'missing actual parent SplitGroup'):
            assembly_relations(observed, bad, {'records': [], 'evidence': []}, geometry_cache=cache)
        bad = copy.deepcopy(plan)
        bad['splitGroups'][0]['seams'].pop()
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*missing or duplicate seam'):
            _score(bad, observed, geometry_cache=cache)

    def test_result_builder_requires_actual_observed_parent_validation(self):
        observed = nested()
        plan = propose_plans(observed)[0]
        result, doc = serialize(plan, observed)
        artifacts = {a['id']: a for a in result['payload']['input']['artifacts']}
        bad = omitted(plan)
        with self.assertRaisesRegex(ResultWireError, 'Actual parent/seam.*missing actual parent SplitGroup'):
            build_result(result['payload']['input'], bad, result['payload']['relations'],
                         artifacts['fabrication-geometry.json'], artifacts['relation-evidence.json'], observed=observed)

    def test_legally_rehashed_wire_all_base_visible_omissions_fail_semantics(self):
        observed = nested()
        plan = propose_plans(observed)[0]
        for role in (None, 'BASE', 'VISIBLE'):
            result, doc = serialize(plan, observed)
            payload = result['payload']
            omitted_ids = {g['id'] for g in omitted(plan, role)['splitGroups']}
            removed = [g for g in payload['splitGroups'] if g['id'] not in omitted_ids]
            payload['splitGroups'] = [g for g in payload['splitGroups'] if g['id'] in omitted_ids]
            for p in payload['pieces']:
                if p['splitGroupId'] not in omitted_ids:
                    p['splitGroupId'] = None
            for g in removed:
                del doc['objects']['source:'+g['id']]
                for s in g['seams']:
                    del doc['objects'][s['id']]
            rehash(result, doc)
            self.assertTrue(run_shared_validation(result=result)['ok'])
            with self.assertRaisesRegex(RerenderError, 'independent geometric/relation.*missing actual parent SplitGroup'):
                verify_and_render(result, doc, observed, (16, 16))

    def test_legally_rehashed_wire_fake_subgroups_reject_cross_group_omission(self):
        observed, plan = four_member_bodies()
        result, doc = serialize(plan, observed, size=32)
        bad = fake_subgroups(plan)
        template = result['payload']['splitGroups'][0]
        wire_groups = []
        for group in bad['splitGroups']:
            wire = {**template, 'id': group['id'], 'pieceIds': group['pieceIds'], 'seams': []}
            doc['objects']['source:'+group['id']] = mapping(group['sourcePolygon'])
            for seam in group['seams']:
                wire['seams'].append({'id': seam['id'], 'pieceIds': seam['pieceIds'],
                    'lengthCanonical': seam['lengthCanonical'], 'measurementEvidenceId': 'relation-evidence.json',
                    'geometry': {'artifactId': 'fabrication-geometry.json', 'objectId': seam['id'], 'frameId': 'canonical'}})
                doc['objects'][seam['id']] = mapping(seam['polyline'])
            wire_groups.append(wire)
        result['payload']['splitGroups'] = wire_groups
        for wire in result['payload']['pieces']:
            wire['splitGroupId'] = next(p['splitGroupId'] for p in bad['pieces'] if p['id'] == wire['id'])
        rehash(result, doc)
        self.assertTrue(run_shared_validation(result=result)['ok'])
        with self.assertRaisesRegex(RerenderError, 'BASE/body-1.*complete actual parent Pieces'):
            verify_and_render(result, doc, observed, (32, 32))

    def test_original_x_y_lengths_remain_six_and_seven(self):
        observed = [source(box(0, 0, 12, 10).difference(box(3, 3, 8, 7)))]
        plans = propose_plans(observed)
        self.assertEqual({p['baseChoices'][0]['splitAxis']: p['score']['totalSeamLengthCanonical'] for p in plans}, {'x': 6.0, 'y': 7.0})

    def test_duplicate_topological_seam_with_extra_collinear_vertex_is_rejected(self):
        observed = [source(box(0,0,12,10).difference(box(3,3,8,7)))]
        plan = propose_plans(observed)[0]
        seams = plan['splitGroups'][0]['seams']
        first = seams[0]
        a, b = first['polyline'].coords[0], first['polyline'].coords[-1]
        duplicate = LineString([a, ((a[0]+b[0])/2, (a[1]+b[1])/2), b])
        seams[1].update(polyline=duplicate, lengthCanonical=duplicate.length, pieceIds=first['pieceIds'])
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*duplicates an actual physical seam'):
            validate_plan(observed, plan)

    def test_positive_tiny_piece_and_short_seam_are_not_filtered(self):
        observed = [source(box(0,0,1,1))]
        plan = propose_plans(observed)[0]
        original = plan['pieces'][0]
        small = box(0,0,1e-6,1e-6)
        members = [{**original, 'id': 'tiny', 'polygon': small, 'splitGroupId': 'tiny-split'},
                   {**original, 'id': 'rest', 'polygon': original['polygon'].difference(small), 'splitGroupId': 'tiny-split'}]
        plan['pieces'] = members
        plan['baseExposures'] = [{'sourceRegionId': 'r-c1', 'sourceComponentId': 'c1',
                                  'basePieceId': p['id'], 'polygon': p['polygon']} for p in members]
        plan['splitGroups'] = [{'id': 'tiny-split', 'pieceIds': ['tiny','rest'], 'sourceRegionIds': ['r-c1'],
                                'sourceComponentIds': ['c1'], 'sourcePolygon': observed[0]['polygon'],
                                'seams': _group_seams(members, 'tiny-split')}]
        score = _score(plan, observed)
        self.assertGreater(score['totalSeamLengthCanonical'], 0)
        self.assertAlmostEqual(score['totalSeamLengthCanonical'], 2e-6)
        with self.assertRaisesRegex(SolidPlanError, 'BASE/body-1.*tiny'):
            validate_plan(observed, omitted(plan))

    def test_disconnected_same_region_same_color_and_point_contact_are_not_splits(self):
        observed = [source(box(0,0,2,2)), source(box(2,2,4,4), 'c2', region='r-c1'), source(box(8,0,9,1), 'c3', region='r-c1')]
        for plan in propose_plans(observed):
            self.assertEqual(plan['splitGroups'], [])
            self.assertEqual(_score(plan, observed)['totalSeamLengthCanonical'], 0)
            self.assertEqual(len(validate_plan(observed, plan)['actualParents']), 3)

    def test_samecolor_visible_components_in_one_region_remain_separate_parents(self):
        observed = [source(box(0,0,8,8).difference(unary_union([box(1,1,2,2), box(5,5,6,6)]))),
                    source(box(1,1,2,2), 'c2', 'blue', 'blue-region'), source(box(5,5,6,6), 'c3', 'blue', 'blue-region')]
        plan = next(p for p in propose_plans(observed) if p['baseChoices'][0]['colorSlotId'] == 'red')
        self.assertEqual(plan['splitGroups'], [])
        self.assertEqual(len([p for p in validate_plan(observed, plan)['actualParents'] if p['role'] == 'VISIBLE']), 2)

    def test_original_color_boundary_and_base_visible_support_are_not_seams(self):
        observed = [source(box(0,0,4,4)), source(box(4,0,8,4), 'c2', 'blue')]
        for plan in propose_plans(observed):
            self.assertEqual(_score(plan, observed)['physicalSeamRecordCount'], 0)
            self.assertEqual(plan['splitGroups'], [])
            result, doc = serialize(plan, observed)
            self.assertEqual(verify_and_render(result, doc, observed, (16,16))['mismatchPixelCount'], 0)

    def test_coincident_layer_seams_preserve_physical_records_and_projected_metric(self):
        observed = nested()
        plan = next(p for p in propose_plans(observed) if p['baseChoices'][0]['colorSlotId'] == 'red'
                    and p['baseChoices'][0]['splitAxis'] == 'x')
        groups = plan['splitGroups']
        score = _score(plan, observed)
        self.assertEqual(score['physicalSeamRecordCount'], sum(len(g['seams']) for g in groups))
        physical_length = sum(s['lengthCanonical'] for g in groups for s in g['seams'])
        self.assertGreater(physical_length, score['totalSeamLengthCanonical'])
        self.assertEqual(sum(p['physicalSeamRecordCount'] for p in validate_plan(observed, plan)['actualParents']), score['physicalSeamRecordCount'])


if __name__ == '__main__':
    unittest.main()
