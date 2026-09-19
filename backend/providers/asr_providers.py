"""
ASR Provider 抽象

首版：qwen_cloud_http（Qwen3-ASR-Flash）
预留：qwen_cloud_realtime、qwen_local（先占位，不实现）
"""

from __future__ import annotations

import base64
import time
from abc import ABC, abstractmethod
from typing import Any

import requests


class AsrProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}


class AsrProvider(ABC):
    name: str

    @abstractmethod
    def transcribe(
        self,
        *,
        audio_bytes: bytes | None = None,
        audio_url: str | None = None,
        mime_type: str = "audio/wav",
        language: str | None = None,
    ) -> dict[str, Any]:
        """返回统一 AsrResult 字典。"""


class QwenCloudHttpProvider(AsrProvider):
    """DashScope 同步 HTTP：model=qwen3-asr-flash"""

    name = "qwen_cloud_http"
    API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    MODEL = "qwen3-asr-flash"

    def __init__(self, api_key: str, timeout_sec: float = 60.0):
        if not api_key:
            raise AsrProviderError("ASR_KEY_MISSING", "QWEN_ASR_API_KEY / DASHSCOPE_API_KEY 未配置", retryable=False)
        self.api_key = api_key
        self.timeout_sec = timeout_sec

    def _build_audio_ref(self, audio_bytes: bytes | None, audio_url: str | None, mime_type: str) -> str:
        if audio_url:
            return audio_url
        if audio_bytes:
            b64 = base64.b64encode(audio_bytes).decode("ascii")
            # DashScope 支持 data URL / base64
            return f"data:{mime_type};base64,{b64}"
        raise AsrProviderError("ASR_NO_AUDIO", "需要 audio 文件或 audio_url", retryable=False)

    def transcribe(
        self,
        *,
        audio_bytes: bytes | None = None,
        audio_url: str | None = None,
        mime_type: str = "audio/wav",
        language: str | None = None,
    ) -> dict[str, Any]:
        audio_ref = self._build_audio_ref(audio_bytes, audio_url, mime_type)
        asr_options: dict[str, Any] = {
            "enable_lid": True,
            "enable_itn": False,
        }
        if language:
            asr_options["language"] = language

        payload = {
            "model": self.MODEL,
            "input": {
                "messages": [
                    {"role": "system", "content": [{"text": ""}]},
                    {"role": "user", "content": [{"audio": audio_ref}]},
                ]
            },
            "parameters": {"asr_options": asr_options},
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        t0 = time.perf_counter()
        try:
            resp = requests.post(self.API_URL, json=payload, headers=headers, timeout=self.timeout_sec)
        except requests.Timeout as e:
            raise AsrProviderError("ASR_TIMEOUT", "Qwen ASR 请求超时", retryable=True, details={"error": str(e)}) from e
        except requests.RequestException as e:
            raise AsrProviderError("ASR_NETWORK", "Qwen ASR 网络错误", retryable=True, details={"error": str(e)}) from e

        latency_ms = int((time.perf_counter() - t0) * 1000)

        try:
            data = resp.json()
        except Exception as e:
            raise AsrProviderError(
                "ASR_BAD_RESPONSE",
                f"Qwen ASR 返回非 JSON，HTTP {resp.status_code}",
                retryable=True,
                details={"status": resp.status_code, "body": resp.text[:500]},
            ) from e

        if resp.status_code >= 400:
            code = str(data.get("code") or "ASR_HTTP_ERROR")
            msg = str(data.get("message") or data.get("message") or f"HTTP {resp.status_code}")
            raise AsrProviderError(code, msg, retryable=resp.status_code >= 500, details=data)

        # 解析文本：DashScope multimodal 常见结构 output.choices[0].message.content
        transcript = _extract_transcript(data)
        request_id = data.get("request_id") or data.get("requestId")

        return {
            "transcript": transcript,
            "provider": self.name,
            "durationMs": latency_ms,  # 请求耗时；真实音频时长若响应有再覆盖
            "latencyMs": latency_ms,
            "confidence": None,
            "requestId": request_id,
            "raw": data if False else None,  # 默认不把原始大包返回给前端
        }


class QwenCloudRealtimeProvider(AsrProvider):
    """预留：WebSocket realtime，第 2 步不实现。"""

    name = "qwen_cloud_realtime"

    def transcribe(self, **kwargs) -> dict[str, Any]:
        raise AsrProviderError(
            "ASR_PROVIDER_NOT_READY",
            "qwen_cloud_realtime 尚未接入（延迟不达标时再评估）",
            retryable=False,
        )


class QwenLocalProvider(AsrProvider):
    """预留：本地 0.6B/1.7B，第 2 步不实现。"""

    name = "qwen_local"

    def transcribe(self, **kwargs) -> dict[str, Any]:
        raise AsrProviderError(
            "ASR_PROVIDER_NOT_READY",
            "qwen_local 尚未接入（弱网/离线时再评估）",
            retryable=False,
        )


class MockAsrProvider(AsrProvider):
    """供 SXY 并行开发：不调云端，固定返回示例文本。"""

    name = "mock"

    def transcribe(
        self,
        *,
        audio_bytes: bytes | None = None,
        audio_url: str | None = None,
        mime_type: str = "audio/wav",
        language: str | None = None,
    ) -> dict[str, Any]:
        return {
            "transcript": "这是模拟识别结果，用于前端联调。",
            "provider": "qwen_cloud_http",  # 对外仍用契约里的 provider 枚举语义；mock 仅开发
            "durationMs": 120,
            "latencyMs": 120,
            "confidence": 1.0,
            "requestId": "mock-request",
            "mock": True,
        }


def _extract_transcript(data: dict) -> str:
    """尽量兼容 DashScope 几种返回结构。"""
    output = data.get("output") or {}
    # choices / message / content
    choices = output.get("choices") or data.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            texts = []
            for part in content:
                if isinstance(part, dict):
                    if "text" in part and part["text"]:
                        texts.append(str(part["text"]))
                    elif "transcript" in part:
                        texts.append(str(part["transcript"]))
                elif isinstance(part, str):
                    texts.append(part)
            return "".join(texts).strip()

    # 有的版本在 output.text
    if isinstance(output.get("text"), str):
        return output["text"].strip()

    # 失败时给空串，由上层标 empty
    return ""
