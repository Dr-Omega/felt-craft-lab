"""
统一 AI 服务后端（安全代理 / 远端 AI Gateway）

Electron 正式链路：Renderer → Preload/Main → 本 Gateway（开发 localhost / 正式远端）。
动态 TTS 返回 audioBase64；Main 写入 userData 并转成 felt-resource://audio/dynamic/...。
不承载 Electron 安装包内 Python sidecar；密钥仅留在本服务端。
"""

from __future__ import annotations

import os
from pathlib import Path
import base64

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import RequestEntityTooLarge

from providers.asr.qwen_cloud_http import SAMPLE_AUDIO_URL
from providers.tts.minimax_provider import CACHE_DIR
from services.abuse_limits import (
    check_install_rate_limit,
    consume_paid_provider_call,
    token_issue_ok,
)
from services.asr_metrics import summarize_asr_metrics
from services.asr_service import AsrService, UnknownAsrProvider
from services.asr_types import contract_doc
from services.guards import (
    InflightGuard,
    MAX_AUDIO_BYTES,
    asr_provider_allowed,
    check_audio_mime,
    check_audio_size,
    check_qa_text,
    check_intent_text,
    check_tts_text,
    is_dev_mode,
    qa_provider_allowed,
    rate_limit_ok,
    smoke_allowed,
    image_provider_allowed,
    check_image_prompt,
    tts_provider_allowed,
)
from services.ops_rules import ops_rules_doc
from services.qa_service import QaService, UnknownQaProvider
from services.intent_service import IntentService, UnknownIntentProvider
from services.qa_types import QA_ERROR_CODES
from services.session_auth import (
    is_valid_installation_id,
    issue_session_token,
    parse_bearer_token,
    session_secret_status,
    verify_session_token,
)
from services.shared_error_map import fail
from services.tts_cache import prune_tts_cache
from services.tts_service import TtsService, UnknownTtsProvider
from services.image_service import ImageService, UnknownImageProvider, finalize_image_bytes
from services.image_profiles import UnknownGenerationProfile, resolve_generation_profile
from services.style_reference_sets import StyleReferenceSetError, reference_set_summary
from services.image_types import IMAGE_ERROR_CODES
from services.tts_types import TTS_ERROR_CODES

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
load_dotenv(BASE_DIR / ".env")

# Hard request-body cap (multipart parse included). Slightly above MAX_AUDIO_BYTES.
_MAX_CONTENT_LENGTH = int(os.getenv("AI_MAX_CONTENT_LENGTH", str(MAX_AUDIO_BYTES + 512 * 1024)))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = _MAX_CONTENT_LENGTH

# JSON audioUrl is not a general client feature — only allowlisted smoke sample.
_ALLOWED_ASR_AUDIO_URLS = frozenset({SAMPLE_AUDIO_URL})

SAMPLE_ASSET = {
    "assetId": "sticker_rabbit_demo",
    "nameZh": "小兔子",
    "introZh": "圆耳朵、短尾巴的可爱兔子贴纸，适合春天和不织布贴画。",
    "themeId": "nature_spring",
}


def _configured(value: str | None) -> bool:
    return bool((value or "").strip())


def _asr_key() -> str:
    return (
        os.getenv("QWEN_ASR_API_KEY", "").strip()
        or os.getenv("DASHSCOPE_API_KEY", "").strip()
    )


def _image_key() -> str:
    return (
        os.getenv("DASHSCOPE_API_KEY", "").strip()
        or os.getenv("QWEN_ASR_API_KEY", "").strip()
    )


def _selected_image_provider() -> str:
    try:
        return resolve_generation_profile("core_pattern").provider
    except UnknownGenerationProfile:
        return (os.getenv("IMAGE_PROVIDER") or "mock").strip()


def _image_profile_health() -> dict[str, object]:
    try:
        profile = resolve_generation_profile("core_pattern")
        return {"profileId": profile.profile_id, **reference_set_summary(profile.reference_set_id)}
    except (UnknownGenerationProfile, StyleReferenceSetError):
        return {"profileId": "unavailable", "referenceSetId": "unavailable", "referenceCount": 0}


