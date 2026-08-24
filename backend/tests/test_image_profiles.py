from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.image_profiles import UnknownGenerationProfile, get_generation_profile, resolve_generation_profile  # noqa: E402
from services.image_service import compose_positive_prompt  # noqa: E402


class ImageProfileTests(unittest.TestCase):
    def test_core_pattern_resolves_seedream_profile(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "felt-seedream45-ref8-v1", "SEEDREAM_MODEL_ID": "seedream-test-model"}):
            profile = resolve_generation_profile("core_pattern")
        self.assertEqual(profile.profile_id, "felt-seedream45-ref8-v1")
        self.assertEqual(profile.provider, "seedream_ark")
        self.assertEqual(profile.model, "seedream-test-model")
        self.assertEqual(profile.reference_set_id, "felt-style-ref-v1")
        self.assertTrue(profile.hidden_prompt_addon)

    def test_unknown_profile_fails_closed(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "not-real"}):
            with self.assertRaises(UnknownGenerationProfile):
                resolve_generation_profile("core_pattern")
        with self.assertRaises(UnknownGenerationProfile):
            get_generation_profile("not-real")

    def test_no_profile_for_other_roles(self):
        with self.assertRaises(UnknownGenerationProfile):
            resolve_generation_profile("background")

    def test_hidden_addon_is_appended_once_and_preserves_canonical_prompt(self):
        canonical = "我想要一只熊猫抱着红色皮球"
        addon = "hidden felt constraint"
        composed = compose_positive_prompt(canonical, addon)
        self.assertIn(canonical, composed)
        self.assertEqual(composed.count(addon), 1)
        self.assertEqual(compose_positive_prompt(canonical, ""), canonical)


if __name__ == "__main__":
    unittest.main()
