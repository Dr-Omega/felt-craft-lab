"""请求守卫：大小/MIME/文本长度/provider 白名单/限流/并发。"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Optional

# 上传与文本上限
MAX_AUDIO_BYTES = int(os.getenv("AI_MAX_AUDIO_BYTES", str(5 * 1024 * 1024)))
MAX_QA_QUESTION_CHARS = int(os.getenv("AI_MAX_QA_CHARS", "500"))
MAX_TTS_TEXT_CHARS = int(os.getenv("AI_MAX_TTS_CHARS", "500"))
MAX_INTENT_TEXT_CHARS = int(os.getenv("AI_MAX_INTENT_CHARS", "120"))

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
# Cloud image is DashScope 通义万相; local SD+LoRA is the felt-style path;
# mock remains a development stand-in.
IMAGE_PROVIDERS_PROD = frozenset({"wan_dashscope", "sd_local"})
IMAGE_PROVIDERS_DEV_EXTRA = frozenset({"mock"})
MAX_IMAGE_PROMPT_CHARS = int(os.getenv("AI_MAX_IMAGE_PROMPT_CHARS", "2000"))

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


def image_provider_allowed(name: str) -> bool:
    n = (name or "").strip()
    if n in IMAGE_PROVIDERS_PROD:
        return True
    return is_dev_mode() and n in IMAGE_PROVIDERS_DEV_EXTRA


def check_image_prompt(text: str) -> Optional[str]:
    if not (text or "").strip():
        return "INVALID_ARGUMENT"
    if len(text) > MAX_IMAGE_PROMPT_CHARS:
        return "TEXT_TOO_LONG"
    return None


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


def check_intent_text(text: str) -> Optional[str]:
    if not (text or "").strip():
        return "QA_MISSING_QUESTION"
    if len(text) > MAX_INTENT_TEXT_CHARS:
        return "TEXT_TOO_LONG"
    return None


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
