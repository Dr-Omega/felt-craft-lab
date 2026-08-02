"""MiniMax 动态 TTS + 本地文件哈希缓存（错误信息不泄露凭据）。"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any

import requests

from services.tts_types import err_tts, ok_tts

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
        cache_key = _hash_key(content, model, voice_id, voice_purpose)
        cache_path = CACHE_DIR / f"{cache_key}.mp3"

        if cache_path.exists() and cache_path.stat().st_size > 0:
            # NOTE: HTTP 路径待 ResourceRef 方案确认后迁移；当前保留联调可用性
            return ok_tts(
                audio_url=f"/api/tts/audio/{cache_key}.mp3",
                cache_hit=True,
                request_id=cache_key,
            )

        bases = _candidate_bases()
        payload = {
            "model": model,
            "text": content[:500],
            "stream": False,
            "voice_setting": {
                "voice_id": voice_id,
                "speed": 1.0,
                "vol": 1.0,
                "pitch": 0,
            },
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
                # 不返回上游 http(s) 外链；动态 TTS→ResourceRef 方案确认前仅接受本地缓存字节
                return err_tts(code="TTS_UPSTREAM_ERROR")

            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(audio_bytes)
            # 临时联调地址；正式 audioUrl 须为 felt-resource://audio/...（方案待确认，见 PR 审查线程）
            return ok_tts(
                audio_url=f"/api/tts/audio/{cache_key}.mp3",
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


def _hash_key(text: str, model: str, voice_id: str, purpose: str) -> str:
    raw = f"{purpose}|{model}|{voice_id}|{text}".encode("utf-8")
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


def _extract_audio_url(data: dict[str, Any]) -> str | None:
    if isinstance(data.get("data"), dict):
        for key in ("audio_url", "audioUrl", "url"):
            val = data["data"].get(key)
            if isinstance(val, str) and val.startswith("http"):
                return val
    for key in ("audio_url", "audioUrl"):
        val = data.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val
    return None
