"""Media descriptors must agree with actual binary NPZ transport."""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from m1_adapter import artifact


class ArtifactMediaTests(unittest.TestCase):
    def test_npz_default_and_explicit_override(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'structural_label_map.npz'
            np.savez_compressed(path, labels=np.zeros((3, 3), np.int32))
            inferred = artifact(path)
            self.assertEqual(inferred['mediaType'], 'application/x-npz')
            self.assertEqual(inferred, artifact(path, media_type='application/x-npz'))
            self.assertEqual(inferred['byteLength'], path.stat().st_size)
            self.assertEqual(artifact(path, media_type='application/octet-stream')['mediaType'],
                             'application/octet-stream')


if __name__ == '__main__':
    unittest.main()
