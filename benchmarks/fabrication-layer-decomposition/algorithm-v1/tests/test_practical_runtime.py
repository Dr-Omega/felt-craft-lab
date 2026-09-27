"""Public opt-in integration, not mocked geometry/TypeScript acceptance."""
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
from m1_adapter import canonical_bytes
from m4_runtime import REPOSITORY_ROOT
from quality_binding import verify_quality_design


class PracticalRuntimeTests(unittest.TestCase):
    def test_direct_entry_actual_completion_and_rehashed_design_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rgba = np.zeros((96, 96, 4), np.uint8)
            rgba[8:88, 8:88] = [20, 20, 20, 255]
            rgba[16:80, 16:80] = [240, 190, 30, 255]
            source = root/'input.png'
            Image.fromarray(rgba).save(source)
            output = root/'result'
            report = run_algorithm(image_path=source, output_root=output,
                foreground_source='SYNTHETIC_VISIBLE_CONTROL', quality_mode='practical-auto')
            self.assertEqual(report['pieceCount'], 2)
            self.assertEqual(report['rerenderChecks']['mismatchPixelCount'], 0)
            self.assertEqual(report['practicalAutomaticSelection']['recommendedContract'],
                             'fabrication.layered-result/1')
            self.assertTrue((output/'practical-baseline.json').exists())
            self.assertTrue((output/'complete-pieces.svg').exists())
            self.assertTrue((output/'assembly-depth-02.png').exists())
            self.assertFalse(report['productionExportEligible'])
            # Rehash the descriptor everywhere. Real replay must still reject
            # the altered selection claim, not accept internally matching SHA.
            design_path = output/'m4/experimental-design.json'
            design = json.loads(design_path.read_text('utf-8'))
            design['selection']['reownedPixelCount'] += 1
            design_path.write_bytes(canonical_bytes(design))
            runtime_path = output/'m4/report.json'
            runtime = json.loads(runtime_path.read_text('utf-8'))
            sha = hashlib.sha256(design_path.read_bytes()).hexdigest()
            runtime['experimentalDesign']['sha256'] = sha
            runtime['configuration']['experimentalDesign']['sha256'] = sha
            runtime_path.write_bytes(canonical_bytes(runtime))
            with self.assertRaisesRegex(ValueError, 'selection mapping'):
                verify_quality_design(output/'m4')

    def test_automatic_mode_cannot_take_reference_answer_or_bypass_output_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root/'input.png'
            Image.fromarray(np.full((16, 16, 4), 255, np.uint8)).save(source)
            occupied = root/'occupied'
            occupied.mkdir()
            (occupied/'keep.txt').write_bytes(b'unchanged')
            for target in (occupied, root, REPOSITORY_ROOT/'benchmarks/background-removal/no-write-practical'):
                with self.assertRaises(ValueError):
                    run_algorithm(image_path=source, output_root=target,
                        foreground_source='CONTROL', quality_mode='practical-auto')
            self.assertEqual(list(occupied.iterdir()), [occupied/'keep.txt'])
            self.assertEqual((occupied/'keep.txt').read_bytes(), b'unchanged')
            with self.assertRaisesRegex(ValueError, 'reference answers'):
                run_algorithm(image_path=source, output_root=root/'no-answer',
                    foreground_source='CONTROL', quality_mode='practical-auto',
                    design_palette=[[255, 255, 255]], palette_provenance='test')
            self.assertFalse((root/'no-answer').exists())


if __name__ == '__main__':
    unittest.main()