def _selected_intent_provider() -> str:
    return (os.getenv("INTENT_PROVIDER") or os.getenv("QA_PROVIDER") or "deepseek").strip()


def _client_bucket() -> str:
    # Do not trust X-Forwarded-For unless a trusted proxy layer is explicitly configured later.
    return (request.remote_addr or "local").strip()


def _json_fail(code: str, http_status: int = 400):
    body = fail(code=code)
    return jsonify(body), http_status


def _require_session(*, apply_install_rate: bool = True):
    """
    校验短期 Session Token（防滥用，非正式账号体系）。
    鉴权通过后可选记入单实例防刷限流；不在此消费全局付费保险丝。
    """
    token = parse_bearer_token(request.headers.get("Authorization"))
    if not token:
        return None, _json_fail("SESSION_MISSING", 401)
    install_hdr = (request.headers.get("X-Felt-Installation-Id") or "").strip()
    if not is_valid_installation_id(install_hdr):
        return None, _json_fail("SESSION_INVALID", 401)
    claims = verify_session_token(
        token,
        expected_installation_id=install_hdr,
    )
    if not claims:
        return None, _json_fail("SESSION_INVALID", 401)
    if apply_install_rate:
        limited = check_install_rate_limit(claims.installation_id)
        if limited:
            return None, _json_fail(limited, 429)
    return claims, None


def _consume_paid_fuse(installation_id: str):
    """即将调用真实付费 Provider 前消费全局保险丝。"""
    fuse = consume_paid_provider_call(installation_id)
    if fuse:
        return _json_fail(fuse, 429)
    return None


def _is_mock_provider(name: str) -> bool:
    return (name or "").strip().lower() == "mock"


@app.errorhandler(RequestEntityTooLarge)
def _payload_too_large(_err):
    return _json_fail("PAYLOAD_TOO_LARGE", 413)


