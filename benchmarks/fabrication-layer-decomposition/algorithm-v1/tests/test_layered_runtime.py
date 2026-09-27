"""Actual opt-in public entry, source binding, persisted result and display."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from algorithm_runtime import run_algorithm
from m4_runtime import REPOSITORY_ROOT


def nested(count):
    # Keep each control colour above the frozen aggressive proposal's small
    # region scale; this test targets completion, not CP-B colour suppression.
    rgba=np.zeros((192,192,4),np.uint8)
    colors=[[195,20,30,255],[245,225,175,255],[30,110,210,255],[20,20,20,255]]
    for index in range(count):
        inset=12+index*22
        rgba[inset:192-inset,inset:192-inset]=colors[index]
    return rgba


class LayeredRuntimeTests(unittest.TestCase):
    def test_public_three_and_four_layers_actual_persisted_pipeline(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for count in (3,4):
                with self.subTest(count=count):
                    source=root/f'nested{count}.png'
                    Image.fromarray(nested(count)).save(source)
                    out=root/f'out{count}'
                    report=run_algorithm(image_path=source,output_root=out,
                        foreground_source='SYNTHETIC_VISIBLE_INPUT_NO_HIDDEN_GROUND_TRUTH',
                        completion_strategy='layered-v1')
                    self.assertEqual(report['pieceCount'],count)
                    self.assertEqual(report['layeredMetrics']['layerDepth'],count)
                    self.assertGreater(report['layeredMetrics']['hiddenAreaCanonical'],0)
                    self.assertEqual(report['rerenderChecks']['mismatchPixelCount'],0)
                    self.assertFalse(report['legacyB2ResultPassClaimed'])
                    self.assertFalse(report['productionExportEligible'])
                    self.assertTrue((out/f'assembly-depth-{count:02d}.png').exists())
                    self.assertTrue((out/'complete-pieces.svg').exists())
                    wire=json.loads((out/'fabrication-result.json').read_text('utf-8'))
                    self.assertEqual(wire['schemaVersion'],'fabrication.layered-result/1')
                    self.assertTrue(json.loads((out/'shared-validation.json').read_text('utf-8'))['ok'])

    def test_new_strategy_still_rejects_output_before_write(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            source=root/'image.png'
            Image.fromarray(nested(3)).save(source)
            occupied=root/'occupied'
            occupied.mkdir()
            (occupied/'keep.txt').write_bytes(b'unchanged')
            for output, expected in ((occupied,'absent or empty'),(root,'isolated'),
                    (REPOSITORY_ROOT/'benchmarks/background-removal/layered-must-not-write','protected')):
                with self.assertRaisesRegex(ValueError,expected):
                    run_algorithm(image_path=source,output_root=output,
                        foreground_source='SYNTHETIC',completion_strategy='layered-v1')
            self.assertEqual(list(occupied.iterdir()),[occupied/'keep.txt'])
            self.assertEqual((occupied/'keep.txt').read_bytes(),b'unchanged')
            invalid=root/'invalid'
            with self.assertRaisesRegex(ValueError,'invalid completion'):
                run_algorithm(image_path=source,output_root=invalid,
                    foreground_source='SYNTHETIC',completion_strategy='unknown')
            self.assertFalse(invalid.exists())


if __name__=='__main__':
    unittest.main()
