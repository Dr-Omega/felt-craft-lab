"""Cross-contract recommendation controls, without rewriting either contract.

These tests deliberately simulate failure of the optional legacy-to-layered
adapter. A genuinely validated new proposal must still be eligible for selection.
"""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from shapely.geometry import box

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),
               str(Path(__file__).resolve().parents[2] / 'tools')]
import practical_plans as practical
from layered_completion import LayeredPlanError, validate_layered_plan
from solid_plans import rank_plans, validate_plan


def source(polygon, component, color):
    return {'polygon': polygon, 'componentId': component,
            'regionId': 'region-'+color, 'colorSlotId': color,
            'rgb': {'red': [210, 30, 30], 'pale': [250, 240, 205], 'black': [8, 8, 8]}[color],
            'boundaryProvenance': {'selectedVectorArtifactId': 'synthetic', 'edgeIds': [component]}}


def nested_sources():
    outer, middle, top = box(0, 0, 20, 20), box(2, 2, 18, 18), box(5, 5, 15, 15)
    return [source(outer.difference(middle), 'outer', 'red'),
            source(middle.difference(top), 'middle', 'pale'), source(top, 'top', 'black')]


class PracticalCrossContractTests(unittest.TestCase):
    def unconverted_search(self, sources):
        with patch.object(practical, '_convert_legacy',
                          side_effect=LayeredPlanError('optional adapter rejected its actual construction')):
            return practical.propose_practical_plans(sources)

    def test_valid_three_layer_improvement_survives_optional_baseline_conversion_failure(self):
        sources = nested_sources()
        result = self.unconverted_search(sources)
        self.assertEqual(result['baseline']['contract'], 'LEGACY_SOLID_PLAN')
        old = rank_plans(sources, [result['baseline']['plan']])[0]
        self.assertGreater(old['score']['visibleSeamLengthCanonical'], 0)
        decision = practical.recommend_practical_plan(sources, result)
        self.assertEqual(decision['recommendedContract'], 'fabrication.layered-result/1')
        self.assertIsInstance(decision['recommendedIndex'], int)
        selected = result['layeredCandidates'][decision['recommendedIndex']]
        validate_layered_plan(sources, selected)
        self.assertEqual(selected['score']['visibleSeamLengthCanonical'], 0)
        self.assertEqual(selected['score']['pieceCount'], 3)
        self.assertEqual(selected['score']['layerDepth'], 3)
        # The successful new proposal did not rewrite the fallback's contract.
        self.assertEqual(result['baseline']['contract'], 'LEGACY_SOLID_PLAN')
        validate_plan(sources, result['baseline']['plan'])

    def test_equal_physical_metrics_keep_original_contract_without_claiming_conversion(self):
        sources = [source(box(0, 0, 20, 20), 'solid', 'red')]
        result = self.unconverted_search(sources)
        self.assertTrue(result['layeredCandidates'])
        decision = practical.recommend_practical_plan(sources, result)
        self.assertIsNone(decision['recommendedIndex'])
        self.assertEqual(decision['recommendedContract'], 'LEGACY_SOLID_PLAN')
        self.assertEqual(decision['recommendedPlanId'], result['baseline']['plan']['id'])
        self.assertFalse(decision['newCompletionBenefitClaimed'])

    def test_forged_legacy_score_cannot_veto_proven_new_improvement(self):
        sources = nested_sources()
        result = self.unconverted_search(sources)
        result['baseline']['plan']['score'] = {
            'visibleSeamLengthCanonical': -9999, 'pieceCount': 0, 'decisionCost': -9999}
        decision = practical.recommend_practical_plan(sources, result)
        self.assertEqual(decision['recommendedContract'], 'fabrication.layered-result/1')

    def test_invalid_new_candidate_not_accepted_even_with_rehashed_identity(self):
        sources = nested_sources()
        result = self.unconverted_search(sources)
        result['layeredCandidates'][0]['pieces'][0]['sourceComponentIds'] = ['not-a-source']
        result['layeredCandidates'][0]['id'] = 'rehashed-but-invalid'
        result['layeredCandidates'][0]['geometryChecks'] = {'all': 'PASS'}
        with self.assertRaises(ValueError):
            practical.recommend_practical_plan(sources, result)


if __name__ == '__main__':
    unittest.main()
