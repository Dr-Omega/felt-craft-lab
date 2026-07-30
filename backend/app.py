"""
统一 AI 服务后端（安全代理）

第 1 步：健康检查
第 2 步：Qwen3-ASR-Flash 云端 HTTP
第 3 步：统一输出格式 + 错误码 + P50/P95 统计
第 4 步：DeepSeek 儿童适龄问答
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from providers.asr.qwen_cloud_http import SAMPLE_AUDIO_URL
from services.asr_errors import list_error_codes
from services.asr_metrics import summarize_asr_metrics
from services.asr_service import AsrService
from services.asr_types import contract_doc
from services.qa_service import QaService
from services.qa_types import QA_ERROR_CODES

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)
asr_service = AsrService()
qa_service = QaService()

SAMPLE_ASSET = {
    "assetId": "sticker_rabbit_demo",
    "nameZh": "小兔子",
    "introZh": "圆耳朵、短尾巴的可爱兔子贴纸，适合春天和不织布贴画。",
    "themeId": "nature_spring",
}


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
            "version": "step4",
            "env": os.getenv("APP_ENV", "development"),
            "keys": {
                "qwen_asr": _mask(_asr_key()),
                "deepseek": _mask(os.getenv("DEEPSEEK_API_KEY")),
                "minimax": _mask(os.getenv("MINIMAX_API_KEY")),
            },
            "providers_ready": {
                "asr": ["qwen_cloud_http", "mock"],
                "asr_reserved": ["qwen_cloud_realtime", "qwen_local"],
                "qa": ["deepseek", "mock"],
                "tts": ["minimax"],
            },
        }
    )


@app.get("/api/ready")
def ready():
    return jsonify({"ready": True, "step": 4, "asr": True, "qa": True})


@app.get("/api/asr/contract")
def asr_contract():
    return jsonify(
        {
            "ok": True,
            "contract": contract_doc(),
            "errorCodes": list_error_codes(),
        }
    )


@app.get("/api/asr/metrics")
def asr_metrics():
    return jsonify({"ok": True, "metrics": summarize_asr_metrics()})


@app.post("/api/asr/transcribe")
def asr_transcribe():
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
                    "provider": "qwen_cloud_http",
                    "error": {
                        "code": "ASR_MISSING_AUDIO",
                        "message": "请用 multipart 字段 file 上传音频",
                        "retryable": False,
                    },
                    "latencyMs": 0,
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
                "provider": "qwen_cloud_http",
                "error": {
                    "code": "ASR_MISSING_AUDIO",
                    "message": "请提供 audioUrl，或改用 multipart 上传 file",
                    "retryable": False,
                },
                "latencyMs": 0,
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
    result = AsrService("mock").transcribe(audio_url="mock://local")
    return jsonify(result)


@app.post("/api/qa/ask")
def qa_ask():
    """
    SXY 调用：
    {
      "question": "小兔子喜欢吃什么？",
      "asset": { "assetId": "...", "nameZh": "...", "introZh": "...", "themeId": "..." },
      "provider": "deepseek" | "mock"  // 可选
    }
    """
    data = request.get_json(silent=True) or {}
    question = data.get("question") or ""
    asset = data.get("asset") or {}
    provider = data.get("provider")
    service = QaService(provider) if provider else qa_service
    result = service.ask(question=question, asset=asset)
    status = 200 if result.get("ok") else 502
    return jsonify(result), status


@app.get("/api/qa/smoke-test")
def qa_smoke_test():
    """浏览器一键测试 DeepSeek 问答。"""
    result = qa_service.ask(
        question="小兔子贴纸可以怎么用在不织布手工里？",
        asset=SAMPLE_ASSET,
    )
    status = 200 if result.get("ok") else 502
    return jsonify(
        {
            "smokeTest": True,
            "sampleAsset": SAMPLE_ASSET,
            "sampleQuestion": "小兔子贴纸可以怎么用在不织布手工里？",
            **result,
        }
    ), status


@app.get("/api/qa/mock")
def qa_mock():
    result = QaService("mock").ask(
        question="这是什么？",
        asset=SAMPLE_ASSET,
    )
    return jsonify(result)


@app.get("/api/qa/contract")
def qa_contract():
    return jsonify(
        {
            "ok": True,
            "contract": {
                "successShape": {
                    "ok": True,
                    "result": {
                        "answer": "string",
                        "safetyAction": "allow | redirect | reject",
                        "requestId": "string",
                        "latencyMs": "number",
                    },
                },
                "errorShape": {
                    "ok": False,
                    "error": {"code": "string", "message": "string", "retryable": "boolean"},
                    "latencyMs": "number",
                },
            },
            "errorCodes": QA_ERROR_CODES,
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8788"))
    app.run(host="127.0.0.1", port=port, debug=True)
