"""AsrService：按白名单选择 Provider；未知 provider 拒绝，不回退付费通道。"""

from __future__ import annotations

import os
from typing import Any, Optional

from providers.asr.base import AsrProvider
from providers.asr.local_stub import QwenLocalProvider
from providers.asr.mock_provider import MockAsrProvider
from providers.asr.qwen_cloud_http import QwenCloudHttpProvider
from providers.asr.realtime_stub import QwenCloudRealtimeProvider
from services.asr_metrics import record_asr_event
from services.asr_types import err_result
from services.guards import asr_provider_allowed


class UnknownAsrProvider(ValueError):
    pass


class AsrService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        name = (provider_name or os.getenv("QWEN_ASR_PROVIDER") or "qwen_cloud_http").strip()
        if not asr_provider_allowed(name):
            raise UnknownAsrProvider(name)
        self.provider = self._build_provider(name)

    def _build_provider(self, name: str) -> AsrProvider:
        mapping = {
            "qwen_cloud_http": QwenCloudHttpProvider,
            "qwen_cloud_realtime": QwenCloudRealtimeProvider,
            "qwen_local": QwenLocalProvider,
            "mock": MockAsrProvider,
        }
        cls = mapping.get(name)
        if not cls:
            raise UnknownAsrProvider(name)
        return cls()

    def transcribe(
        self,
        *,
        audio_bytes: Optional[bytes] = None,
        audio_url: Optional[str] = None,
        mime_type: str = "audio/wav",
        language: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> dict[str, Any]:
        try:
            result = self.provider.transcribe(
                audio_bytes=audio_bytes,
                audio_url=audio_url,
                mime_type=mime_type,
                language=language,
            )
        except Exception:  # noqa: BLE001
            result = err_result(code="ASR_INTERNAL_ERROR")

        ok = bool(result.get("ok"))
        body = result.get("result") or {}
        error = result.get("error") or {}
        latency = body.get("durationMs")
        record_asr_event(
            {
                "ok": ok,
                "provider": body.get("provider") or getattr(self.provider, "name", None),
                "latencyMs": latency,
                "empty": (not ok and error.get("code") == "ASR_EMPTY_TRANSCRIPT"),
                "errorCode": error.get("code"),
                "sessionId": session_id,
            }
        )
        return result
