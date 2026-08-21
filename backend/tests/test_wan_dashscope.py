"""Wan DashScope provider: mocked HTTP only (no live cloud calls)."""

from __future__ import annotations

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
from providers.image.wan_dashscope import WanDashScopeProvider  # noqa: E402
from services.guards import image_provider_allowed  # noqa: E402


class _Resp:
    def __init__(self, status_code: int, payload=None, content: bytes = b"", headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.content = content
        self.headers = headers or {}

    def json(self):
        return self._payload

    def iter_content(self, chunk_size=65536):
        data = self.content or b""
        for i in range(0, len(data), chunk_size):
            yield data[i : i + chunk_size]


class WanDashScopeTests(unittest.TestCase):
    def test_provider_allowed_in_dev_and_prod_names(self):
        self.assertTrue(image_provider_allowed("wan_dashscope"))
        self.assertTrue(image_provider_allowed("sd_local"))
        self.assertTrue(image_provider_allowed("mock"))

    def test_missing_key_is_fail_closed(self):
        with mock.patch.dict(os.environ, {"DASHSCOPE_API_KEY": "", "QWEN_ASR_API_KEY": ""}):
            provider = WanDashScopeProvider(post=Mock(), get=Mock(), sleep=lambda _s: None)
            result = provider.generate(positive_prompt="白色玉兔抱月饼")
        self.assertFalse(result.get("ok"))
        self.assertEqual(result["error"]["code"], "UNKNOWN")

    def test_create_poll_and_download(self):
        png = solid_png(64, 64, (244, 162, 97))
        posts = [
            _Resp(200, {"output": {"task_id": "task-1", "task_status": "PENDING"}}),
        ]
        gets = [
            _Resp(200, {"output": {"task_status": "RUNNING"}}),
            _Resp(
                200,
                {"output": {"task_status": "SUCCEEDED", "results": [{"url": "https://cdn.example/a.png"}]}},
            ),
            _Resp(200, content=png),
        ]

        def post(*_args, **_kwargs):
            return posts.pop(0)

        def get(url, **_kwargs):
            _ = url
            return gets.pop(0)

        with mock.patch.dict(os.environ, {"DASHSCOPE_API_KEY": "sk-test"}):
            provider = WanDashScopeProvider(post=post, get=get, sleep=lambda _s: None)
            result = provider.generate(positive_prompt="熊猫坐着")
        self.assertTrue(result.get("ok"))
        encoded = (result.get("result") or {}).get("imageBase64")
        self.assertTrue(encoded)

    def test_does_not_enable_prompt_rewrite(self):
        captured = {}

        def post(_url, **kwargs):
            captured["json"] = kwargs.get("json")
            return _Resp(200, {"output": {"task_id": "task-2", "task_status": "PENDING"}})

        def get(_url, **_kwargs):
            return _Resp(
                200,
                {"output": {"task_status": "SUCCEEDED", "results": [{"url": "https://cdn.example/a.png"}]}},
            )

        png = solid_png(32, 32, (42, 157, 143))
        downloads = {"n": 0}

        def mixed(url, **kwargs):
            if "tasks/" in str(url):
                return get(url, **kwargs)
            downloads["n"] += 1
            return _Resp(200, content=png)

        with mock.patch.dict(os.environ, {"DASHSCOPE_API_KEY": "sk-test"}):
            provider = WanDashScopeProvider(post=post, get=mixed, sleep=lambda _s: None)
            result = provider.generate(positive_prompt="熊猫坐着", negative_prompt="写实照片")
        self.assertTrue(result.get("ok"))
        self.assertEqual(captured["json"]["parameters"]["prompt_extend"], False)
        self.assertEqual(captured["json"]["parameters"]["n"], 1)

    def test_download_rejects_oversized_content_length(self):
        posts = [
            _Resp(200, {"output": {"task_id": "task-3", "task_status": "PENDING"}}),
        ]

        def post(*_args, **_kwargs):
            return posts.pop(0)

        def get(url, **_kwargs):
            if "tasks/" in str(url):
                return _Resp(
                    200,
                    {"output": {"task_status": "SUCCEEDED", "results": [{"url": "https://cdn.example/big.png"}]}},
                )
            return _Resp(
                200,
                content=b"x" * 100,
                headers={"Content-Length": str(9 * 1024 * 1024)},
            )

        with mock.patch.dict(os.environ, {"DASHSCOPE_API_KEY": "sk-test"}):
            provider = WanDashScopeProvider(post=post, get=get, sleep=lambda _s: None)
            result = provider.generate(positive_prompt="熊猫坐着")
        self.assertFalse(result.get("ok"))
        self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")


if __name__ == "__main__":
    unittest.main()
