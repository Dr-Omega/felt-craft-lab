"""Real M4-M7 entry, persistent replay, provenance and isolation regressions."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from algorithm_runtime import run_algorithm
from m1_adapter import canonical_bytes
from quality_binding import verify_quality_design
from m4_runtime import REPOSITORY_ROOT

class DesignPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.addClassCleanup(cls.temp.cleanup)
        cls.root=Path(cls.temp.name);cls.source=cls.root/'input.png'
        rgba=np.full((32,40,4),[255,255,255,0],np.uint8)
        rgba[5:28,5:35]=[8,8,8,255];rgba[9:24,9:31]=[230,190,20,255]
        rgba[3,20]=[220,220,220,255]
        Image.fromarray(rgba).save(cls.source);cls.source_bytes=cls.source.read_bytes()
        cls.runs={}
        for mode,clean,reference in [('design-colors',False,False),('design-colors',True,False),('design-cleanup',True,False),('design-colors',True,True)]:
            key=f'{mode}-{clean}-{reference}';out=cls.root/key
            options={'design_palette':[[8,8,8],[230,190,20]],'palette_provenance':'declared synthetic construction'} if reference else {}
            cls.runs[key]=(out,run_algorithm(image_path=cls.source,output_root=out,foreground_source='SYNTHETIC_CONTROL',quality_mode=mode,foreground_cleanup=clean,**options))
    def clone(self,suffix):
        source=self.runs['design-colors-True-False'][0]/'m4';out=self.root/('tamper-'+suffix)
        shutil.copytree(source,out);return out
    def rehash(self,out,record):
        (out/'experimental-design.json').write_bytes(canonical_bytes(record))
        report=json.loads((out/'report.json').read_text('utf-8'))
        for name in report['artifactSha256']: report['artifactSha256'][name]=hashlib.sha256((out/name).read_bytes()).hexdigest()
        digest=hashlib.sha256((out/'experimental-design.json').read_bytes()).hexdigest()
        report['experimentalDesign']['sha256']=digest;report['configuration']['experimentalDesign']['sha256']=digest
        (out/'report.json').write_bytes(canonical_bytes(report))
    def test_all_modes_reach_real_pieces_and_independent_shared_validation(self):
        self.assertEqual(self.source.read_bytes(),self.source_bytes)
        for key,(out,report) in self.runs.items():
            self.assertEqual(verify_quality_design(out/'m4')['status'],'PASS')
            self.assertEqual(report['rerenderChecks']['mismatchPixelCount'],0)
            self.assertEqual(report['rerenderChecks']['renderBackStatus'],'PASS')
            self.assertTrue(json.loads((out/'shared-validation.json').read_text())['ok'])
            self.assertFalse(report['productionExportEligible'])
        self.assertEqual(self.runs['design-colors-True-False'][1]['pieceCount'],2)
    def test_rehashed_palette_provenance_or_assignment_lie_rejected(self):
        out=self.clone('palette');record=json.loads((out/'experimental-design.json').read_text())
        record['selection']['paletteProposal'][0]['rgb']=[110,100,90];self.rehash(out,record)
        with self.assertRaises(ValueError): verify_quality_design(out)
    def test_rehashed_change_map_cannot_hide_cleanup(self):
        out=self.clone('change');record=json.loads((out/'experimental-design.json').read_text())
        with np.load(out/'design-change-maps.npz') as a: labels=a['labels_changed'].copy();alpha=a['alpha_changed'].copy()
        alpha[:]=False;np.savez_compressed(out/'design-change-maps.npz',alpha_changed=alpha,labels_changed=labels)
        self.rehash(out,record)
        with self.assertRaisesRegex(ValueError,'change map'): verify_quality_design(out)
    def test_direct_api_protection_and_reference_validation_before_write(self):
        out=self.root/'occupied';out.mkdir();(out/'keep.txt').write_bytes(b'keep')
        protected=REPOSITORY_ROOT/'benchmarks/background-removal/design-test-must-not-exist'
        for target in (out,self.root,protected):
            with self.assertRaises(ValueError): run_algorithm(image_path=self.source,output_root=target,foreground_source='SYNTHETIC',quality_mode='design-colors')
        self.assertEqual(list(p.name for p in out.iterdir()),['keep.txt'])
        self.assertEqual((out/'keep.txt').read_bytes(),b'keep');self.assertFalse(protected.exists())
        target=self.root/'invalid-reference'
        with self.assertRaises(ValueError): run_algorithm(image_path=self.source,output_root=target,foreground_source='SYNTHETIC',quality_mode='design-colors',design_palette=[[1,2,3]])
        self.assertFalse(target.exists())
