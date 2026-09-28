import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image
from shapely.geometry import box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from whole_silhouette import RULE, prepare_whole_base, support_record
from layered_completion import _group, _materialize
from layered_contract import build_layered_result, verify_layered_result, run_shared_layered_validation
from test_layered_contract import fixture
from test_monochrome_policy import source


def selected(observed, saved=None, color=None):
    prepared, decision = prepare_whole_base(observed, saved, color)
    return prepared['layeredCandidates'][decision['recommendedIndex']]


def stem():
    return [source(box(1, 4, 10, 11), 'fruit', 'light'),
            source(box(4, 1, 7, 4), 'stem', 'dark')]


class WholeSilhouetteTests(unittest.TestCase):
    def test_protrusion_is_supported_not_just_equal_final_render(self):
        observed = stem()
        plan = selected(observed, color='light')
        record = support_record(observed, plan, 'light')
        base = next(p for p in plan['pieces'] if p['id'] in record['basePieceIds'])
        self.assertTrue(base['polygon'].equals(unary_union([s['polygon'] for s in observed])))
        self.assertEqual(base['sourceComponentIds'], ['fruit'])
        self.assertEqual(record['representation'], 'SINGLE_BASE')
        self.assertEqual(record['hiddenAreaCanonical'], 9)

    def test_already_complete_keeps_all_actual_geometry(self):
        inp, old, observed = fixture(3)
        old['strategy'] = 'layered-completion/1'
        old['id'] = 'saved-fixture'
        plan = selected(observed, old)
        self.assertEqual({p['id']: p['polygon'].wkb for p in old['pieces']},
                         {p['id']: p['polygon'].wkb for p in plan['pieces']})
        self.assertEqual(plan['proposal']['wholeBaseAction'], 'REUSED_ALREADY_COMPLETE')

    def test_true_hole_stays_open_and_is_explicit_base_group(self):
        ring = box(0, 0, 12, 12).difference(box(4, 4, 8, 8))
        observed = [source(ring, 'ring', 'light')]
        plan = selected(observed, color='light')
        record = support_record(observed, plan, 'light')
        self.assertEqual(record['representation'], 'BASE_GROUP')
        self.assertGreater(len(record['basePieceIds']), 1)
        self.assertTrue(unary_union([p['polygon'] for p in plan['pieces']]).equals(ring))

    def test_disconnected_bodies_not_bridged_and_source_less_base_rejected(self):
        observed = [source(box(0, 0, 3, 3), 'one', 'light'), source(box(7, 0, 10, 3), 'two', 'light')]
        plan = selected(observed, color='light')
        self.assertEqual(len(plan['pieces']), 2)
        self.assertEqual(support_record(observed, plan, 'light')['representation'], 'BASE_GROUP')
        observed[1] = source(box(7, 0, 10, 3), 'two', 'dark')
        with self.assertRaisesRegex(ValueError, 'existing solid/visible-source contract'):
            selected(observed, color='light')

    def test_existing_color_required_and_wrong_color_order_or_hidden_rejected(self):
        observed = stem()
        with self.assertRaisesRegex(ValueError, 'does not exist'):
            selected(observed, color='invented')
        plan = selected(observed, color='light')
        for fault in ('color', 'order', 'hidden', 'extra'):
            bad = copy.deepcopy(plan)
            base = next(p for p in bad['pieces'] if p['id'] == bad['bottomToTop'][0])
            if fault == 'color': base['colorSlotId'] = 'dark'
            if fault == 'order': bad['bottomToTop'].reverse()
            if fault == 'hidden': base['hiddenPolygon'] = box(0, 0, 1, 1)
            if fault == 'extra': base['polygon'] = box(0, 0, 12, 12)
            with self.assertRaises(ValueError): support_record(observed, bad, 'light')

    def test_whole_backing_exempt_from_local_hidden_area_cap(self):
        observed = [source(box(0, 0, 1, 10), 'thin-base', 'light'),
                    source(box(1, 0, 10, 10), 'large-cover', 'dark')]
        record = support_record(observed, selected(observed, color='light'), 'light')
        self.assertEqual(record['hiddenAreaCanonical'], 90)

    def test_rehashed_missing_stem_support_rejected_despite_identical_render(self):
        inp, _, original = fixture(2)
        observed = [dict(original[0], polygon=box(0, 0, 6, 12)),
                    dict(original[1], polygon=box(6, 0, 12, 12))]
        plan = selected(observed, color='RGB-0')
        good = build_layered_result(inp, plan, observed)
        checked = verify_layered_result(good, observed, (12, 12), required_base_rule=True, requested_base_color='RGB-0')
        bad_plan = _materialize([_group(s) for s in observed], observed, 'x', 'missing-support')
        bad = build_layered_result(inp, bad_plan, observed)
        ordinary = verify_layered_result(bad, observed, (12, 12))
        np.testing.assert_array_equal(checked['rgba'], ordinary['rgba'])
        # Fully re-signed, including rewritten declarations, still cannot make
        # unsupported foreground pass the independent actual-domain rule.
        bad['payload']['recipe'] = copy.deepcopy(good['payload']['recipe'])
        bad['payload']['wholeSilhouetteBase'] = copy.deepcopy(good['payload']['wholeSilhouetteBase'])
        bad = run_shared_layered_validation(bad, sign_result=True)['signedResult']
        with self.assertRaises(ValueError): verify_layered_result(bad, observed, (12, 12))
        del bad['payload']['wholeSilhouetteBase']
        bad['payload']['recipe'] = {'id': 'bounded-piece-completion-order', 'version': '1'}
        bad = run_shared_layered_validation(bad, sign_result=True)['signedResult']
        with self.assertRaises(ValueError):
            verify_layered_result(bad, observed, (12, 12), required_base_rule=True, requested_base_color='RGB-0')

    def test_public_raw_saved_entries_and_no_write_protection(self):
        from algorithm_runtime import run_algorithm
        from monochrome_runtime import run_saved_design
        from whole_silhouette_runtime import run_saved_m4
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw = np.zeros((32, 32, 4), np.uint8)
            raw[12:28, 4:28] = [230, 120, 30, 255]
            raw[4:12, 13:19] = [30, 100, 40, 255]
            Image.fromarray(raw).save(root/'input.png')
            first = root/'first'
            report = run_algorithm(image_path=root/'input.png', output_root=first,
                foreground_source='SYNTHETIC_TEST', quality_mode='practical-auto', fabrication_policy=RULE)
            self.assertIn('wholeSilhouetteBase', report)
            second = root/'second'
            continued = run_saved_design(source_run=first, output_root=second, whole_silhouette=True)
            self.assertEqual(report['wholeSilhouetteBase']['supportDomain'], continued['wholeSilhouetteBase']['supportDomain'])
            self.assertEqual((first/'m4/structural_label_map.npz').read_bytes(), (second/'m4/structural_label_map.npz').read_bytes())
            self.assertTrue((second/'whole-base.png').exists())
            m4_only = root/'m4-only'
            continued_m4 = run_saved_m4(m4_root=first/'m4', output_root=m4_only)
            self.assertEqual(report['wholeSilhouetteBase']['supportDomain'], continued_m4['wholeSilhouetteBase']['supportDomain'])
            keep = root/'occupied'; keep.mkdir(); (keep/'keep.txt').write_bytes(b'unchanged')
            with self.assertRaises(ValueError): run_saved_design(source_run=first, output_root=keep, whole_silhouette=True)
            with self.assertRaises(ValueError): run_algorithm(image_path=root/'input.png', output_root=keep, foreground_source='TEST', quality_mode='practical-auto', fabrication_policy=RULE)
            with self.assertRaises(ValueError): run_saved_m4(m4_root=first/'m4', output_root=keep)
            self.assertEqual([p.name for p in keep.iterdir()], ['keep.txt'])
            self.assertEqual((keep/'keep.txt').read_bytes(), b'unchanged')


if __name__ == '__main__':
    unittest.main()
