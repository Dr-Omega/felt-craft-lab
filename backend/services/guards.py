"""请求守卫：大小/MIME/文本长度/provider 白名单/限流/并发。"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Any, Optional

# 上传与文本上限
MAX_AUDIO_BYTES = int(os.getenv("AI_MAX_AUDIO_BYTES", str(5 * 1024 * 1024)))
MAX_QA_QUESTION_CHARS = int(os.getenv("AI_MAX_QA_CHARS", "500"))
MAX_QA_HISTORY_MESSAGES = 12
MAX_QA_HISTORY_MESSAGE_CHARS = 500
MAX_TTS_TEXT_CHARS = int(os.getenv("AI_MAX_TTS_CHARS", "500"))

ALLOWED_AUDIO_MIME = frozenset(
    {
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/webm",
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/m4a",
        "audio/ogg",
        "audio/flac",
        "application/octet-stream",  # 部分浏览器录音不带精确 MIME
    }
)

# 正式 ASR Providers（与 Contracts ASR_PROVIDERS 一致）+ 开发 Mock
ASR_PROVIDERS_PROD = frozenset({"qwen_cloud_http", "qwen_cloud_realtime", "qwen_local"})
ASR_PROVIDERS_DEV_EXTRA = frozenset({"mock"})
QA_PROVIDERS_PROD = frozenset({"deepseek"})
QA_PROVIDERS_DEV_EXTRA = frozenset({"mock"})
TTS_PROVIDERS_PROD = frozenset({"minimax"})
TTS_PROVIDERS_DEV_EXTRA = frozenset({"mock"})

_RATE_WINDOW_SEC = float(os.getenv("AI_RATE_WINDOW_SEC", "60"))
_RATE_MAX = int(os.getenv("AI_RATE_MAX", "30"))
_MAX_INFLIGHT = int(os.getenv("AI_MAX_INFLIGHT", "4"))

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)
_inflight = 0
_inflight_cond = threading.Condition(_lock)


def is_dev_mode() -> bool:
    """Fail-closed: only explicit development/dev/test count as dev. Missing/unknown → production."""
    env = (os.getenv("APP_ENV") or "").strip().lower()
    return env in {"development", "dev", "test"}


def smoke_allowed() -> bool:
    """真实 smoke 仅开发态且显式开启。"""
    if not is_dev_mode():
        return False
    flag = (os.getenv("AI_SMOKE_ENABLED") or "").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def asr_provider_allowed(name: str) -> bool:
    n = (name or "").strip()
    if n in ASR_PROVIDERS_PROD:
        return True
    return is_dev_mode() and n in ASR_PROVIDERS_DEV_EXTRA


def qa_provider_allowed(name: str) -> bool:
    n = (name or "").strip()
    if n in QA_PROVIDERS_PROD:
        return True
    return is_dev_mode() and n in QA_PROVIDERS_DEV_EXTRA


def tts_provider_allowed(name: str) -> bool:
    n = (name or "").strip()
    if n in TTS_PROVIDERS_PROD:
        return True
    return is_dev_mode() and n in TTS_PROVIDERS_DEV_EXTRA


def check_audio_mime(mime: Optional[str]) -> Optional[str]:
    if not mime:
        return None
    base = mime.split(";")[0].strip().lower()
    if base not in ALLOWED_AUDIO_MIME:
        return "UNSUPPORTED_MEDIA_TYPE"
    return None


def check_audio_size(n: int) -> Optional[str]:
    if n <= 0:
        return "ASR_MISSING_AUDIO"
    if n > MAX_AUDIO_BYTES:
        return "PAYLOAD_TOO_LARGE"
    return None


def check_qa_text(text: str) -> Optional[str]:
    if not (text or "").strip():
        return "QA_MISSING_QUESTION"
    if len(text) > MAX_QA_QUESTION_CHARS:
        return "TEXT_TOO_LONG"
    return None


def validate_qa_request(data: Any) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """Authoritative defensive validation and projection for QA requests."""
    if not isinstance(data, dict):
        return None, "INVALID_ARGUMENT"
    question = data.get("question")
    if not isinstance(question, str):
        return None, "INVALID_ARGUMENT"
    question = question.strip()
    text_err = check_qa_text(question)
    if text_err:
        return None, text_err

    projected_asset: dict[str, str] = {}
    asset = data.get("asset", {})
    if asset is None:
        asset = {}
    if not isinstance(asset, dict):
        return None, "INVALID_ARGUMENT"
    for key, limit in (("assetId", 128), ("nameZh", 80), ("introZh", 500), ("themeId", 80)):
        if key not in asset:
            continue
        value = asset[key]
        if not isinstance(value, str):
            return None, "INVALID_ARGUMENT"
        value = value.strip()
        if len(value) > limit:
            return None, "TEXT_TOO_LONG"
        if value:
            projected_asset[key] = value

    history = data.get("history")
    projected_history: list[dict[str, str]] = []
    if history is not None:
        if not isinstance(history, list) or len(history) > MAX_QA_HISTORY_MESSAGES:
            return None, "INVALID_ARGUMENT"
        for index, item in enumerate(history):
            if not isinstance(item, dict) or set(item.keys()) - {"role", "content"}:
                return None, "INVALID_ARGUMENT"
            role = item.get("role")
            content = item.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                return None, "INVALID_ARGUMENT"
            content = content.strip()
            if not content or len(content) > MAX_QA_HISTORY_MESSAGE_CHARS:
                return None, "INVALID_ARGUMENT"
            projected_history.append({"role": role, "content": content})

    provider = data.get("provider")
    if provider is not None and (not isinstance(provider, str) or not provider.strip()):
        return None, "INVALID_ARGUMENT"
    result: dict[str, Any] = {"question": question, "asset": projected_asset}
    if projected_history:
        result["history"] = projected_history
    if isinstance(provider, str) and provider.strip():
        result["provider"] = provider.strip()
    return result, None


def check_tts_text(text: str) -> Optional[str]:
    if not (text or "").strip():
        return "TTS_MISSING_TEXT"
    if len(text) > MAX_TTS_TEXT_CHARS:
        return "TEXT_TOO_LONG"
    return None


def rate_limit_ok(bucket: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _hits[bucket]
        while q and now - q[0] > _RATE_WINDOW_SEC:
            q.popleft()
        if len(q) >= _RATE_MAX:
            return False
        q.append(now)
        return True


class InflightGuard:
    def __enter__(self) -> "InflightGuard":
        global _inflight
        with _inflight_cond:
            while _inflight >= _MAX_INFLIGHT:
                _inflight_cond.wait(timeout=30)
                if _inflight >= _MAX_INFLIGHT:
                    raise TimeoutError("inflight")
            _inflight += 1
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        global _inflight
        with _inflight_cond:
            _inflight = max(0, _inflight - 1)
            _inflight_cond.notify()
