"""
统一 AI 服务后端（安全代理）

第 1 步：健康检查
第 2 步：Qwen3-ASR-Flash 云端 HTTP 识别 + Provider 抽象 + Mock
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from providers.asr.qwen_cloud_http import SAMPLE_AUDIO_URL
from services.asr_service import AsrService

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)
asr_service = AsrService()


def _mask(value: str | None) -> str:
    if not value:
        return "missing"
    if len(value) <= 8:
        return "set"
    return f"set({value[:2]}***{value[-2:]})"


def _asr_key() -> str:
    return (
        os.getenv("QWEN_ASR_API_KEY", "").strip()
        or os.getenv("DASHSCOPE_API_KEY", "").strip()
    )


@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "felt-craft-lab-ai-proxy",
            "version": "step2",
            "env": os.getenv("APP_ENV", "development"),
            "keys": {
                "qwen_asr": _mask(_asr_key()),
                "deepseek": _mask(os.getenv("DEEPSEEK_API_KEY")),
                "minimax": _mask(os.getenv("MINIMAX_API_KEY")),
            },
            "providers_ready": {
                "asr": ["qwen_cloud_http", "mock"],
                "asr_reserved": ["qwen_cloud_realtime", "qwen_local"],
                "qa": ["deepseek"],
                "tts": ["minimax"],
            },
        }
    )


@app.get("/api/ready")
def ready():
    return jsonify({"ready": True, "step": 2, "asr": True})


@app.post("/api/asr/transcribe")
def asr_transcribe():
    """
    SXY 调用入口：
    - multipart: file=<音频>
    - 或 JSON: { "audioUrl": "https://...", "language": "zh", "sessionId": "..." }
    """
    language = None
    session_id = None
    provider_override = None

    if request.content_type and "multipart/form-data" in request.content_type:
        language = request.form.get("language") or None
        session_id = request.form.get("sessionId") or None
        provider_override = request.form.get("provider") or None
        f = request.files.get("file") or request.files.get("audio")
        if not f:
            return jsonify(
                {
                    "ok": False,
                    "error": {
                        "code": "ASR_MISSING_AUDIO",
                        "message": "请用 multipart 字段 file 上传音频",
                        "retryable": False,
                    },
                }
            ), 400
        audio_bytes = f.read()
        mime_type = f.mimetype or "audio/wav"
        service = AsrService(provider_override) if provider_override else asr_service
        result = service.transcribe(
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            language=language,
            session_id=session_id,
        )
        status = 200 if result.get("ok") else 502
        return jsonify(result), status

    data = request.get_json(silent=True) or {}
    language = data.get("language")
    session_id = data.get("sessionId")
    provider_override = data.get("provider")
    audio_url = data.get("audioUrl") or data.get("audio_url")
    if not audio_url:
        return jsonify(
            {
                "ok": False,
                "error": {
                    "code": "ASR_MISSING_AUDIO",
                    "message": "请提供 audioUrl，或改用 multipart 上传 file",
                    "retryable": False,
                },
            }
        ), 400

    service = AsrService(provider_override) if provider_override else asr_service
    result = service.transcribe(
        audio_url=audio_url,
        language=language,
        session_id=session_id,
    )
    status = 200 if result.get("ok") else 502
    return jsonify(result), status


@app.get("/api/asr/smoke-test")
def asr_smoke_test():
    """
    一键冒烟测试：用官方示例音频调用 qwen3-asr-flash。
    浏览器直接打开即可，方便验收第 2 步。
    """
    result = asr_service.transcribe(audio_url=SAMPLE_AUDIO_URL, session_id="smoke-test")
    status = 200 if result.get("ok") else 502
    return jsonify(
        {
            "smokeTest": True,
            "sampleAudioUrl": SAMPLE_AUDIO_URL,
            **result,
        }
    ), status


@app.get("/api/asr/mock")
def asr_mock():
    """给 SXY 的假数据，不消耗云端额度。"""
    result = AsrService("mock").transcribe(audio_url="mock://local")
    return jsonify(result)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8788"))
    app.run(host="127.0.0.1", port=port, debug=True)
