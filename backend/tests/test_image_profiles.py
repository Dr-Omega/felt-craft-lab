from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.image_profiles import UnknownGenerationProfile, resolve_generation_profile  # noqa: E402
from services.image_service import compose_positive_prompt  # noqa: E402


class ImageProfileTests(unittest.TestCase):
    def test_core_pattern_resolves_seedream_45_profile(self):
        with mock.patch.dict(os.environ, {"SEEDREAM_MODEL_ID": "endpoint-id"}, clear=False):
            profile = resolve_generation_profile("core_pattern")
        self.assertEqual(profile.profile_id, "felt-seedream45-ref8-v1")
        self.assertEqual(profile.provider, "seedream_ark")
        self.assertEqual(profile.model, "endpoint-id")
        self.assertEqual(profile.reference_set_id, "felt-style-ref-v1")
        self.assertEqual((profile.generation_width, profile.generation_height), (1024, 1024))

    def test_unknown_profile_fails_closed(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "unknown"}, clear=False):
            with self.assertRaises(UnknownGenerationProfile):
                resolve_generation_profile("core_pattern")

    def test_addon_preserves_prompt_and_is_added_once(self):
        composed = compose_positive_prompt("熊猫抱红色皮球", "keep it simple")
        self.assertIn("熊猫抱红色皮球", composed)
        self.assertEqual(composed.count("keep it simple"), 1)


if __name__ == "__main__":
    unittest.main()
