from __future__ import annotations

import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tools"))

from providers.image.mock_provider import subject_on_backdrop_png  # noqa: E402
from services.image_profiles import resolve_generation_profile  # noqa: E402
from services.image_service import ImageService, InternalGenerateSmokeResult  # noqa: E402
from services.image_types import err_image, ok_image_bytes  # noqa: E402
from services.style_reference_sets import resolve_reference_images  # noqa: E402
from smoke_seedream_cutout_prompt import SMOKE_CASES, _write_case  # noqa: E402


class _Provider:
    name = "seedream_ark"

    def __init__(self, response: dict | None = None) -> None:
        self.calls: list[dict] = []
        self.response = response
        self.image_bytes = subject_on_backdrop_png(128, 128, (244, 162, 97))

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.response or ok_image_bytes(
            image_bytes=self.image_bytes,
            request_id="provider-response-id",
            provider=self.name,
        )


class CutoutPromptV2Tests(unittest.TestCase):
    def test_v1_is_still_default_and_v2_resolves_only_when_selected(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            v1 = resolve_generation_profile("core_pattern")
        self.assertEqual(v1.profile_id, "felt-seedream45-ref8-v1")
        self.assertEqual(v1.reference_set_id, "felt-style-ref-v1")
        with mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "felt-seedream45-ref8-v2-cutout"}, clear=False):
            v2 = resolve_generation_profile("core_pattern")
        self.assertEqual(v2.profile_id, "felt-seedream45-ref8-v2-cutout")
        self.assertEqual(v2.provider, "seedream_ark")
        self.assertEqual(v2.model, "doubao-seedream-4-5-251128")
        self.assertEqual(v2.reference_set_id, "felt-style-ref-v1")

    def test_v2_t2i_addon_contains_cutout_constraints_without_single_object_or_texture_rules(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "felt-seedream45-ref8-v2-cutout"}, clear=False):
            addon = resolve_generation_profile("core_pattern").hidden_prompt_addon.lower()
        for phrase in ("reference images only", "sticker border", "white outline", "halo", "glow", "plain, uniform, solid-color background", "white or near-white", "especially white, cream"):
            self.assertIn(phrase, addon)
        self.assertNotIn("single object", addon)
        self.assertNotIn("single asset", addon)
        self.assertNotIn("fiber", addon)
        self.assertNotIn("material texture", addon)

    def test_v2_i2i_addon_keeps_content_style_roles_and_adds_cutout_constraints(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "felt-seedream45-ref8-v2-cutout"}, clear=False):
            addon = resolve_generation_profile("core_pattern").transform_prompt_addon.lower()
        self.assertIn("image 1 is the user's content and structure reference", addon)
        self.assertIn("images 2 through 9 are style references only", addon)
        for phrase in ("sticker border", "white outline", "halo", "plain, uniform, solid-color background", "white or near-white", "especially white, cream"):
            self.assertIn(phrase, addon)
        self.assertNotIn("single object", addon)
        self.assertNotIn("single asset", addon)

    def test_v2_i2i_still_sends_content_then_eight_fixed_style_references(self):
        provider = _Provider()
        content = "data:image/png;base64," + base64.b64encode(provider.image_bytes).decode("ascii")
        with (
            mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "felt-seedream45-ref8-v2-cutout"}, clear=False),
            mock.patch("services.image_service.SeedreamArkProvider", return_value=provider),
        ):
            result = ImageService().transform(content_image=content, request_id="v2-i2i")
        self.assertTrue(result["ok"])
        self.assertEqual(len(provider.calls), 1)
        references = provider.calls[0]["reference_images"]
        self.assertEqual(len(references), 9)
        self.assertEqual(references[0], content)
        self.assertEqual(references[1:], resolve_reference_images("felt-style-ref-v1"))

    def test_t2i_internal_smoke_keeps_raw_and_final_from_one_provider_response(self):
        provider = _Provider()
        with (
            mock.patch.dict(os.environ, {"IMAGE_PROFILE_CORE_PATTERN": "felt-seedream45-ref8-v2-cutout"}, clear=False),
            mock.patch("services.image_service.SeedreamArkProvider", return_value=provider),
        ):
            result = ImageService().generate_for_internal_smoke(
                positive_prompt="白色小兔子和红色皮球",
                request_id="cutout-smoke-test",
            )
        self.assertIsInstance(result, InternalGenerateSmokeResult)
        assert isinstance(result, InternalGenerateSmokeResult)
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(result.raw_image_bytes, provider.image_bytes)
        self.assertTrue(result.final_envelope["ok"])
        self.assertEqual(result.final_envelope["result"]["requestId"], "cutout-smoke-test")
        call = provider.calls[0]
        self.assertEqual(len(call["reference_images"]), 8)
        self.assertEqual(call["reference_images"], resolve_reference_images("felt-style-ref-v1"))
        self.assertIn("sticker border", call["positive_prompt"].lower())

    def test_production_generate_envelope_has_no_raw_bytes_and_provider_failure_fails_closed(self):
        provider = _Provider()
        with mock.patch("services.image_service.SeedreamArkProvider", return_value=provider):
            result = ImageService().generate(positive_prompt="熊猫", request_id="production")
        self.assertTrue(result["ok"])
        self.assertNotIn("raw", result["result"])
        self.assertNotIn(base64.b64encode(provider.image_bytes).decode("ascii"), str(result))
        failed_provider = _Provider(response=err_image(code="IMAGE_UPSTREAM_ERROR"))
        with mock.patch("services.image_service.SeedreamArkProvider", return_value=failed_provider):
            failed = ImageService().generate_for_internal_smoke(positive_prompt="熊猫")
        self.assertFalse(failed["ok"])
        self.assertEqual(len(failed_provider.calls), 1)

    def test_fixed_smoke_cases_and_metadata_never_store_prompt_or_base64(self):
        self.assertEqual(tuple(case.case_id for case in SMOKE_CASES), tuple(f"S{index:02d}" for index in range(1, 9)))
        self.assertIn("两个主体", SMOKE_CASES[-1].prompt)
        provider = _Provider()
        with mock.patch("services.image_service.SeedreamArkProvider", return_value=provider):
            result = ImageService().generate_for_internal_smoke(positive_prompt=SMOKE_CASES[0].prompt)
        assert isinstance(result, InternalGenerateSmokeResult)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = resolve_generation_profile("core_pattern")
            metadata = _write_case(root=root, case=SMOKE_CASES[0], profile_id=profile.profile_id, profile=profile, smoke_result=result)
            saved = (root / "S01" / "metadata.json").read_text(encoding="utf-8")
        self.assertEqual(metadata["referenceCount"], 8)
        self.assertIn("referenceSetId", metadata)
        self.assertNotIn(SMOKE_CASES[0].prompt, saved)
        self.assertNotIn(base64.b64encode(provider.image_bytes).decode("ascii"), saved)


if __name__ == "__main__":
    unittest.main()
