"""Qwen3-ASR-Flash 云端 HTTP Provider（首版）。"""

from __future__ import annotations

import base64
import os
import time
from typing import Any, Optional

import requests

from services.asr_types import err_result, ok_result

from .base import AsrProvider

DASHSCOPE_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
)
MODEL = "qwen3-asr-flash"
# 官方示例音频，供冒烟测试
SAMPLE_AUDIO_URL = "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3"


def _api_key() -> str:
    return (
        os.getenv("QWEN_ASR_API_KEY", "").strip()
        or os.getenv("DASHSCOPE_API_KEY", "").strip()
    )


class QwenCloudHttpProvider(AsrProvider):
    name = "qwen_cloud_http"

    def transcribe(
        self,
        *,
        audio_bytes: Optional[bytes] = None,
        audio_url: Optional[str] = None,
        mime_type: str = "audio/wav",
        language: Optional[str] = None,
    ) -> dict[str, Any]:
        key = _api_key()
        if not key:
            return err_result(
                code="ASR_MISSING_API_KEY",
                message="未配置 QWEN_ASR_API_KEY / DASHSCOPE_API_KEY",
                retryable=False,
                provider=self.name,
            )

        if not audio_url and not audio_bytes:
            return err_result(
                code="ASR_MISSING_AUDIO",
                message="请上传音频文件，或提供 audioUrl",
                retryable=False,
                provider=self.name,
            )

        if audio_url:
            audio_ref = audio_url
        else:
            assert audio_bytes is not None
            b64 = base64.b64encode(audio_bytes).decode("ascii")
            # DashScope 支持 data URL / base64
            audio_ref = f"data:{mime_type};base64,{b64}"

        asr_options: dict[str, Any] = {
            "enable_lid": True,
            "enable_itn": False,
        }
        if language:
            asr_options["language"] = language

        payload = {
            "model": MODEL,
            "input": {
                "messages": [
                    {"role": "system", "content": [{"text": ""}]},
                    {"role": "user", "content": [{"audio": audio_ref}]},
                ]
            },
            "parameters": {"asr_options": asr_options},
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        try:
            resp = requests.post(
                DASHSCOPE_URL,
                headers=headers,
                json=payload,
                timeout=60,
            )
        except requests.Timeout:
            return err_result(
                code="ASR_TIMEOUT",
                message="Qwen ASR 请求超时",
                retryable=True,
                provider=self.name,
            )
        except requests.RequestException as exc:
            return err_result(
                code="ASR_NETWORK_ERROR",
                message=f"网络错误：{exc}",
                retryable=True,
                provider=self.name,
                details={"exception": type(exc).__name__},
            )

        latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            data = resp.json()
        except ValueError:
            return err_result(
                code="ASR_BAD_RESPONSE",
                message="云端返回了无法解析的内容",
                retryable=True,
                provider=self.name,
                details={"status": resp.status_code, "latencyMs": latency_ms},
            )

        if resp.status_code >= 400:
            msg = (
                data.get("message")
                or data.get("code")
                or resp.text[:200]
                or "云端识别失败"
            )
            return err_result(
                code="ASR_UPSTREAM_ERROR",
                message=str(msg),
                retryable=resp.status_code >= 500,
                provider=self.name,
                details={"status": resp.status_code, "latencyMs": latency_ms, "body": data},
            )

        transcript, request_id = _extract_transcript(data)
        return ok_result(
            transcript=transcript,
            provider=self.name,
            duration_ms=0,
            latency_ms=latency_ms,
            request_id=request_id,
        )


def _extract_transcript(data: dict[str, Any]) -> tuple[str, str]:
    """尽量兼容 DashScope 多种返回形态。"""
    request_id = str(data.get("request_id") or data.get("requestId") or "")

    # 常见：output.choices[0].message.content
    output = data.get("output") or {}
    choices = output.get("choices") or data.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content")
        text = _content_to_text(content)
        if text:
            return text, request_id

    # 备选字段
    for key in ("text", "transcript", "result"):
        val = output.get(key) or data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip(), request_id

    return "", request_id


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if "text" in item and item["text"]:
                    parts.append(str(item["text"]))
                elif "transcript" in item and item["transcript"]:
                    parts.append(str(item["transcript"]))
        return "".join(parts).strip()
    if isinstance(content, dict):
        return str(content.get("text") or content.get("transcript") or "").strip()
    return str(content).strip()
