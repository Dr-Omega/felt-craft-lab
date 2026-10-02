import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

spec = importlib.util.spec_from_file_location('desktop_worker', Path(__file__).with_name('worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class HandoffTests(unittest.TestCase):
    def test_straight_rgb_not_multiplied_and_alpha_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = Image.new('RGBA', (4, 4), (220, 140, 35, 128))
            image.putpixel((0, 0), (255, 0, 190, 0))
            image.save(root / 'input.bin', format='PNG')
            before = (root / 'input.bin').read_bytes()
            worker.background(root, 'embedded-alpha', None)
            with Image.open(root / 'foreground.png') as actual:
                self.assertEqual(actual.getpixel((1, 1)), (220, 140, 35, 128))
                self.assertEqual(actual.getpixel((0, 0))[3], 0)
            self.assertEqual((root / 'input.bin').read_bytes(), before)
            self.assertEqual(json.loads((root / 'foreground-record.json').read_text())['model'], None)

    def test_opaque_input_not_silently_whole_foreground(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            Image.new('RGB', (5, 5), 'white').save(root / 'input.bin', format='PNG')
            with self.assertRaisesRegex(ValueError, 'no transparent foreground'):
                worker.background(root, 'embedded-alpha', None)
            self.assertFalse((root / 'foreground.png').exists())

    def test_empty_foreground_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            Image.new('RGBA', (5, 5), (23, 10, 40, 0)).save(root / 'input.bin', format='PNG')
            with self.assertRaisesRegex(ValueError, 'No foreground'):
                worker.background(root, 'embedded-alpha', None)


if __name__ == '__main__':
    unittest.main()