@app.post("/api/session/token")
def session_token():
    """客户端自动申请短期 Session Token（installationId 标识安装实例）。"""
    if not token_issue_ok(f"token:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    data = request.get_json(silent=True) or {}
    installation_id = str(data.get("installationId") or "").strip()
    if not is_valid_installation_id(installation_id):
        return _json_fail("INVALID_ARGUMENT")
    # 额外按 installation 防刷签发
    if not token_issue_ok(f"token-install:{installation_id.lower()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        issued = issue_session_token(installation_id)
    except ValueError:
        return _json_fail("INVALID_ARGUMENT")
    except RuntimeError:
        return _json_fail("UNKNOWN", 503)
    return jsonify({"ok": True, "result": issued})


def _resolve_asr(provider: str | None) -> AsrService | tuple:
    name = (provider or os.getenv("QWEN_ASR_PROVIDER") or "qwen_cloud_http").strip()
    if not asr_provider_allowed(name):
        return _json_fail("INVALID_PROVIDER")
    try:
        return AsrService(name)
    except UnknownAsrProvider:
        return _json_fail("INVALID_PROVIDER")


@app.get("/api/health")
def health():
    env = (os.getenv("APP_ENV") or "").strip() or "unset"
    return jsonify(
        {
            "ok": True,
            "service": "felt-craft-lab-ai-proxy",
            "version": "review-fix-2",
            "env": env,
            "devMode": is_dev_mode(),
            "keysConfigured": {
                "qwen_asr": _configured(_asr_key()),
                "deepseek": _configured(os.getenv("DEEPSEEK_API_KEY")),
                "minimax": _configured(os.getenv("MINIMAX_API_KEY"))
                and _configured(os.getenv("MINIMAX_GROUP_ID")),
                "dashscope": _configured(_image_key()),
                "seedreamArk": _configured(os.getenv("ARK_API_KEY")),
                # No cloud key; true when URL is set or sd_local is the selected provider.
                "sdLocal": _configured(os.getenv("SD_LOCAL_BASE_URL"))
                or _selected_image_provider() == "sd_local",
                "sessionHmac": session_secret_status()["configured"],
            },
            "selected": {
                "image": _selected_image_provider(),
                "intent": _selected_intent_provider(),
            },
            "providers": {
                "asr": ["qwen_cloud_http", "qwen_cloud_realtime", "qwen_local"]
                + (["mock"] if is_dev_mode() else []),
                "qa": ["deepseek"] + (["mock"] if is_dev_mode() else []),
                "intent": ["deepseek"] + (["mock"] if is_dev_mode() else []),
                "tts": ["minimax"] + (["mock"] if is_dev_mode() else []),
                "image": ["wan_dashscope", "sd_local", "seedream_ark"] + (["mock"] if is_dev_mode() else []),
            },
            "imageProfile": _image_profile_health(),
        }
    )


@app.get("/api/ready")
def ready():
    session = session_secret_status()
    asr_ok = _configured(_asr_key())
    qa_ok = _configured(os.getenv("DEEPSEEK_API_KEY"))
    tts_ok = _configured(os.getenv("MINIMAX_API_KEY")) and _configured(
        os.getenv("MINIMAX_GROUP_ID")
    )
    # Explicit dev may run mock without provider keys; production needs session + keys.
    if is_dev_mode():
        overall = bool(session["usable"])
        asr_flag = True
        qa_flag = True
        tts_flag = True
    else:
        overall = bool(session["usable"] and asr_ok and qa_ok and tts_ok)
        asr_flag = asr_ok
        qa_flag = qa_ok
        tts_flag = tts_ok
    body = {
        "ready": overall,
        "sessionAuth": bool(session["usable"]),
        "asr": asr_flag,
        "qa": qa_flag,
        "tts": tts_flag,
        "audioService": True,
        "animationService": True,
        "contractsAligned": True,
    }
    return jsonify(body), (200 if overall else 503)


@app.get("/api/ops/rules")
def ops_rules():
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    _ = claims
    return jsonify({"ok": True, "rules": ops_rules_doc()})


@app.get("/api/asr/contract")
def asr_contract():
    return jsonify({"ok": True, "contract": contract_doc()})


@app.get("/api/asr/metrics")
def asr_metrics():
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    _ = claims
    return jsonify({"ok": True, "metrics": summarize_asr_metrics()})


@app.post("/api/asr/transcribe")
def asr_transcribe():
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err

    try:
        with InflightGuard():
            if request.content_type and "multipart/form-data" in request.content_type:
                language = request.form.get("language") or None
                session_id = request.form.get("sessionId") or None
                provider_override = request.form.get("provider") or None
                f = request.files.get("file") or request.files.get("audio")
                if not f:
                    return _json_fail("ASR_MISSING_AUDIO")
                mime_type = f.mimetype or "audio/wav"
                bad_mime = check_audio_mime(mime_type)
                if bad_mime:
                    return _json_fail(bad_mime)
                audio_bytes = f.read(MAX_AUDIO_BYTES + 1)
                size_err = check_audio_size(len(audio_bytes))
                if size_err:
                    return _json_fail(size_err)
                resolved = _resolve_asr(provider_override)
                if not isinstance(resolved, AsrService):
                    return resolved
                limited = check_install_rate_limit(claims.installation_id)
                if limited:
                    return _json_fail(limited, 429)
                if not rate_limit_ok(f"asr:{_client_bucket()}"):
                    return _json_fail("RATE_LIMITED", 429)
                provider_name = getattr(resolved.provider, "name", "") or (
                    provider_override or os.getenv("QWEN_ASR_PROVIDER") or "qwen_cloud_http"
                )
                if not _is_mock_provider(str(provider_name)):
                    fuse_err = _consume_paid_fuse(claims.installation_id)
                    if fuse_err:
                        return fuse_err
                result = resolved.transcribe(
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
                return _json_fail("ASR_MISSING_AUDIO")
            # Reject arbitrary client URLs to paid ASR; multipart upload is the real path.
            if not smoke_allowed() or str(audio_url).strip() not in _ALLOWED_ASR_AUDIO_URLS:
                return _json_fail("INVALID_ARGUMENT")
            resolved = _resolve_asr(provider_override)
            if not isinstance(resolved, AsrService):
                return resolved
            limited = check_install_rate_limit(claims.installation_id)
            if limited:
                return _json_fail(limited, 429)
            if not rate_limit_ok(f"asr:{_client_bucket()}"):
                return _json_fail("RATE_LIMITED", 429)
            provider_name = getattr(resolved.provider, "name", "") or (
                provider_override or os.getenv("QWEN_ASR_PROVIDER") or "qwen_cloud_http"
            )
            if not _is_mock_provider(str(provider_name)):
                fuse_err = _consume_paid_fuse(claims.installation_id)
                if fuse_err:
                    return fuse_err
            result = resolved.transcribe(
                audio_url=audio_url,
                language=language,
                session_id=session_id,
            )
            status = 200 if result.get("ok") else 502
            return jsonify(result), status
    except TimeoutError:
        return _json_fail("RATE_LIMITED", 429)


@app.post("/api/asr/smoke-test")
def asr_smoke_test():
    if not smoke_allowed():
        return _json_fail("SMOKE_DISABLED", 403)
    claims, err = _require_session(apply_install_rate=True)
    if err:
        return err
    if not rate_limit_ok(f"smoke:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        with InflightGuard():
            fuse_err = _consume_paid_fuse(claims.installation_id)
            if fuse_err:
                return fuse_err
            service = AsrService("qwen_cloud_http")
            result = service.transcribe(audio_url=SAMPLE_AUDIO_URL, session_id="smoke-test")
            status = 200 if result.get("ok") else 502
            return jsonify({"smokeTest": True, **result}), status
    except (UnknownAsrProvider, TimeoutError):
        return _json_fail("SMOKE_DISABLED", 403)


@app.get("/api/asr/mock")
def asr_mock():
    if not is_dev_mode():
        return _json_fail("SMOKE_DISABLED", 403)
    result = AsrService("mock").transcribe(audio_url="mock://local")
    return jsonify(result)


@app.post("/api/qa/ask")
def qa_ask():
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    question = data.get("question") or ""
    asset = data.get("asset") or {}
    provider = data.get("provider")
    text_err = check_qa_text(question)
    if text_err:
        return _json_fail(text_err)
    resolved_name = (provider or os.getenv("QA_PROVIDER") or "deepseek").strip()
    if not qa_provider_allowed(resolved_name):
        return _json_fail("INVALID_PROVIDER")
    limited = check_install_rate_limit(claims.installation_id)
    if limited:
        return _json_fail(limited, 429)
    if not rate_limit_ok(f"qa:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        with InflightGuard():
            if not _is_mock_provider(resolved_name):
                fuse_err = _consume_paid_fuse(claims.installation_id)
                if fuse_err:
                    return fuse_err
            service = QaService(resolved_name)
            result = service.ask(question=question, asset=asset)
            status = 200 if result.get("ok") else 502
            return jsonify(result), status
    except UnknownQaProvider:
        return _json_fail("INVALID_PROVIDER")
    except TimeoutError:
        return _json_fail("RATE_LIMITED", 429)


@app.post("/api/qa/smoke-test")
def qa_smoke_test():
    if not smoke_allowed():
        return _json_fail("SMOKE_DISABLED", 403)
    claims, err = _require_session(apply_install_rate=True)
    if err:
        return err
    try:
        with InflightGuard():
            fuse_err = _consume_paid_fuse(claims.installation_id)
            if fuse_err:
                return fuse_err
            result = QaService("deepseek").ask(
                question="小兔子贴纸可以怎么用在不织布手工里？",
                asset=SAMPLE_ASSET,
            )
            status = 200 if result.get("ok") else 502
            return jsonify({"smokeTest": True, **result}), status
    except UnknownQaProvider:
        return _json_fail("INVALID_PROVIDER")


@app.get("/api/qa/mock")
def qa_mock():
    if not is_dev_mode():
        return _json_fail("SMOKE_DISABLED", 403)
    result = QaService("mock").ask(question="这是什么？", asset=SAMPLE_ASSET)
    return jsonify(result)


@app.get("/api/qa/contract")
def qa_contract():
    return jsonify(
        {
            "ok": True,
            "contract": {
                "resultContract": "src/shared/contracts/ai.ts QaResult",
                "errorContract": "src/shared/contracts/error.ts SharedError",
            },
            "errorCodes": QA_ERROR_CODES,
        }
    )


@app.post("/api/creation-intent/parse")
def creation_intent_parse():
    """Spoken Chinese → GenerationSpec patch. Never Prompt or Provider fields."""
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    text = data.get("text") or ""
    locked_role = data.get("lockedRole") or data.get("locked_role") or None
    pending_field = data.get("pendingField") or data.get("pending_field") or None
    if locked_role is not None:
        locked_role = str(locked_role).strip() or None
        if locked_role not in {"core_pattern", "element", "background"}:
            return _json_fail("INVALID_ARGUMENT")
    if pending_field is not None:
        pending_field = str(pending_field).strip() or None
        if pending_field and len(pending_field) > 64:
            return _json_fail("INVALID_ARGUMENT")
    provider = data.get("provider")
    text_err = check_intent_text(str(text))
    if text_err:
        return _json_fail(text_err)
    resolved_name = (provider or _selected_intent_provider()).strip()
    if not qa_provider_allowed(resolved_name):
        return _json_fail("INVALID_PROVIDER")
    limited = check_install_rate_limit(claims.installation_id)
    if limited:
        return _json_fail(limited, 429)
    if not rate_limit_ok(f"intent:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        with InflightGuard():
            if not _is_mock_provider(resolved_name):
                fuse_err = _consume_paid_fuse(claims.installation_id)
                if fuse_err:
                    return fuse_err
            result = IntentService(resolved_name).parse(
                text=str(text),
                locked_role=locked_role,
                pending_field=pending_field,
            )
            if result.get("ok"):
                return jsonify(result), 200
            # Content policy blocks stay 200 + ok:false so clients can read QA_BLOCKED
            # without treating the call as an upstream outage (which triggers local fallback).
            err_code = ((result.get("error") or {}) if isinstance(result.get("error"), dict) else {}).get(
                "code"
            )
            status = 200 if err_code == "QA_BLOCKED" else 502
            return jsonify(result), status
    except UnknownIntentProvider:
        return _json_fail("INVALID_PROVIDER")
    except TimeoutError:
        return _json_fail("RATE_LIMITED", 429)


@app.post("/api/tts/synthesize")
def tts_synthesize():
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    text = data.get("text") or ""
    purpose = data.get("voicePurpose") or data.get("voice_purpose") or "qa_answer"
    provider = data.get("provider")
    text_err = check_tts_text(text)
    if text_err:
        return _json_fail(text_err)
    resolved_name = (provider or os.getenv("TTS_PROVIDER") or "minimax").strip()
    if not tts_provider_allowed(resolved_name):
        return _json_fail("INVALID_PROVIDER")
    limited = check_install_rate_limit(claims.installation_id)
    if limited:
        return _json_fail(limited, 429)
    if not rate_limit_ok(f"tts:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        with InflightGuard():
            if not _is_mock_provider(resolved_name):
                fuse_err = _consume_paid_fuse(claims.installation_id)
                if fuse_err:
                    return fuse_err
            service = TtsService(resolved_name)
            result = service.synthesize(text=text, voice_purpose=purpose)
            status = 200 if result.get("ok") else 502
            return jsonify(result), status
    except UnknownTtsProvider:
        return _json_fail("INVALID_PROVIDER")
    except TimeoutError:
        return _json_fail("RATE_LIMITED", 429)


@app.post("/api/tts/smoke-test")
def tts_smoke_test():
    if not smoke_allowed():
        return _json_fail("SMOKE_DISABLED", 403)
    claims, err = _require_session(apply_install_rate=True)
    if err:
        return err
    sample = "小兔子贴纸很适合春天的不织布手工，我们一起贴一贴吧。"
    try:
        with InflightGuard():
            fuse_err = _consume_paid_fuse(claims.installation_id)
            if fuse_err:
                return fuse_err
            result = TtsService("minimax").synthesize(text=sample, voice_purpose="qa_answer")
            status = 200 if result.get("ok") else 502
            return jsonify({"smokeTest": True, **result}), status
    except UnknownTtsProvider:
        return _json_fail("INVALID_PROVIDER")


@app.get("/api/tts/mock")
def tts_mock():
    if not is_dev_mode():
        return _json_fail("SMOKE_DISABLED", 403)
    result = TtsService("mock").synthesize(text="mock", voice_purpose="qa_answer")
    return jsonify(result)


@app.get("/api/tts/audio/<path:filename>")
def tts_audio(filename: str):
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    _ = claims
    safe = Path(filename).name
    if not safe.endswith(".mp3"):
        return _json_fail("TTS_BAD_FILE")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    prune_tts_cache(CACHE_DIR)
    path = CACHE_DIR / safe
    if not path.exists():
        return _json_fail("TTS_NOT_FOUND", 404)
    return send_from_directory(CACHE_DIR, safe, mimetype="audio/mpeg")


@app.get("/api/tts/contract")
def tts_contract():
    return jsonify(
        {
            "ok": True,
            "contract": {
                "gatewayWire": "dynamic TTS returns audioBase64; Electron Main materializes felt-resource://audio/dynamic/<hash>.mp3",
                "rendererContract": "src/shared/contracts/ai.ts TtsResult (ResourceRef audioUrl)",
                "errorContract": "src/shared/contracts/error.ts SharedError",
                "onFailure": "keep_text_only",
            },
            "errorCodes": TTS_ERROR_CODES,
        }
    )


@app.post("/api/image/generate")
def image_generate():
    """Canonical Prompt → mock/cloud image. Returns imageBase64; Main writes preview."""
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _json_fail("INVALID_ARGUMENT")
    # System reference/profile/prompt policy must never cross the Main/Renderer
    # boundary. `provider` remains a legacy development-only compatibility hook.
    forbidden = {"referenceImages", "reference_images", "profileId", "profile_id", "systemPrompt", "system_prompt", "model"}
    if forbidden.intersection(data):
        return _json_fail("INVALID_ARGUMENT")
    positive = data.get("positivePrompt") or data.get("positive_prompt") or ""
    negative = data.get("negativePrompt") or data.get("negative_prompt") or ""
    provider = data.get("provider")
    width = data.get("width", 512)
    height = data.get("height", 512)
    prompt_err = check_image_prompt(str(positive))
    if prompt_err:
        return _json_fail(prompt_err)
    asset_role = str(data.get("assetRole") or data.get("asset_role") or "core_pattern")
    if provider:
        if not is_dev_mode():
            return _json_fail("INVALID_PROVIDER")
        resolved_name = str(provider).strip()
    else:
        try:
            resolved_name = resolve_generation_profile(asset_role).provider
        except UnknownGenerationProfile:
            return _json_fail("IMAGE_PROFILE_UNAVAILABLE")
    if not image_provider_allowed(resolved_name):
        return _json_fail("INVALID_PROVIDER")
    limited = check_install_rate_limit(claims.installation_id)
    if limited:
        return _json_fail(limited, 429)
    if not rate_limit_ok(f"image:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        with InflightGuard():
            # Local SD uses the user's GPU — do not consume the paid-API fuse.
            if not _is_mock_provider(resolved_name) and resolved_name != "sd_local":
                fuse_err = _consume_paid_fuse(claims.installation_id)
                if fuse_err:
                    return fuse_err
            try:
                w = int(width)
                h = int(height)
            except (TypeError, ValueError):
                return _json_fail("INVALID_ARGUMENT")
            service = ImageService(resolved_name) if provider else ImageService()
            result = service.generate(
                positive_prompt=str(positive),
                negative_prompt=str(negative),
                width=w,
                height=h,
                asset_role=asset_role,
                request_id=(data.get("requestId") or data.get("request_id") or ""),
            )
            status = 200 if result.get("ok") else 502
            return jsonify(result), status
    except UnknownImageProvider:
        return _json_fail("INVALID_PROVIDER")
    except TimeoutError:
        return _json_fail("RATE_LIMITED", 429)


@app.post("/api/image/finalize")
def image_finalize():
    """Normalize PNG + felt quality gate. Used after generate or local mock."""
    claims, err = _require_session(apply_install_rate=False)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    encoded = (data.get("imageBase64") or data.get("image_base64") or "").strip()
    if not encoded:
        return _json_fail("INVALID_ARGUMENT")
    try:
        w = int(data.get("width", 512))
        h = int(data.get("height", 512))
    except (TypeError, ValueError):
        return _json_fail("INVALID_ARGUMENT")
    asset_role = str(data.get("assetRole") or data.get("asset_role") or "core_pattern")
    limited = check_install_rate_limit(claims.installation_id)
    if limited:
        return _json_fail(limited, 429)
    if not rate_limit_ok(f"image-finalize:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)
    try:
        image_bytes = base64.b64decode(encoded)
    except Exception:  # noqa: BLE001
        return _json_fail("INVALID_ARGUMENT")
    if not image_bytes.startswith(b"\x89PNG"):
        return _json_fail("INVALID_ARGUMENT")
    try:
        with InflightGuard():
            result = finalize_image_bytes(
                image_bytes,
                width=w,
                height=h,
                asset_role=asset_role,
                request_id=str(data.get("requestId") or data.get("request_id") or ""),
                provider=str(data.get("provider") or "local"),
            )
            status = 200 if result.get("ok") else 502
            return jsonify(result), status
    except TimeoutError:
        return _json_fail("RATE_LIMITED", 429)


@app.get("/api/image/contract")
def image_contract():
    return jsonify(
        {
            "ok": True,
            "contract": {
                "gatewayWire": "generate/finalize return imageBase64 + quality; Electron Main materializes preview",
                "rendererContract": "src/shared/contracts/generation-candidate.ts GenerationCandidate",
                "errorContract": "src/shared/contracts/error.ts SharedError",
            },
            "errorCodes": IMAGE_ERROR_CODES,
        }
    )


@app.get("/demo/audio")
def demo_audio_page():
    return send_from_directory(ROOT_DIR / "frontend" / "demos", "audio-demo.html")


@app.get("/demo/animation")
def demo_animation_page():
    return send_from_directory(ROOT_DIR / "frontend" / "demos", "animation-demo.html")


@app.get("/demo/fixed-audio")
def demo_fixed_audio_page():
    return send_from_directory(ROOT_DIR / "frontend" / "demos", "fixed-audio-demo.html")


@app.get("/generated-audio/<path:filename>")
def generated_audio_static(filename: str):
    folder = ROOT_DIR / "assets" / "generated" / "audio"
    folder.mkdir(parents=True, exist_ok=True)
    rel = filename.replace("\\", "/")
    if ".." in rel.split("/"):
        return _json_fail("INVALID_ARGUMENT")
    return send_from_directory(folder, rel)


@app.get("/fixed-audio/<path:filename>")
def fixed_audio_deprecated(filename: str):
    folder = ROOT_DIR / "assets" / "generated" / "audio"
    folder.mkdir(parents=True, exist_ok=True)
    return send_from_directory(folder, Path(filename).name)


@app.get("/frontend/<path:filename>")
def frontend_static(filename: str):
    return send_from_directory(ROOT_DIR / "frontend", filename)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8788"))
    # Fail-closed: debug only when APP_ENV is an explicit development value.
    app.run(host="127.0.0.1", port=port, debug=is_dev_mode())
