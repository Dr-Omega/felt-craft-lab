"""Qwen3-ASR-Flash 云端 HTTP Provider（首版）。"""

from __future__ import annotations

import base64
import os
import time
from typing import Any, Optional

import requests

from services.asr_types import err_result, ok_result

from .base import AsrProvider

DEFAULT_DASHSCOPE_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
)
MODEL = "qwen3-asr-flash"
SAMPLE_AUDIO_URL = "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3"


def _api_key() -> str:
    return (
        os.getenv("QWEN_ASR_API_KEY", "").strip()
        or os.getenv("DASHSCOPE_API_KEY", "").strip()
    )


def _asr_url() -> str:
    return (os.getenv("QWEN_ASR_BASE_URL") or DEFAULT_DASHSCOPE_URL).strip()


def _upstream_error(status_code: int) -> tuple[str, bool]:
    if status_code in {401, 403}:
        return "语音识别服务的 Key 无效，或当前业务空间未开通该模型。", False
    if status_code in {400, 404}:
        return "语音识别服务地址或模型配置不匹配，请检查 QWEN_ASR_BASE_URL。", False
    if status_code == 413:
        return "录音文件超过语音识别服务允许的大小。", False
    return "语音识别服务暂时不可用，请稍后重试。", status_code >= 500


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
            return err_result(code="ASR_MISSING_API_KEY")

        if not audio_url and not audio_bytes:
            return err_result(code="ASR_MISSING_AUDIO")

        if audio_url:
            audio_ref = audio_url
        else:
            assert audio_bytes is not None
            b64 = base64.b64encode(audio_bytes).decode("ascii")
            audio_ref = f"data:{mime_type};base64,{b64}"

        asr_options: dict[str, Any] = {"enable_lid": True, "enable_itn": False}
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
            "X-DashScope-SSE": "disable",
        }

        started = time.perf_counter()
        try:
            resp = requests.post(_asr_url(), headers=headers, json=payload, timeout=60)
        except requests.Timeout:
            return err_result(code="ASR_TIMEOUT")
        except requests.RequestException:
            return err_result(code="ASR_NETWORK_ERROR")

        latency_ms = int((time.perf_counter() - started) * 1000)

        if resp.status_code >= 400:
            message, retryable = _upstream_error(resp.status_code)
            print(f"[story-card][asr] upstream status={resp.status_code}")
            return err_result(
                code="ASR_UPSTREAM_ERROR",
                message=message,
                retryable=retryable,
                details={"upstreamStatus": resp.status_code},
            )

        try:
            data = resp.json()
        except ValueError:
            print("[story-card][asr] upstream response=invalid-json")
            return err_result(code="ASR_BAD_RESPONSE")

        transcript, request_id = _extract_transcript(data)
        return ok_result(
            transcript=transcript,
            provider=self.name,
            duration_ms=latency_ms,
            request_id=request_id or None,
        )


def _extract_transcript(data: dict[str, Any]) -> tuple[str, str]:
    request_id = str(data.get("request_id") or data.get("requestId") or "")
    output = data.get("output") or {}
    choices = output.get("choices") or data.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        text = _content_to_text(message.get("content"))
        if text:
            return text, request_id
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
                if item.get("text"):
                    parts.append(str(item["text"]))
                elif item.get("transcript"):
                    parts.append(str(item["transcript"]))
        return "".join(parts).strip()
    if isinstance(content, dict):
        return str(content.get("text") or content.get("transcript") or "").strip()
    return str(content).strip()
