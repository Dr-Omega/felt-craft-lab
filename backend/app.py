"""
统一 AI 服务后端（安全代理 / 远端 AI Gateway）

Electron 正式链路：Renderer → Preload/Main → 本 Gateway（开发 localhost / 正式远端）。
动态 TTS 返回 audioBase64；Main 写入 userData 并转成 felt-resource://audio/dynamic/...。
不承载 Electron 安装包内 Python sidecar；密钥仅留在本服务端。
"""

from __future__ import annotations

import os
from pathlib import Path

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
    MAX_IMAGE_BYTES,
    asr_provider_allowed,
    check_audio_mime,
    check_audio_size,
    check_qa_text,
    check_tts_text,
    is_dev_mode,
    qa_provider_allowed,
    rate_limit_ok,
    smoke_allowed,
    tts_provider_allowed,
)
from services.image_upload import ImageUploadError, save_uploaded_image
from services.plaza_auth import (
    authenticate_user,
    issue_user_token,
    parse_bearer_user_token,
    register_user,
    validate_password,
    validate_username,
    verify_user_token,
)
from services.plaza_db import PlazaDb
from services.plaza_dev_seed import seed_plaza_demo_posts, seed_plaza_dev_users
from services.plaza_posts import PLAZA_UPLOAD_DIR_NAME, post_public_dict, publish_post
from services.ops_rules import ops_rules_doc
from services.qa_service import QaService, UnknownQaProvider
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
from services.tts_types import TTS_ERROR_CODES

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
load_dotenv(BASE_DIR / ".env")

