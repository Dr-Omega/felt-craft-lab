"""MiniMax 动态 TTS + 本地文件哈希缓存。"""

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

# 国内常见两个域名；国际版另算
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
            return err_tts(
                code="TTS_MISSING_API_KEY",
                message="未配置 MINIMAX_API_KEY",
                retryable=False,
            )
        if not group_id:
            return err_tts(
                code="TTS_MISSING_GROUP_ID",
                message="未配置 MINIMAX_GROUP_ID",
                retryable=False,
            )

        content = (text or "").strip()
        if not content:
            return err_tts(
                code="TTS_MISSING_TEXT",
                message="合成文本不能为空",
                retryable=False,
            )

        model = _clean_env("MINIMAX_TTS_MODEL") or DEFAULT_MODEL
        voice_id = _clean_env("MINIMAX_VOICE_ID") or DEFAULT_VOICE
        cache_key = _hash_key(content, model, voice_id, voice_purpose)
        cache_path = CACHE_DIR / f"{cache_key}.mp3"

        if cache_path.exists() and cache_path.stat().st_size > 0:
            return ok_tts(
                audio_url=f"/api/tts/audio/{cache_key}.mp3",
                cache_hit=True,
                request_id=cache_key,
                latency_ms=0,
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
                return err_tts(code="TTS_TIMEOUT", message="语音生成超时", retryable=True)
            except requests.RequestException as exc:
                last_err = err_tts(
                    code="TTS_NETWORK_ERROR",
                    message=f"网络异常：{exc}",
                    retryable=True,
                    details={"exception": type(exc).__name__, "base": base},
                )
                continue

            latency_ms = int((time.perf_counter() - started) * 1000)
            try:
                data = resp.json()
            except ValueError:
                last_err = err_tts(
                    code="TTS_UPSTREAM_ERROR",
                    message="语音服务返回无法解析",
                    retryable=True,
                    latency_ms=latency_ms,
                    details={"status": resp.status_code, "base": base},
                )
                continue

            base_resp = data.get("base_resp") or {}
            status_code = base_resp.get("status_code")
            status_msg = str(base_resp.get("status_msg") or "")

            # 密钥无效：换下一个域名再试
            if status_code == 2049 or "invalid api key" in status_msg.lower():
                last_err = err_tts(
                    code="TTS_UPSTREAM_ERROR",
                    message="invalid api key",
                    retryable=True,
                    latency_ms=latency_ms,
                    details={
                        "httpStatus": resp.status_code,
                        "baseResp": base_resp,
                        "triedBase": base,
                        "keyPrefix": api_key[:4] + "***",
                        "keyLength": len(api_key),
                        "groupIdLength": len(group_id),
                        "hint": "请确认用的是「接口密钥/API Key」，不是 Token Plan；且与 GroupId 同一账号",
                    },
                )
                continue

            if resp.status_code >= 400 or (status_code not in (None, 0)):
                msg = status_msg or data.get("message") or "语音合成失败"
                return err_tts(
                    code="TTS_UPSTREAM_ERROR",
                    message=str(msg),
                    retryable=True,
                    latency_ms=latency_ms,
                    details={"httpStatus": resp.status_code, "baseResp": base_resp, "base": base},
                )

            audio_bytes = _extract_audio_bytes(data)
            if not audio_bytes:
                audio_url = _extract_audio_url(data)
                if audio_url:
                    return ok_tts(
                        audio_url=audio_url,
                        cache_hit=False,
                        request_id=str(data.get("trace_id") or cache_key),
                        latency_ms=latency_ms,
                    )
                return err_tts(
                    code="TTS_UPSTREAM_ERROR",
                    message="未获得音频数据",
                    retryable=True,
                    latency_ms=latency_ms,
                    details={"keys": list(data.keys()), "base": base},
                )

            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(audio_bytes)
            return ok_tts(
                audio_url=f"/api/tts/audio/{cache_key}.mp3",
                cache_hit=False,
                request_id=str(data.get("trace_id") or cache_key),
                latency_ms=latency_ms,
            )

        return last_err or err_tts(
            code="TTS_UPSTREAM_ERROR",
            message="invalid api key",
            retryable=True,
        )


def _candidate_bases() -> list[str]:
    custom = _clean_env("MINIMAX_API_BASE")
    region = (_clean_env("MINIMAX_REGION") or "cn").lower()
    ordered: list[str] = []
    if custom:
        ordered.append(custom.rstrip("/"))
    if region in {"intl", "io", "global"}:
        ordered.append(INTL_BASE)
    ordered.extend(CN_BASES)
    # 去重并保持顺序
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
