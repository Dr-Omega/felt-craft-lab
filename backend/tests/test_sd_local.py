"""Local SD provider: mocked HTTP only (no live WebUI calls)."""

from __future__ import annotations

import base64
import os
import sys
import unittest
from pathlib import Path
from unittest import mock
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ["APP_ENV"] = "development"

from providers.image.mock_provider import solid_png  # noqa: E402
from providers.image.sd_local import SdLocalProvider, inject_lora_tag  # noqa: E402
from services.guards import image_provider_allowed  # noqa: E402
from services.image_service import ImageService  # noqa: E402


class _Resp:
    def __init__(self, status_code: int, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class SdLocalTests(unittest.TestCase):
    def test_provider_allowed(self):
        self.assertTrue(image_provider_allowed("sd_local"))
        self.assertTrue(image_provider_allowed("wan_dashscope"))

    def test_inject_lora_tag_once(self):
        self.assertEqual(
            inject_lora_tag("黑白熊猫", name="felt_cartoon", weight=0.8),
            "黑白熊猫, <lora:felt_cartoon:0.80>",
        )
        already = "熊猫, <lora:felt_cartoon:0.80>"
        self.assertEqual(inject_lora_tag(already, name="felt_cartoon", weight=0.9), already)
        self.assertEqual(inject_lora_tag("熊猫", name="", weight=0.8), "熊猫")

    def test_txt2img_success(self):
        png = solid_png(64, 64, (244, 162, 97))
        encoded = base64.b64encode(png).decode("ascii")
        captured = {}

        def post(url, **kwargs):
            captured["url"] = url
            captured["json"] = kwargs.get("json")
            return _Resp(200, {"images": [encoded], "info": "seed: 1"})

        with mock.patch.dict(
            os.environ,
            {
                "SD_LOCAL_BASE_URL": "http://127.0.0.1:7860",
                "SD_LOCAL_LORA_NAME": "felt_cartoon",
                "SD_LOCAL_LORA_WEIGHT": "0.8",
            },
        ):
            provider = SdLocalProvider(post=post)
            result = provider.generate(
                positive_prompt="简单可爱卡通平面大色块，黑白熊猫抱着红色皮球",
                negative_prompt="写实照片",
                width=512,
                height=512,
            )
        self.assertTrue(result.get("ok"))
        self.assertEqual(captured["url"], "http://127.0.0.1:7860/sdapi/v1/txt2img")
        prompt = captured["json"]["prompt"]
        self.assertIn("<lora:felt_cartoon:0.80>", prompt)
        self.assertEqual(captured["json"]["negative_prompt"], "写实照片")
        self.assertEqual(captured["json"]["steps"], 25)
        self.assertGreaterEqual(captured["json"]["seed"], 0)

    def test_checkpoint_override_when_configured(self):
        png = solid_png(32, 32, (42, 157, 143))
        encoded = base64.b64encode(png).decode("ascii")
        captured = {}

        def post(url, **kwargs):
            captured["json"] = kwargs.get("json")
            return _Resp(200, {"images": [encoded]})

        with mock.patch.dict(
            os.environ,
            {
                "SD_LOCAL_BASE_URL": "http://127.0.0.1:7860",
                "SD_LOCAL_CHECKPOINT": "flatCartoon_v1.safetensors",
                "SD_LOCAL_SEED": "42",
            },
        ):
            provider = SdLocalProvider(post=post)
            result = provider.generate(positive_prompt="熊猫", width=512, height=512)
        self.assertTrue(result.get("ok"))
        self.assertEqual(captured["json"]["seed"], 42)
        self.assertEqual(
            captured["json"]["override_settings"]["sd_model_checkpoint"],
            "flatCartoon_v1.safetensors",
        )

    def test_unreachable_webui(self):
        def post(*_args, **_kwargs):
            raise __import__("requests").RequestException("down")

        with mock.patch.dict(os.environ, {"SD_LOCAL_BASE_URL": "http://127.0.0.1:7860"}):
            provider = SdLocalProvider(post=post)
            result = provider.generate(positive_prompt="熊猫")
        self.assertFalse(result.get("ok"))
        self.assertEqual(result["error"]["code"], "UNKNOWN")
        self.assertIn("本地 SD", result["error"]["message"])

    def test_image_service_selects_sd_local(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "sd_local", "APP_ENV": "development"}):
            service = ImageService()
        self.assertEqual(service.provider.name, "sd_local")


if __name__ == "__main__":
    unittest.main()
