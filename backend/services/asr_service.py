"""AsrService：按配置选择 Provider，对外只暴露统一结果。"""

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


class AsrService:
    def __init__(self, provider_name: Optional[str] = None) -> None:
        name = (provider_name or os.getenv("QWEN_ASR_PROVIDER") or "qwen_cloud_http").strip()
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
            # 未知配置时回退 HTTP，避免页面绑死
            return QwenCloudHttpProvider()
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
        except Exception as exc:  # noqa: BLE001 - 统一成 SharedError
            result = err_result(
                code="ASR_INTERNAL_ERROR",
                message=str(exc),
                retryable=True,
                provider=getattr(self.provider, "name", "unknown"),
            )

        # 记录延迟 / 空文本 / 失败，供验收
        ok = bool(result.get("ok"))
        body = result.get("result") or {}
        error = result.get("error") or {}
        record_asr_event(
            {
                "ok": ok,
                "provider": body.get("provider") or result.get("provider"),
                "latencyMs": body.get("latencyMs"),
                "empty": body.get("empty"),
                "errorCode": error.get("code"),
                "sessionId": session_id,
            }
        )
        return result
