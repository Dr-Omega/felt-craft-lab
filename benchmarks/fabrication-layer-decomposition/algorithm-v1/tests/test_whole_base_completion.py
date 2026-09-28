"""Whole support and useful intermediate completion are separate obligations."""
import sys
import json
import tempfile
import time
import unittest
from pathlib import Path

from shapely.geometry import box
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from whole_silhouette import prepare_whole_base, support_record
from monochrome_policy import cover_metrics
from test_monochrome_policy import pocket, source
from test_layered_contract import fixture


def choose(observed, color, saved=None):
    prepared, decision = prepare_whole_base(observed, saved, color)
    for candidate in prepared['layeredCandidates']:
        support_record(observed, candidate, color)
    return prepared['layeredCandidates'][decision['recommendedIndex']], prepared


class WholeBaseCompletionTests(unittest.TestCase):
    def test_new_design_has_real_middle_pocket_completion_without_saved_plan(self):
        observed = pocket()
        plan, prepared = choose(observed, 'light')
        self.assertEqual(len(plan['pieces']), 3)
        middle = next(p for p in plan['pieces'] if p['colorSlotId'] == 'middle')
        top = next(p for p in plan['pieces'] if p['colorSlotId'] == 'dark')
        self.assertTrue(middle['polygon'].covers(top['polygon']))
        self.assertTrue(middle['hiddenPolygon'].equals(top['polygon']))
        metrics = cover_metrics(observed, plan)
        self.assertEqual(metrics['differentColorButtJoinLengthCanonical'], 0)
        self.assertEqual(metrics['actualGeometricOverlapDepth'], 3)

    def test_new_three_and_four_color_nesting(self):
        for depth in (3, 4):
            _, _, observed = fixture(depth)
            plan, _ = choose(observed, 'RGB-0')
            self.assertEqual(len(plan['pieces']), depth)
            self.assertEqual(cover_metrics(observed, plan)['actualGeometricOverlapDepth'], depth)
            for i in range(depth):
                piece = next(p for p in plan['pieces'] if p['colorSlotId'] == f'RGB-{i}')
                self.assertTrue(piece['polygon'].equals(box(i, i, 12-i, 12-i)))

    def test_base_color_can_reappear_above_another_color(self):
        a, b, c = box(0, 0, 20, 20), box(3, 3, 17, 17), box(6, 6, 14, 14)
        observed = [source(a.difference(b), 'outer', 'light'),
                    source(b.difference(c), 'middle', 'dark'), source(c, 'inner', 'light')]
        plan, _ = choose(observed, 'light')
        metrics = cover_metrics(observed, plan)
        self.assertEqual(len(plan['pieces']), 3)
        self.assertEqual([step['colorSlotId'] for step in metrics['steps']], ['light', 'dark', 'light'])
        self.assertEqual(metrics['actualGeometricOverlapDepth'], 3)
        base = next(p for p in plan['pieces'] if p['id'] == plan['bottomToTop'][0])
        self.assertEqual(base['sourceComponentIds'], ['outer'])

    def test_expired_search_retains_only_a_whole_support_fallback(self):
        from practical_runtime import _prepare_and_search
        from whole_silhouette import RULE
        with tempfile.TemporaryDirectory() as folder:
            prepared, decision = _prepare_and_search(pocket(), Path(folder), time.perf_counter()-500,
                                                     RULE, base_color_slot='light')
            self.assertEqual(prepared['diagnostics']['supervisor']['status'],
                             'SKIPPED_NO_SEARCH_BUDGET_BASELINE_RETAINED')
            support_record(pocket(), prepared['layeredCandidates'][decision['recommendedIndex']], 'light')
            self.assertTrue((Path(folder)/'practical-baseline.json').exists())

    def test_three_public_entries_generate_middle_material_not_just_backing(self):
        from algorithm_runtime import run_algorithm
        from whole_silhouette_runtime import run_saved_m4
        from monochrome_runtime import run_saved_design
        from whole_silhouette import RULE
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rgba = np.zeros((96, 96, 4), np.uint8)
            rgba[4:92, 4:92] = [210, 190, 160, 255]
            rgba[16:80, 16:80] = [100, 100, 100, 255]
            rgba[32:64, 32:64] = [20, 20, 20, 255]
            Image.fromarray(rgba).save(root/'source.png')
            raw = root/'raw'
            first = run_algorithm(image_path=root/'source.png', output_root=raw,
                foreground_source='SYNTHETIC_REGRESSION', quality_mode='practical-auto', fabrication_policy=RULE)
            color = first['wholeSilhouetteBase']['selectedColorSlotId']
            reports = [first,
                run_saved_m4(m4_root=raw/'m4', output_root=root/'m4', base_color_slot=color),
                run_saved_design(source_run=raw, output_root=root/'saved', whole_silhouette=True, base_color_slot=color)]
            for report in reports:
                self.assertEqual(report['pieceCount'], 3)
                self.assertEqual(report['monochromeFabrication']['actualGeometricOverlapDepth'], 3)
                self.assertEqual(report['monochromeFabrication']['differentColorButtJoinLengthCanonical'], 0)
                self.assertEqual(report['rerenderChecks']['mismatchPixelCount'], 0)
            for directory in ('raw', 'm4', 'saved'):
                search = json.loads((root/directory/'practical-search.json').read_text('utf-8'))
                self.assertEqual(search['supervisor']['status'], 'RETURNED')
                self.assertLessEqual(search['wholeSilhouetteBase']['searchCandidatesAttempted'], 6)
                self.assertLessEqual(search['wholeSilhouetteBase']['pocketSearch']['attempted'], 6)


if __name__ == '__main__':
    unittest.main()
