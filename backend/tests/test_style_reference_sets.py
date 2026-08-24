from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.style_reference_sets import (  # noqa: E402
    REFERENCE_ASSETS_ROOT,
    StyleReferenceSetError,
    _contained_file,
    get_style_reference_set,
    resolve_reference_images,
)


class StyleReferenceSetTests(unittest.TestCase):
    def test_fixed_set_has_exactly_eight_pngs(self):
        ref_set = get_style_reference_set("felt-style-ref-v1")
        self.assertEqual(ref_set.filenames, tuple(f"{i:02d}.png" for i in range(1, 9)))
        images = resolve_reference_images(ref_set.reference_set_id)
        self.assertEqual(len(images), 8)
        self.assertTrue(all(image.startswith("data:image/png;base64,") for image in images))

    def test_unknown_set_fails_closed(self):
        with self.assertRaises(StyleReferenceSetError):
            resolve_reference_images("other-set")

    def test_path_escape_is_rejected(self):
        root = REFERENCE_ASSETS_ROOT / "felt-style-ref-v1"
        with self.assertRaises(StyleReferenceSetError):
            _contained_file(root, "../01.png")


if __name__ == "__main__":
    unittest.main()
