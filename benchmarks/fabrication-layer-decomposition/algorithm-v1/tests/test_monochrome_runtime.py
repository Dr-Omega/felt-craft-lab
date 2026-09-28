import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from algorithm_runtime import run_algorithm
from layered_contract import run_shared_layered_validation, verify_layered_result
from m4_runtime import REPOSITORY_ROOT
from monochrome_policy import POLICY, prepare_saved_baseline, verify_cover_record
from monochrome_runtime import run_saved_design
from practical_plans import search_practical_candidates
from test_layered_contract import fixture


class MonochromeRuntimeTests(unittest.TestCase):
    def test_both_public_writers_enforce_output_protection_before_any_write(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            source=root/'source'
            source.mkdir()
            image=source/'input.png'
            Image.fromarray(np.full((16,16,4),255,np.uint8)).save(image)
            occupied=root/'occupied'
            occupied.mkdir()
            (occupied/'keep.txt').write_bytes(b'keep')
            for output in (occupied, root, REPOSITORY_ROOT/'benchmarks/background-removal/monochrome-forbidden'):
                with self.assertRaises(ValueError):
                    run_saved_design(source_run=source,output_root=output)
                with self.assertRaises(ValueError):
                    run_algorithm(image_path=image, output_root=output, foreground_source='CONTROL',
                                  quality_mode='practical-auto',fabrication_policy=POLICY)
            with self.assertRaises(ValueError):
                run_saved_design(source_run=source,output_root=source/'nested')
            self.assertEqual((occupied/'keep.txt').read_bytes(),b'keep')
            self.assertEqual([p.name for p in occupied.iterdir()],['keep.txt'])
            self.assertEqual([p.name for p in source.iterdir()],['input.png'])

    def test_raw_and_saved_public_entries_keep_selection_and_reject_rehashed_work_steps(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            rgba=np.zeros((64,64,4),np.uint8)
            rgba[4:60,4:60]=[30,30,30,255]
            rgba[12:52,12:52]=[210,150,20,255]
            source=root/'source.png'
            Image.fromarray(rgba).save(source)
            old=root/'old'
            run_algorithm(image_path=source,output_root=old,foreground_source='CONTROL',quality_mode='practical-auto')
            before={str(p.relative_to(old)):hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in old.rglob('*') if p.is_file()}
            raw=root/'raw'
            run_algorithm(image_path=source,output_root=raw,foreground_source='CONTROL',quality_mode='practical-auto',fabrication_policy=POLICY)
            saved=root/'saved'
            report=run_saved_design(source_run=old,output_root=saved)
            self.assertEqual(report['monochromeFabrication']['monochromeWorkLayerCount'],2)
            self.assertTrue((saved/'work-layer-02.png').exists())
            for name in ('structural_label_map.npz','pixel_label_map.npz','purified.png','component-binding.json','vector-result.json'):
                self.assertEqual((old/'m4'/name).read_bytes(),(saved/'m4'/name).read_bytes())
                self.assertEqual((old/'m4'/name).read_bytes(),(raw/'m4'/name).read_bytes())
            self.assertEqual(before,{str(p.relative_to(old)):hashlib.sha256(p.read_bytes()).hexdigest()
                                     for p in old.rglob('*') if p.is_file()})
            # A coherently rehashed policy artifact is not authority for order,
            # colour grouping, depth, or actual alignment metrics.
            wire=json.loads((saved/'fabrication-result.json').read_text())
            inp, synthetic, observed=fixture(3)
            from layered_contract import build_layered_result
            checked=verify_layered_result(build_layered_result(inp,synthetic,observed),observed,(12,12))
            from monochrome_policy import cover_metrics
            record=cover_metrics(observed,checked['plan'])
            for fault in ('actualGeometricOverlapDepth','steps','differentColorButtJoinLengthCanonical'):
                bad=copy.deepcopy(record)
                bad[fault]=list(reversed(bad[fault])) if fault=='steps' else 999
                for artifact in wire['payload']['input']['artifacts']:
                    if artifact['id']=='monochrome-policy.json':
                        artifact['sha256']=hashlib.sha256(json.dumps(bad).encode()).hexdigest()
                self.assertTrue(run_shared_layered_validation(wire,sign_result=True)['ok'])
                with self.assertRaises(ValueError):
                    verify_cover_record(observed,checked['plan'],bad)

    def test_saved_baseline_reuses_geometry_and_revalidates_false_source(self):
        inp,plan,observed=fixture(3)
        from layered_contract import build_layered_result
        actual=verify_layered_result(build_layered_result(inp,plan,observed),observed,(12,12))['plan']
        prepared=prepare_saved_baseline(observed,actual)
        self.assertEqual([p['polygon'].wkb for p in actual['pieces']],
                         [p['polygon'].wkb for p in prepared['baseline']['plan']['pieces']])
        self.assertIsNone(prepared['legacyFallback'])
        result=search_practical_candidates(observed,prepared)
        self.assertIn(prepared['baseline']['plan']['id'],[p['id'] for p in result['layeredCandidates']])
        actual['pieces'][0]['sourceComponentIds']=['wrong']
        with self.assertRaises(ValueError):
            prepare_saved_baseline(observed,actual)


if __name__=='__main__':
    unittest.main()
