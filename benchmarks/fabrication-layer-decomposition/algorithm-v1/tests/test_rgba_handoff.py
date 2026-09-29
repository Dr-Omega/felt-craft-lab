from io import BytesIO
from pathlib import Path
import hashlib
import json
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT.parent/'tools')]
from rgba_handoff import prepare, verify_persisted, ARTIFACTS
from algorithm_runtime import run_algorithm


def png(array):
    stream=BytesIO(); Image.fromarray(array).save(stream,format='PNG')
    return stream.getvalue()


class RgbaHandoffTests(unittest.TestCase):
    def test_semtransparent_straight_rgb_roundtrip_and_composite(self):
        rgb=np.array([[[200,100,40],[20,150,210],[70,80,90],[1,2,3]]],np.uint8)
        alpha=np.array([[128,254,255,0]],np.uint8)
        data,record=prepare(png(rgb),png(alpha))
        rgba=np.array(Image.open(BytesIO(data)))
        np.testing.assert_array_equal(rgba[...,:3],rgb)
        np.testing.assert_array_equal(rgba[...,3],alpha)
        again,_=prepare(data,png(alpha))
        self.assertEqual(data,again)
        composite=np.array(Image.alpha_composite(Image.new('RGBA',(4,1),(0,0,0,255)),Image.fromarray(rgba)))
        np.testing.assert_array_equal(composite[...,:3],(rgb.astype(np.uint16)*alpha[...,None]+127)//255)
        self.assertFalse(record['backgroundColorDecontamination'])

    def test_rehashed_double_attenuation_rejected(self):
        rgb=np.full((4,4,3),150,np.uint8);alpha=np.full((4,4),128,np.uint8)
        source,mask=png(rgb),png(alpha);derived,record=prepare(source,mask)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'m4').mkdir()
            for name,data in zip(ARTIFACTS,(source,mask,derived)):(root/name).write_bytes(data)
            (root/'m4/source-snapshot.png').write_bytes(derived)
            self.assertEqual(verify_persisted(root,record)['status'],'PASS')
            altered=np.array(Image.open(BytesIO(derived)));altered[...,:3]//=2
            false=png(altered)
            (root/ARTIFACTS[2]).write_bytes(false);(root/'m4/source-snapshot.png').write_bytes(false)
            record['sha256'][ARTIFACTS[2]]=hashlib.sha256(false).hexdigest()
            with self.assertRaisesRegex(ValueError,'independently decoded'):
                verify_persisted(root,record)

    def test_frame_and_mask_encoding_reject(self):
        with self.assertRaisesRegex(ValueError,'frame'):
            prepare(png(np.zeros((2,2,3),np.uint8)),png(np.zeros((3,2),np.uint8)))
        with self.assertRaisesRegex(ValueError,'8-bit L'):
            prepare(png(np.zeros((2,2,3),np.uint8)),png(np.zeros((2,2,3),np.uint8)))

    def test_public_entry_guarded_and_actual_handoff_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'original.png';mask=root/'alpha.png'
            rgb=np.full((40,40,3),220,np.uint8);rgb[8:32,8:32]=[200,90,40]
            rgb[13:23,16:25]=[70,140,40]
            alpha=np.zeros((40,40),np.uint8);alpha[8:32,8:32]=255;alpha[8,8:32]=128
            source.write_bytes(png(rgb));mask.write_bytes(png(alpha))
            out=root/'run';out.mkdir();(out/'keep.txt').write_bytes(b'unchanged')
            args=dict(image_path=source,saved_alpha_path=mask,foreground_source='synthetic test',quality_mode='practical-auto',fabrication_policy='whole-silhouette-base/1')
            with self.assertRaises(Exception):run_algorithm(output_root=out,**args)
            self.assertEqual(list(out.iterdir()),[out/'keep.txt'])
            with self.assertRaises(Exception):run_algorithm(output_root=root,**args)
            result=run_algorithm(output_root=root/'clean',**args)
            recipe=json.loads((root/'clean/algorithm-recipe.json').read_text('utf-8'))
            self.assertEqual(verify_persisted(root/'clean',recipe['experimentalQuality']['rgbaHandoff'])['status'],'PASS')
            self.assertIn('INDEPENDENT_PERSISTED_FULL_PIECE_ASSEMBLY',result['completedStages'])


if __name__ == '__main__': unittest.main()
