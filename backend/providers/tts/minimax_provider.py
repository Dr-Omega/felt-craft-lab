"""MiniMax 动态 TTS + 服务端哈希缓存；向 Electron 返回 audioBase64（不伪造 ResourceRef）。"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any

import requests

from services.tts_cache import (
    atomic_write_bytes,
    enforce_tts_audio_size,
    prune_tts_cache,
)
from services.tts_types import err_tts, ok_tts_bytes

from .base import TtsProvider

CACHE_DIR = Path(__file__).resolve().parents[2] / "cache" / "tts"
DEFAULT_MODEL = "speech-02-hd"
DEFAULT_VOICE = "female-shaonv"

CN_BASES = [
    "https://api.minimaxi.chat/v1/t2a_v2",
    "https://api.minimax.chat/v1/t2a_v2",
]
INTL_BASE = "https://api.minimax.io/v1/t2a_v2"


def _clean_env(name: str) -> str:
    raw = os.getenv(name, "") or ""
    return raw.strip().strip('"').strip("'").strip()


class MiniMaxTtsProvider(TtsProvider):
    name = "minimax"

    def synthesize(self, *, text: str, voice_purpose: str = "qa_answer") -> dict[str, Any]:
        api_key = _clean_env("MINIMAX_API_KEY")
        group_id = _clean_env("MINIMAX_GROUP_ID")
        if not api_key:
            return err_tts(code="TTS_MISSING_API_KEY")
        if not group_id:
            return err_tts(code="TTS_MISSING_GROUP_ID")

        content = (text or "").strip()
        if not content:
            return err_tts(code="TTS_MISSING_TEXT")

        model = _clean_env("MINIMAX_TTS_MODEL") or DEFAULT_MODEL
        voice_id = _clean_env("MINIMAX_VOICE_ID") or DEFAULT_VOICE
        speed = _tts_speed()
        vol = _tts_vol()
        pitch = _tts_pitch()
        emotion = _tts_emotion()
        content = _maybe_insert_pauses(content)
        cache_key = _hash_key(
            content, model, voice_id, voice_purpose, speed, vol=vol, pitch=pitch, emotion=emotion
        )
        cache_path = CACHE_DIR / f"{cache_key}.mp3"

        prune_tts_cache(CACHE_DIR)
        if cache_path.exists() and cache_path.stat().st_size > 0:
            cached = cache_path.read_bytes()
            if enforce_tts_audio_size(cached):
                return ok_tts_bytes(
                    audio_bytes=cached,
                    cache_hit=True,
                    request_id=cache_key,
                )

        bases = _candidate_bases()
        voice_setting: dict[str, Any] = {
            "voice_id": voice_id,
            "speed": speed,
            "vol": vol,
            "pitch": pitch,
        }
        if emotion:
            voice_setting["emotion"] = emotion
        payload = {
            "model": model,
            "text": content[:500],
            "stream": False,
            "voice_setting": voice_setting,
            "audio_setting": {
                "sample_rate": 32000,
                "bitrate": 128000,
                "format": "mp3",
                "channel": 1,
            },
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        last_err: dict[str, Any] | None = None
        for base in bases:
            url = f"{base}?GroupId={group_id}"
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=60)
            except requests.Timeout:
                return err_tts(code="TTS_TIMEOUT")
            except requests.RequestException:
                last_err = err_tts(code="TTS_NETWORK_ERROR")
                continue

            _ = int((time.perf_counter() - started) * 1000)
            try:
                data = resp.json()
            except ValueError:
                last_err = err_tts(code="TTS_UPSTREAM_ERROR")
                continue

            base_resp = data.get("base_resp") or {}
            status_code = base_resp.get("status_code")
            status_msg = str(base_resp.get("status_msg") or "")

            if status_code == 2049 or "invalid api key" in status_msg.lower():
                last_err = err_tts(code="TTS_UPSTREAM_ERROR")
                continue

            if resp.status_code >= 400 or (status_code not in (None, 0)):
                return err_tts(code="TTS_UPSTREAM_ERROR")

            audio_bytes = _extract_audio_bytes(data)
            if not audio_bytes:
                return err_tts(code="TTS_UPSTREAM_ERROR")
            if not enforce_tts_audio_size(audio_bytes):
                return err_tts(code="TTS_UPSTREAM_ERROR")

            try:
                atomic_write_bytes(cache_path, audio_bytes)
                prune_tts_cache(CACHE_DIR)
            except OSError:
                pass
            return ok_tts_bytes(
                audio_bytes=audio_bytes,
                cache_hit=False,
                request_id=cache_key,
            )

        return last_err or err_tts(code="TTS_UPSTREAM_ERROR")


def _candidate_bases() -> list[str]:
    custom = _clean_env("MINIMAX_API_BASE")
    region = (_clean_env("MINIMAX_REGION") or "cn").lower()
    ordered: list[str] = []
    if custom:
        ordered.append(custom.rstrip("/"))
    if region in {"intl", "io", "global"}:
        ordered.append(INTL_BASE)
    ordered.extend(CN_BASES)
    seen: set[str] = set()
    out: list[str] = []
    for b in ordered:
        if b not in seen:
            seen.add(b)
            out.append(b)
    return out


def _tts_speed() -> float:
    """MiniMax speed typically 0.5–2.0; kids fixed intros often use ~0.85."""
    raw = _clean_env("MINIMAX_TTS_SPEED") or "1.0"
    try:
        speed = float(raw)
    except ValueError:
        return 1.0
    return max(0.5, min(2.0, speed))


def _tts_vol() -> float:
    """Volume (0, 10]; kids intros often use ~1.8 so speech is less soft."""
    raw = _clean_env("MINIMAX_TTS_VOL") or "1.0"
    try:
        vol = float(raw)
    except ValueError:
        return 1.0
    return max(0.1, min(10.0, vol))


def _tts_pitch() -> int:
    """Pitch [-12, 12]; slight positive can sound brighter / less weak."""
    raw = _clean_env("MINIMAX_TTS_PITCH") or "0"
    try:
        pitch = int(float(raw))
    except ValueError:
        return 0
    return max(-12, min(12, pitch))


def _tts_emotion() -> str:
    """Optional emotion: happy/sad/.../calm; empty = provider auto."""
    raw = (_clean_env("MINIMAX_TTS_EMOTION") or "").lower()
    allowed = {
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised",
        "calm",
        "fluent",
        "whisper",
    }
    return raw if raw in allowed else ""


def _maybe_insert_pauses(text: str) -> str:
    """Insert MiniMax <#sec#> pauses after sentence punctuation for clearer 顿挫."""
    raw = _clean_env("MINIMAX_TTS_PAUSE_SEC") or "0"
    try:
        sec = float(raw)
    except ValueError:
        return text
    if sec <= 0:
        return text
    sec = max(0.01, min(2.0, round(sec, 2)))
    marker = f"<#{sec}#>"
    # Avoid stacking if already present
    if "<#" in text:
        return text
    out = text
    for ch in ("。", "！", "？", "；", "!", "?"):
        out = out.replace(ch, f"{ch}{marker}")
    # Also pause after Chinese colon used as story beat (嫦娥奔月:)
    out = out.replace("：", f"：{marker}").replace(":", f":{marker}")
    # Don't leave trailing pause at very end if useless — MiniMax ok either way
    return out


def _hash_key(
    text: str,
    model: str,
    voice_id: str,
    purpose: str,
    speed: float = 1.0,
    *,
    vol: float = 1.0,
    pitch: int = 0,
    emotion: str = "",
) -> str:
    raw = (
        f"{purpose}|{model}|{voice_id}|{speed:.2f}|{vol:.2f}|{pitch}|{emotion}|{text}".encode(
            "utf-8"
        )
    )
    return hashlib.sha256(raw).hexdigest()[:32]


def _extract_audio_bytes(data: dict[str, Any]) -> bytes | None:
    audio = None
    if isinstance(data.get("data"), dict):
        audio = data["data"].get("audio")
    if audio is None:
        audio = data.get("audio")
    if not audio or not isinstance(audio, str):
        return None
    try:
        return bytes.fromhex(audio)
    except ValueError:
        import base64

        try:
            return base64.b64decode(audio)
        except Exception:  # noqa: BLE001
            return None
