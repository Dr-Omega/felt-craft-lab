import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from shapely.geometry import box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import practical_plans as practical
from layered_completion import LayeredPlanError, validate_layered_plan, _group, _materialize
from solid_plans import SolidPlanError


def source(polygon, component, color):
    return {'polygon': polygon, 'componentId': component, 'regionId': 'r-'+color,
            'colorSlotId': color, 'rgb': {'red': [200, 10, 10], 'pale': [240, 230, 210],
                'black': [10, 10, 10]}[color],
            'boundaryProvenance': {'selectedVectorArtifactId': 'test-vector', 'edgeIds': [component]}}


def nested():
    a, b, c = box(0, 0, 20, 20), box(2, 2, 18, 18), box(5, 5, 15, 15)
    return [source(a.difference(b), 'a', 'red'), source(b.difference(c), 'b', 'pale'),
            source(c, 'c', 'black')]


class PracticalPlanTests(unittest.TestCase):
    def test_baseline_verified_before_search_and_all_distinct_candidates_retained(self):
        result = practical.propose_practical_plans(nested())
        diagnostics = result['diagnostics']
        self.assertTrue(diagnostics['baselineValidatedBeforeSearch'])
        stages = [x['stage'] for x in diagnostics['trials']]
        self.assertLess(stages.index('BASELINE_CONVERT_AND_VALIDATE'), stages.index('SEARCH_GROUP_CONSTRUCTION'))
        self.assertEqual(diagnostics['searchCandidatesAttempted'], 6)
        self.assertEqual(len(result['layeredCandidates']), len({p['id'] for p in result['layeredCandidates']}))
        self.assertIn(result['baseline']['plan']['id'], [p['id'] for p in result['layeredCandidates']])
        for plan in result['layeredCandidates']:
            validate_layered_plan(nested(), plan)

    def test_all_search_errors_preserve_legal_fallback_and_traceback(self):
        with patch.object(practical, '_filled_groups', side_effect=RuntimeError('hole-failed')), \
             patch.object(practical, '_joined_groups', side_effect=RuntimeError('bridge-failed')):
            result = practical.propose_practical_plans(nested())
        practical.validate_practical_fallback(nested(), result['baseline'])
        rejected = [x for x in result['diagnostics']['trials'] if x['status'] == 'REJECTED']
        self.assertEqual(len(rejected), 3)
        self.assertTrue(all(x['stage'] == 'SEARCH_GROUP_CONSTRUCTION' for x in rejected))
        self.assertTrue(all(x['traceback'] and x['exceptionType'] == 'RuntimeError' for x in rejected))
        self.assertEqual(result['diagnostics']['fallbackReason'], 'NO_DISTINCT_VALID_SEARCH_CANDIDATE')

    def test_conversion_failure_is_explicit_original_contract_not_new_pass(self):
        with patch.object(practical, '_convert_legacy', side_effect=LayeredPlanError('cannot convert')), \
             patch.object(practical, '_filled_groups', side_effect=RuntimeError('fail')), \
             patch.object(practical, '_joined_groups', side_effect=RuntimeError('fail')):
            result = practical.propose_practical_plans(nested())
        self.assertEqual(result['baseline']['contract'], 'LEGACY_SOLID_PLAN')
        self.assertEqual(result['layeredCandidates'], [])
        self.assertEqual(result['diagnostics']['fallbackReason'], 'NO_LAYERED_CONVERSION_OR_CANDIDATE')
        practical.validate_practical_fallback(nested(), result['baseline'])

    def test_legacy_search_failure_can_use_actual_observed_solid_baseline(self):
        sources = [source(box(0, 0, 10, 10), 'one', 'red')]
        with patch.object(practical, 'propose_plans', side_effect=SolidPlanError('legacy failed')):
            result = practical.propose_practical_plans(sources, budget=practical.PracticalPlanBudget(0))
        self.assertIsNone(result['legacyFallback'])
        self.assertEqual(result['baseline']['contract'], 'fabrication.layered-result/1')
        practical.validate_practical_fallback(sources, result['baseline'])

    def test_no_legal_fallback_fails_with_full_diagnostics_before_search(self):
        with patch.object(practical, 'propose_plans', side_effect=SolidPlanError('legacy rejected')), \
             patch.object(practical, '_materialize', side_effect=LayeredPlanError('invalid partition')), \
             patch.object(practical, '_filled_groups') as search:
            with self.assertRaises(practical.PracticalPlanError) as raised:
                practical.propose_practical_plans(nested())
        self.assertEqual(len(raised.exception.diagnostics['trials']), 3)
        self.assertTrue(all(t['status'] == 'REJECTED' for t in raised.exception.diagnostics['trials']))
        self.assertFalse(raised.exception.diagnostics['baselineValidatedBeforeSearch'])
        search.assert_not_called()

    def test_candidate_budget_is_deterministic_and_zero_does_not_start_search(self):
        for limit in (0, 1, 3, 6):
            with self.subTest(limit=limit):
                result = practical.propose_practical_plans(nested(), budget=practical.PracticalPlanBudget(limit))
                self.assertEqual(result['diagnostics']['searchCandidatesAttempted'], limit)
                self.assertEqual(result['diagnostics']['searchDeadlineSeconds'], 420)
                self.assertEqual(result['diagnostics']['wallTimeEnforcement'], 'SUPERVISING_RUNTIME_REQUIRED')
        with patch.object(practical, '_filled_groups') as fill, patch.object(practical, '_joined_groups') as join:
            practical.propose_practical_plans(nested(), budget=practical.PracticalPlanBudget(0))
        fill.assert_not_called()
        join.assert_not_called()

    def test_input_order_does_not_change_identity_or_candidate_collection(self):
        a = practical.propose_practical_plans(nested())
        b = practical.propose_practical_plans(list(reversed(nested())))
        self.assertEqual(a['diagnostics']['sourceIdentity'], b['diagnostics']['sourceIdentity'])
        self.assertEqual([p['id'] for p in a['layeredCandidates']], [p['id'] for p in b['layeredCandidates']])

    def test_another_design_cannot_reuse_fallback(self):
        result = practical.propose_practical_plans(nested())
        changed = nested()
        changed[-1]['polygon'] = box(5, 5, 14, 15)
        with self.assertRaises(ValueError):
            practical.validate_practical_fallback(changed, result['baseline'])

    def test_rehashed_false_source_and_cached_pass_cannot_skip_validation(self):
        result = practical.propose_practical_plans(nested())
        bad = copy.deepcopy(result['baseline'])
        bad['plan']['pieces'][0]['sourceComponentIds'] = ['wrong']
        bad['plan']['id'] = 'recomputed-hash'
        bad['plan']['geometryChecks'] = {'all': 'PASS'}
        bad['plan']['score'] = {'decisionCost': -1000}
        with self.assertRaises(ValueError):
            practical.validate_practical_fallback(nested(), bad)

    def test_legacy_fallback_also_revalidates_full_actual_geometry(self):
        result = practical.propose_practical_plans(nested())
        bad = copy.deepcopy(result['legacyFallback'])
        bad['pieces'][0]['polygon'] = box(-100, -100, 100, 100)
        bad['geometryChecks'] = {'all': 'PASS'}
        with self.assertRaises(ValueError):
            practical.validate_practical_fallback(nested(), {'contract': 'LEGACY_SOLID_PLAN', 'plan': bad})

    def test_real_hole_and_disconnected_same_color_never_gain_material(self):
        ring = box(0, 0, 10, 10).difference(box(3, 3, 7, 7))
        sources = [source(ring, 'ring', 'red'), source(box(15, 0, 18, 3), 'decoration', 'red')]
        expected = unary_union([s['polygon'] for s in sources])
        result = practical.propose_practical_plans(sources)
        for plan in result['layeredCandidates']:
            actual = unary_union([p['polygon'] for p in plan['pieces']])
            self.assertTrue(actual.equals(expected))
            self.assertTrue(all(not p['polygon'].interiors for p in plan['pieces']))

    def test_missing_invalid_source_and_unknown_contract_rejected(self):
        with self.assertRaises(practical.PracticalPlanError) as raised:
            practical.propose_practical_plans([])
        self.assertEqual(raised.exception.diagnostics['trials'][0]['stage'], 'SOURCE_VALIDATION')
        with self.assertRaises(practical.PracticalPlanError):
            practical.validate_practical_fallback(nested(), {'contract': 'PASS'})

    def test_budget_type_and_reserve_checked(self):
        for count in (True, -1, 7, 1.5):
            with self.assertRaises(ValueError):
                practical.PracticalPlanBudget(count)
        with self.assertRaises(ValueError):
            practical.PracticalPlanBudget(total_seconds=10, final_validation_reserve_seconds=10)
        with self.assertRaises(TypeError):
            practical.propose_practical_plans(nested(), budget={'verified': True})

    def test_two_stage_checkpoint_retained_and_matches_uninterrupted_candidates(self):
        prepared = practical.prepare_practical_baseline(nested())
        before = copy.deepcopy(prepared['diagnostics'])
        result = practical.search_practical_candidates(nested(), prepared)
        direct = practical.propose_practical_plans(nested())
        self.assertEqual(before, prepared['diagnostics'])
        self.assertEqual({p['id'] for p in result['layeredCandidates']},
                         {p['id'] for p in direct['layeredCandidates']})
        practical.validate_practical_fallback(nested(), prepared['baseline'])
        with self.assertRaisesRegex(practical.PracticalPlanError, 'already searched'):
            practical.search_practical_candidates(nested(), result)

    def test_checkpoint_rehashed_wrong_mapping_rejected_not_trusted(self):
        prepared = practical.prepare_practical_baseline(nested())
        bad = copy.deepcopy(prepared)
        bad['baseline']['plan']['pieces'][0]['sourceRegionIds'] = ['wrong-region']
        bad['baseline']['plan']['id'] = 'rehashed'
        bad['baseline']['plan']['geometryChecks'] = {'sourceBinding': 'PASS'}
        bad['diagnostics']['baselineValidatedBeforeSearch'] = True
        with self.assertRaises(ValueError):
            practical.search_practical_candidates(nested(), bad)
        other = nested()
        other[-1]['boundaryProvenance']['edgeIds'] = ['different-edge']
        with self.assertRaisesRegex(practical.PracticalPlanError, 'another observed design'):
            practical.search_practical_candidates(other, prepared)

    def test_checkpoint_scores_recomputed_and_omitted_baseline_rejected(self):
        prepared = practical.prepare_practical_baseline(nested())
        prepared['layeredCandidates'][0]['score'] = {'decisionCost': -999}
        result = practical.search_practical_candidates(nested(), prepared)
        self.assertTrue(all(p['score']['decisionCost'] > 0 for p in result['layeredCandidates']))
        prepared['layeredCandidates'] = []
        with self.assertRaisesRegex(practical.PracticalPlanError, 'omitted'):
            practical.search_practical_candidates(nested(), prepared)

    def test_actual_baseline_validation_failure_does_not_discard_later_legal_choice(self):
        choices = practical.propose_plans(nested(), reject_invalid_options=True, clip_numeric_parts=True)
        bad = copy.deepcopy(choices[0])
        bad['pieces'][0]['polygon'] = box(-100, -100, 100, 100)
        with patch.object(practical, 'propose_plans', return_value=[bad, choices[0]]):
            prepared = practical.prepare_practical_baseline(nested())
        trials = [t for t in prepared['diagnostics']['trials'] if t['stage'] == 'BASELINE_ACTUAL_VALIDATION']
        self.assertEqual([t['status'] for t in trials], ['REJECTED', 'VALID'])
        practical.validate_practical_fallback(nested(), prepared['baseline'])

    def test_search_stderr_preserved_as_json_text(self):
        error = RuntimeError('worker failed')
        error.stderr = b'worker stderr\xff'
        with patch.object(practical, '_filled_groups', side_effect=error):
            result = practical.propose_practical_plans(nested())
        rejected = next(t for t in result['diagnostics']['trials'] if t['status'] == 'REJECTED')
        self.assertIn('worker stderr', rejected['stderr'])
        json.dumps(result['diagnostics'])

    def test_recommendation_retains_all_candidates_and_recomputes_tampered_scores(self):
        result = practical.propose_practical_plans(nested())
        original_ids = [p['id'] for p in result['layeredCandidates']]
        for plan in result['layeredCandidates']:
            plan['score'] = {'decisionCost': -999, 'pieceCount': 0}
        decision = practical.recommend_practical_plan(nested(), result)
        self.assertEqual([p['id'] for p in result['layeredCandidates']], original_ids)
        self.assertEqual(decision['candidateCountPreserved'], len(original_ids))
        self.assertTrue(all(c['actualMetrics']['pieceCount'] > 0 for c in decision['candidates']))
        self.assertEqual(decision['recommendedPlanId'], original_ids[decision['recommendedIndex']])
        json.dumps(decision)

    def test_same_risk_tier_does_not_exchange_zero_cut_for_original_cost_claim(self):
        sources = nested()
        prepared = practical.prepare_practical_baseline(sources)
        zero = _materialize(practical._filled_groups(sources, unary_union([s['polygon'] for s in sources])),
                            sources, 'x', 'supported-hole-completion')
        prepared['baseline'] = {'contract': 'fabrication.layered-result/1', 'plan': zero}
        prepared['layeredCandidates'] = [zero]
        cut = _materialize([_group(s) for s in sources], sources, 'x', 'observed-solid-partition')
        cut['score'] = {'decisionCost': -9999, 'pieceCount': 0}
        prepared['layeredCandidates'].append(cut)
        decision = practical.recommend_practical_plan(sources, prepared)
        cut_basis = next(c for c in decision['candidates'] if c['planId'] == cut['id'])
        self.assertGreater(cut_basis['actualMetrics']['visibleSeamLengthCanonical'], 0)
        self.assertEqual(decision['recommendedPlanId'], zero['id'])
        self.assertFalse(decision['newCompletionBenefitClaimed'])

    def test_long_narrow_piece_above_micro_area_is_measured_but_not_deleted(self):
        sources = [source(box(0, 0, 40, 1), 'intentional-line', 'black')]
        result = practical.propose_practical_plans(sources)
        decision = practical.recommend_practical_plan(sources, result)
        risk = decision['candidates'][decision['recommendedIndex']]['fragmentRisk']
        self.assertEqual(risk['microPieceCountAreaLe4'], 0)
        self.assertEqual(risk['longNarrowPieceCount'], 1)
        self.assertEqual(decision['candidates'][0]['actualMetrics']['pieceCount'], 1)
        self.assertTrue(decision['riskDefinition']['intentionalSmallDetailsMayAlsoBeFlagged'])

    def test_recommendation_refuses_forged_geometry_and_missing_baseline(self):
        result = practical.propose_practical_plans(nested())
        result['layeredCandidates'] = []
        with self.assertRaisesRegex(practical.PracticalPlanError, 'omitted'):
            practical.recommend_practical_plan(nested(), result)
        result = practical.propose_practical_plans(nested())
        result['layeredCandidates'][0]['pieces'][0]['sourceComponentIds'] = ['wrong']
        with self.assertRaises(ValueError):
            practical.recommend_practical_plan(nested(), result)

    def test_recommendation_keeps_explicit_original_contract_when_conversion_failed(self):
        with patch.object(practical, '_convert_legacy', side_effect=LayeredPlanError('cannot convert')):
            result = practical.propose_practical_plans(nested(),
                budget=practical.PracticalPlanBudget(max_search_candidates=0))
        decision = practical.recommend_practical_plan(nested(), result)
        self.assertIsNone(decision['recommendedIndex'])
        self.assertEqual(decision['recommendedContract'], 'LEGACY_SOLID_PLAN')
        self.assertFalse(decision['newCompletionBenefitClaimed'])

    def test_zero_cut_is_not_a_mechanical_veto_over_recorded_fragment_risk_tier(self):
        islands = [box(2*i, 0, 2*i+1, 1) for i in range(6)]
        foreground = box(-10, -10, 22, 11)
        sources = [source(foreground.difference(unary_union(islands)), 'support', 'black')]
        sources += [source(shape, 'detail-'+str(i), 'pale') for i, shape in enumerate(islands)]
        result = practical.prepare_practical_baseline(sources)
        group = {'sources': sources[1:], 'visible': unary_union(islands),
                 'full': unary_union(islands).convex_hull,
                 'evidence': [{'method': 'test-supported-local-bridge', 'inferredHiddenGeometry': True}]}
        candidate = _materialize([_group(sources[0]), group], sources, 'x', 'test-supported-bridge')
        result['layeredCandidates'].append(candidate)
        decision = practical.recommend_practical_plan(sources, result)
        old, new = decision['candidates']
        self.assertEqual(old['actualMetrics']['visibleSeamLengthCanonical'], 0)
        self.assertGreater(new['actualMetrics']['visibleSeamLengthCanonical'], 0)
        self.assertLess(new['fragmentRisk']['riskTier'], old['fragmentRisk']['riskTier'])
        self.assertEqual(decision['recommendedIndex'], 1)
        self.assertEqual(decision['proxyStatus'], 'EXPERIMENTAL_NOT_HUMAN_ACCEPTANCE')


if __name__ == '__main__':
    unittest.main()
