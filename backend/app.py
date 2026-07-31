"""
统一 AI 服务后端（安全代理）

第 1 步：健康检查
第 2 步：Qwen3-ASR-Flash 云端 HTTP
第 3 步：统一输出格式 + 错误码 + P50/P95 统计
第 4 步：DeepSeek 儿童适龄问答
第 5 步：MiniMax 动态 TTS + 哈希缓存
第 6 步：AudioService（Howler）演示页由后端托管
第 7 步：AnimationService（lottie-web）演示页由后端托管
第 8 步：SXY Mock / 对接文档（见 docs/ai-services/SXY对接指南.md）
第 9 步：固定文案 TTS 批量工具 + 音频快照索引
第 10 步：.env.example + 错误码 + 重试/降级规则
第 11 步：产品验收清单 + 开源许可 + 云服务记录
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from providers.asr.qwen_cloud_http import SAMPLE_AUDIO_URL
from services.asr_errors import list_error_codes
from services.asr_metrics import summarize_asr_metrics
from services.asr_service import AsrService
from services.asr_types import contract_doc
from services.qa_service import QaService
from services.qa_types import QA_ERROR_CODES
from services.tts_service import TtsService
from services.tts_types import TTS_ERROR_CODES
from services.ops_rules import ops_rules_doc
from providers.tts.minimax_provider import CACHE_DIR

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)
asr_service = AsrService()
qa_service = QaService()
tts_service = TtsService()

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
            "version": "step11",
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
                "tts": ["minimax", "mock"],
            },
        }
    )


@app.get("/api/ready")
def ready():
    return jsonify(
        {
            "ready": True,
            "step": 11,
            "asr": True,
            "qa": True,
            "tts": True,
            "audioService": True,
            "animationService": True,
            "fixedTtsBatch": True,
            "opsRules": True,
            "acceptanceDocs": True,
        }
    )


@app.get("/api/ops/rules")
def ops_rules():
    """第 10 步：错误码 + 重试/降级规则（给 SXY / 验收用）。"""
    return jsonify({"ok": True, "rules": ops_rules_doc()})


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


@app.post("/api/tts/synthesize")
def tts_synthesize():
    """
    SXY 调用：
    { "text": "要朗读的文字", "voicePurpose": "qa_answer", "provider": "minimax|mock" }
    """
    data = request.get_json(silent=True) or {}
    text = data.get("text") or ""
    purpose = data.get("voicePurpose") or data.get("voice_purpose") or "qa_answer"
    provider = data.get("provider")
    service = TtsService(provider) if provider else tts_service
    result = service.synthesize(text=text, voice_purpose=purpose)
    status = 200 if result.get("ok") else 502
    return jsonify(result), status


@app.get("/api/tts/smoke-test")
def tts_smoke_test():
    """浏览器一键测试 MiniMax TTS；成功后可用 audioUrl 播放。"""
    sample = "小兔子贴纸很适合春天的不织布手工，我们一起贴一贴吧。"
    result = tts_service.synthesize(text=sample, voice_purpose="qa_answer")
    status = 200 if result.get("ok") else 502
    return jsonify(
        {
            "smokeTest": True,
            "sampleText": sample,
            **result,
        }
    ), status


@app.get("/api/tts/mock")
def tts_mock():
    result = TtsService("mock").synthesize(text="mock", voice_purpose="qa_answer")
    return jsonify(result)


@app.get("/api/tts/audio/<path:filename>")
def tts_audio(filename: str):
    """提供缓存音频文件。"""
    from flask import send_from_directory

    safe = Path(filename).name
    if not safe.endswith(".mp3"):
        return jsonify({"ok": False, "error": {"code": "TTS_BAD_FILE", "message": "仅支持 mp3"}}), 400
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / safe
    if not path.exists():
        return jsonify({"ok": False, "error": {"code": "TTS_NOT_FOUND", "message": "音频不存在"}}), 404
    return send_from_directory(CACHE_DIR, safe, mimetype="audio/mpeg")


@app.get("/api/tts/mock-audio")
def tts_mock_audio():
    return jsonify(
        {
            "ok": True,
            "message": "这是 Mock 音频占位，不产生真实声音。正式环境请用 /api/tts/smoke-test",
        }
    )


@app.get("/api/tts/contract")
def tts_contract():
    return jsonify(
        {
            "ok": True,
            "contract": {
                "successShape": {
                    "ok": True,
                    "result": {
                        "audioUrl": "string 可播放地址",
                        "cacheHit": "boolean",
                        "requestId": "string",
                        "latencyMs": "number",
                    },
                },
                "onFailure": "keep_text_only（TTS 失败时页面仍显示文字回答）",
            },
            "errorCodes": TTS_ERROR_CODES,
        }
    )


@app.get("/demo/audio")
def demo_audio_page():
    """第 6 步：AudioService 浏览器演示页。"""
    return send_from_directory(ROOT_DIR / "frontend" / "demos", "audio-demo.html")


@app.get("/demo/animation")
def demo_animation_page():
    """第 7 步：AnimationService 浏览器演示页。"""
    return send_from_directory(ROOT_DIR / "frontend" / "demos", "animation-demo.html")


@app.get("/demo/fixed-audio")
def demo_fixed_audio_page():
    """固定语音快照试听页（浏览器辅助；Electron 正式用 felt-resource）。"""
    return send_from_directory(ROOT_DIR / "frontend" / "demos", "fixed-audio-demo.html")


@app.get("/generated-audio/<path:filename>")
def generated_audio_static(filename: str):
    """浏览器 demo 读取 assets/generated/audio（对应 felt-resource://audio/...）。"""
    folder = ROOT_DIR / "assets" / "generated" / "audio"
    folder.mkdir(parents=True, exist_ok=True)
    rel = filename.replace("\\", "/")
    if ".." in rel.split("/"):
        return jsonify(
            {"ok": False, "error": {"code": "INVALID_ARGUMENT", "message": "非法路径"}}
        ), 400
    return send_from_directory(folder, rel)


@app.get("/fixed-audio/<path:filename>")
def fixed_audio_deprecated(filename: str):
    """已弃用：兼容旧链接，改为从 generated/audio 提供。"""
    folder = ROOT_DIR / "assets" / "generated" / "audio"
    folder.mkdir(parents=True, exist_ok=True)
    safe = Path(filename).name
    return send_from_directory(folder, safe)


@app.get("/frontend/<path:filename>")
def frontend_static(filename: str):
    """提供 frontend 下的 JS/CSS，供 demo 引用。"""
    return send_from_directory(ROOT_DIR / "frontend", filename)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8788"))
    app.run(host="127.0.0.1", port=port, debug=True)
