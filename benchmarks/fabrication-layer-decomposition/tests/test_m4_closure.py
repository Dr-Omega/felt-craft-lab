from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import m4_runtime as runtime
from m4_checks import validate_labels, candidate_polygons


class ClosureTests(unittest.TestCase):
    def rgba(self):
        a = np.zeros((20,20,4),np.uint8)
        a[2:18,2:18] = [220,20,40,255]
        a[7:13,7:13] = [20,60,230,255]
        a[1,2] = [220,20,40,20]
        return a

    def run_case(self, root, name='out'):
        source = root/'source.png'
        Image.fromarray(self.rgba()).save(source)
        return runtime.run_runtime(image_path=source,mode='embedded-alpha',mask_path=None,
            foreground_source='SYNTHETIC_DEVELOPMENT',manual_confirmation='PENDING_REVIEW',
            runtime_id='closure-case',profile='aggressive',output_root=root/name)

    def test_independent_alpha_gate_detects_missing_extra_and_bad_reference(self):
        rgba=self.rgba(); cfg,_=runtime.load_profile('aggressive')
        p=runtime.get_candidate('CP-B').propose(rgba,cfg)
        purified,meta=runtime.apply_representatives(rgba,p.structural_label_map,'RC-A',cfg,p.pixel_label_map)
        validate_labels(rgba,purified,p.structural_label_map,p.pixel_label_map,meta,cfg)
        for y,x,value in [(2,2,0),(0,0,1)]:
            labels=p.structural_label_map.copy(); labels[y,x]=value
            with self.assertRaisesRegex(ValueError,'coverage'):
                validate_labels(rgba,purified,labels,p.pixel_label_map,meta,cfg)
        wrong=copy.deepcopy(meta); wrong[0]['regionId']=999
        with self.assertRaisesRegex(ValueError,'references'):
            validate_labels(rgba,purified,p.structural_label_map,p.pixel_label_map,wrong,cfg)
        pixels=p.pixel_label_map.copy(); pixels[1,2]=-1
        with self.assertRaisesRegex(ValueError,'propagation'):
            validate_labels(rgba,purified,p.structural_label_map,pixels,meta,cfg)

    def test_inner_other_color_not_global_hole_and_preview_from_geometry(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); report=self.run_case(root)
            self.assertEqual(report['topology']['structuralVoids']['holeCount'],0)
            self.assertGreater(report['topology']['regionInnerRingCount'],0)
            self.assertNotEqual((root/'out/components.png').read_bytes(),(root/'out/observed-candidates.png').read_bytes())
            graph=json.loads((root/'out/boundary-graph.json').read_text())
            vector=json.loads((root/'out/vector-result.json').read_text())
            candidates=json.loads((root/'out/observed-candidates.json').read_text())
            for mutation in ('edge','direction','component','hole','edge-list','route'):
                damaged=copy.deepcopy(candidates)
                ring=damaged[0]['observedGeometry']['outerRing']
                if mutation=='edge': ring['edgeReferences'][0]['edgeId']='missing'
                if mutation=='direction': ring['edgeReferences'][0]['direction'] *= -1
                if mutation=='component': damaged[0]['sourceComponentId']='missing'
                if mutation=='hole': damaged[0]['observedGeometry']['innerRings']=[]
                if mutation=='edge-list': damaged[0]['observedGeometry']['edgeIds']=[]
                if mutation=='route': damaged[0]['vectorRoute']='WRONG_ROUTE'
                with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                    candidate_polygons(damaged,graph,vector,0.05)

    def test_plot_page_and_artifact_write_failures_never_leave_complete(self):
        for target in ('_save_png','_write_html'):
            with tempfile.TemporaryDirectory() as t, mock.patch.object(runtime,target,side_effect=OSError('injected write failure')):
                root=Path(t)
                with self.assertRaisesRegex(OSError,'injected'):
                    self.run_case(root)
                self.assertFalse((root/'out/report.json').exists())
                failure=json.loads((root/'out/failure.json').read_text())
                self.assertTrue(failure['downstreamStopped'])
                self.assertIn('injected',failure['error'])
                self.assertIn('selectedGeometryValidation', failure['completedStages'])
        with tempfile.TemporaryDirectory() as t, mock.patch.object(runtime.np,'savez_compressed',side_effect=OSError('disk full')):
            root=Path(t)
            with self.assertRaisesRegex(OSError,'disk full'): self.run_case(root)
            self.assertFalse((root/'out/report.json').exists())

    def test_decode_boundaries_and_label_array_types(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            source=root/'source.png'; Image.new('RGB',(20,20),'red').save(source)
            mask=root/'mask.png'; Image.new('L',(20,20),255).save(mask,format='TIFF')
            with self.assertRaisesRegex(ValueError,'single-frame PNG'):
                runtime.run_runtime(image_path=source,mode='external-mask',mask_path=mask,
                    foreground_source='DEV',manual_confirmation='PENDING_REVIEW',runtime_id='badmask',
                    profile='aggressive',output_root=root/'out')
            self.assertFalse((root/'out').exists())
            exif=Image.Exif(); exif[274]=6
            Image.new('RGBA',(20,20),'red').save(source,exif=exif)
            with self.assertRaisesRegex(ValueError,'EXIF orientation'):
                runtime.load_foreground(source,mode='embedded-alpha',mask_path=None,
                    foreground_source='DEV',manual_confirmation='PENDING_REVIEW',whole_image_foreground=True)
        rgba=self.rgba(); cfg,_=runtime.load_profile('aggressive')
        p=runtime.get_candidate('CP-B').propose(rgba,cfg)
        purified,meta=runtime.apply_representatives(rgba,p.structural_label_map,'RC-A',cfg,p.pixel_label_map)
        for structural in (p.structural_label_map.astype(np.int64), p.structural_label_map[:-1]):
            with self.assertRaisesRegex(ValueError,'dimensions/type'):
                validate_labels(rgba,purified,structural,p.pixel_label_map,meta,cfg)
        bad=purified.copy(); bad[2,2,3]=254
        with self.assertRaisesRegex(ValueError,'alpha changed'):
            validate_labels(rgba,bad,p.structural_label_map,p.pixel_label_map,meta,cfg)

    def test_snapshot_digest_and_decode_are_same_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            source=Path(t)/'input.png'; Image.fromarray(self.rgba()).save(source)
            original=source.read_bytes(); image_open=Image.open
            def open_then_change(*args,**kwargs):
                value=image_open(*args,**kwargs)
                source.write_bytes(b'changed after snapshot')
                return value
            with mock.patch.object(runtime.Image,'open',side_effect=open_then_change):
                foreground=runtime.load_foreground(source,mode='embedded-alpha',mask_path=None,
                    foreground_source='DEV',manual_confirmation='PENDING_REVIEW')
            self.assertEqual(foreground.source_bytes,original)
            self.assertEqual(foreground.provenance['sourceImage']['sha256'],hashlib.sha256(original).hexdigest())
            np.testing.assert_array_equal(foreground.rgba,self.rgba())

    def test_numeric_fit_failure_falls_back_but_contract_error_stops(self):
        with tempfile.TemporaryDirectory() as t, mock.patch.object(runtime,'fit_chain',side_effect=np.linalg.LinAlgError('fit singular')):
            root=Path(t); report=self.run_case(root)
            self.assertTrue(report['contracts']['vectorHardGate']['pass'])
            vector=json.loads((root/'out/vector-result.json').read_text())
            self.assertTrue(any(x.get('recoverableFitFailure') for x in vector['metrics']['cornerDiagnostics'].values()))
        with tempfile.TemporaryDirectory() as t, mock.patch.object(runtime,'fit_chain',side_effect=ValueError('invalid edge')):
            root=Path(t)
            with self.assertRaisesRegex(ValueError,'invalid edge'): self.run_case(root)
            self.assertFalse((root/'out/report.json').exists())

    def test_color_runner_cache_does_not_change_vector_adapter(self):
        for first in ('color','m4'):
            code=f"""import sys
sys.path.insert(0,{str(ROOT/'candidates/color-purification/src')!r})
sys.path.insert(0,{str(ROOT/'tools')!r})
if {first!r} == 'color': import runner
import m4_runtime
if {first!r} == 'm4':
    sys.path.insert(0,{str(ROOT/'candidates/color-purification/src')!r})
    import runner
assert 'color-purification' in runner.__file__
assert m4_runtime._result.__module__ == '_m4_frozen_vector_runner'
"""
            result=subprocess.run([sys.executable,'-c',code],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_stable_algorithm_identity_excludes_output_path_and_timing(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            a=self.run_case(root,'one'); b=self.run_case(root,'two')
            self.assertEqual(a['algorithmIdentity'],b['algorithmIdentity'])


if __name__=='__main__': unittest.main()