# Hard request-body cap (multipart parse included).
_MAX_CONTENT_LENGTH = int(
    os.getenv("AI_MAX_CONTENT_LENGTH", str(max(MAX_AUDIO_BYTES, MAX_IMAGE_BYTES) + 512 * 1024))
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = _MAX_CONTENT_LENGTH

# JSON audioUrl is not a general client feature — only allowlisted smoke sample.
_ALLOWED_ASR_AUDIO_URLS = frozenset({SAMPLE_AUDIO_URL})
IMAGE_UPLOAD_DIR = BASE_DIR / "data" / "uploads"
PLAZA_DB = PlazaDb()
seed_plaza_dev_users(PLAZA_DB)
seed_plaza_demo_posts(PLAZA_DB, IMAGE_UPLOAD_DIR)

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


def _client_bucket() -> str:
    # Do not trust X-Forwarded-For unless a trusted proxy layer is explicitly configured later.
    return (request.remote_addr or "local").strip()


def _json_fail(code: str, http_status: int = 400):
    body = fail(code=code)
    return jsonify(body), http_status


def _json_ok(payload: dict, http_status: int = 200):
    return jsonify({"ok": True, **payload}), http_status


def _require_plaza_user():
    token = parse_bearer_user_token(request.headers.get("Authorization"))
    if not token:
        return None, _json_fail("SESSION_MISSING", 401)
    claims = verify_user_token(token)
    if not claims:
        return None, _json_fail("SESSION_INVALID", 401)
    user = PLAZA_DB.find_user_by_id(claims.user_id)
    if not user:
        return None, _json_fail("SESSION_INVALID", 401)
    return user, None


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


@app.post("/api/plaza/auth/register")
def plaza_register():
    body = request.get_json(silent=True) or {}
    username = body.get("username") if isinstance(body, dict) else None
    password = body.get("password") if isinstance(body, dict) else None
    if not isinstance(username, str) or not isinstance(password, str):
        return _json_fail("INVALID_ARGUMENT")
    if validate_username(username):
        return jsonify(fail(code="INVALID_ARGUMENT", message="用户名格式不正确。")), 400
    if validate_password(password):
        return jsonify(fail(code="INVALID_ARGUMENT", message="密码需为3到20位之间，请重新输入")), 400
    existing = PLAZA_DB.find_user_by_username(username)
    if existing:
        return jsonify(fail(code="INVALID_ARGUMENT", message="账号已存在，请前往登录界面")), 409
    try:
        user = register_user(PLAZA_DB, username, password)
    except ValueError as exc:
        code = str(exc)
        if code == "USERNAME_TAKEN":
            return jsonify(fail(code="INVALID_ARGUMENT", message="账号已存在，请前往登录界面")), 409
        return _json_fail("INVALID_ARGUMENT")
    token = issue_user_token(user)
    return _json_ok(
        {
            "result": {
                "token": token,
                "user": {"userId": user.user_id, "username": user.username},
            }
        },
        201,
    )


@app.post("/api/plaza/auth/login")
def plaza_login():
    body = request.get_json(silent=True) or {}
    username = body.get("username") if isinstance(body, dict) else None
    password = body.get("password") if isinstance(body, dict) else None
    if not isinstance(username, str) or not isinstance(password, str):
        return _json_fail("INVALID_ARGUMENT")
    row = PLAZA_DB.find_user_by_username(username)
    if not row:
        return jsonify(fail(code="INVALID_ARGUMENT", message="账号不存在")), 401
    user = authenticate_user(PLAZA_DB, username, password)
    if not user:
        return jsonify(fail(code="INVALID_ARGUMENT", message="密码错误")), 401
    token = issue_user_token(user)
    return _json_ok({"result": {"token": token, "user": {"userId": user.user_id, "username": user.username}}})


@app.get("/api/plaza/posts")
def plaza_list_posts():
    user, err = _require_plaza_user()
    if err:
        return err
    _ = user
    posts = [post_public_dict(row) for row in PLAZA_DB.list_posts()]
    return _json_ok({"result": {"posts": posts}})


@app.get("/api/plaza/posts/mine/project-ids")
def plaza_my_shared_project_ids():
    user, err = _require_plaza_user()
    if err:
        return err
    project_ids = PLAZA_DB.list_shared_project_ids_for_user(user.user_id)
    return _json_ok({"result": {"projectIds": project_ids}})


@app.get("/api/plaza/posts/<post_id>")
def plaza_get_post(post_id: str):
    user, err = _require_plaza_user()
    if err:
        return err
    _ = user
    post = PLAZA_DB.get_post((post_id or "").strip())
    if not post:
        return _json_fail("INVALID_ARGUMENT", 404)
    return _json_ok({"result": {"post": post_public_dict(post)}})


@app.post("/api/plaza/posts")
def plaza_publish_post():
    user, err = _require_plaza_user()
    if err:
        return err

    project_id = (request.form.get("projectId") or "").strip()
    title = (request.form.get("title") or "").strip()
    preview = request.files.get("file") or request.files.get("image")
    if not preview:
        return _json_fail("IMAGE_MISSING_FILE")

    try:
        post = publish_post(
            PLAZA_DB,
            user_id=user.user_id,
            author_name=user.username,
            project_id=project_id,
            title=title,
            preview_stream=preview.stream,
            preview_filename=preview.filename,
            preview_mime=preview.mimetype,
            upload_root=IMAGE_UPLOAD_DIR,
        )
    except ValueError as exc:
        code = str(exc)
        status = 409 if code == "PROJECT_ALREADY_SHARED" else 400
        if code == "PAYLOAD_TOO_LARGE":
            status = 413
        return _json_fail(code if code in {"PROJECT_ALREADY_SHARED", "PAYLOAD_TOO_LARGE"} else "INVALID_ARGUMENT", status)

    return _json_ok({"result": {"post": post_public_dict(post)}}, 201)


@app.delete("/api/plaza/posts/by-project/<project_id>")
def plaza_withdraw_post(project_id: str):
    user, err = _require_plaza_user()
    if err:
        return err
    removed = PLAZA_DB.delete_post_for_user(user.user_id, (project_id or "").strip())
    if not removed:
        return _json_fail("INVALID_ARGUMENT", 404)
    media_path = IMAGE_UPLOAD_DIR / PLAZA_UPLOAD_DIR_NAME / removed.preview_filename
    if media_path.is_file():
        try:
            media_path.unlink()
        except OSError:
            pass
    return _json_ok({"result": {"projectId": removed.project_id}})


@app.get("/api/plaza/media/<path:filename>")
def plaza_media(filename: str):
    user, err = _require_plaza_user()
    if err:
        return err
    _ = user
    rel = filename.replace("\\", "/")
    if ".." in rel.split("/") or rel.startswith("/"):
        return _json_fail("INVALID_ARGUMENT")
    folder = IMAGE_UPLOAD_DIR / PLAZA_UPLOAD_DIR_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return send_from_directory(folder, Path(rel).name)


@app.post("/api/images/upload")
def upload_image():
    """Accept one PNG, JPEG, or BMP and save it without image processing."""
    claims, err = _require_session(apply_install_rate=True)
    if err:
        return err
    _ = claims
    if not rate_limit_ok(f"image-upload:{_client_bucket()}"):
        return _json_fail("RATE_LIMITED", 429)

    image = request.files.get("file") or request.files.get("image")
    if not image:
        return _json_fail("IMAGE_MISSING_FILE")
    try:
        result = save_uploaded_image(
            image.stream,
            filename=image.filename,
            mime_type=image.mimetype,
            upload_dir=IMAGE_UPLOAD_DIR,
        )
    except ImageUploadError as exc:
        status = 413 if exc.code == "PAYLOAD_TOO_LARGE" else 400
        return _json_fail(exc.code, status)
    return jsonify({"ok": True, "result": result}), 201


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
                "sessionHmac": session_secret_status()["configured"],
            },
            "providers": {
                "asr": ["qwen_cloud_http", "qwen_cloud_realtime", "qwen_local"]
                + (["mock"] if is_dev_mode() else []),
                "qa": ["deepseek"] + (["mock"] if is_dev_mode() else []),
                "tts": ["minimax"] + (["mock"] if is_dev_mode() else []),
            },
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
