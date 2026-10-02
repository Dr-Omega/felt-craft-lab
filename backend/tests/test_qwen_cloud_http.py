from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from providers.asr.qwen_cloud_http import QwenCloudHttpProvider  # noqa: E402


class _Response:
    def __init__(self, status_code: int):
        self.status_code = status_code

    def json(self):
        return {"code": "UpstreamError"}


class _NonJsonResponse(_Response):
    def json(self):
        raise ValueError("not json")


class QwenCloudHttpProviderTests(unittest.TestCase):
    def test_surfaces_safe_configuration_error_for_bad_upstream_request(self):
        with mock.patch.dict(os.environ, {"QWEN_ASR_API_KEY": "test-key"}, clear=False):
            with mock.patch("providers.asr.qwen_cloud_http.requests.post", return_value=_Response(400)):
                result = QwenCloudHttpProvider().transcribe(audio_bytes=b"audio", mime_type="audio/webm")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["message"], "语音识别服务地址或模型配置不匹配，请检查 QWEN_ASR_BASE_URL。")
        self.assertEqual(result["error"]["details"], {"upstreamStatus": 400})

    def test_surfaces_safe_permission_error_for_forbidden_upstream_response(self):
        with mock.patch.dict(os.environ, {"QWEN_ASR_API_KEY": "test-key"}, clear=False):
            with mock.patch("providers.asr.qwen_cloud_http.requests.post", return_value=_Response(403)):
                result = QwenCloudHttpProvider().transcribe(audio_bytes=b"audio", mime_type="audio/webm")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["message"], "语音识别服务的 Key 无效，或当前业务空间未开通该模型。")
        self.assertEqual(result["error"]["details"], {"upstreamStatus": 403})

    def test_handles_non_json_upstream_error_by_status_before_body_parsing(self):
        with mock.patch.dict(os.environ, {"QWEN_ASR_API_KEY": "test-key"}, clear=False):
            with mock.patch("providers.asr.qwen_cloud_http.requests.post", return_value=_NonJsonResponse(404)):
                result = QwenCloudHttpProvider().transcribe(audio_bytes=b"audio", mime_type="audio/webm")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["message"], "语音识别服务地址或模型配置不匹配，请检查 QWEN_ASR_BASE_URL。")
        self.assertEqual(result["error"]["details"], {"upstreamStatus": 404})
