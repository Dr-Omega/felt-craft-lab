"""Account/share/reward routes reused from GitHub personal-center 010da910.
No AI routes or demo seed are imported; current app providers remain unchanged.
"""
from __future__ import annotations
import os
from pathlib import Path
from flask import Blueprint, jsonify, request, send_from_directory
from services.shared_error_map import fail
from services.plaza_auth import (
    authenticate_user,
    issue_user_token,
    parse_bearer_user_token,
    register_user,
    user_public_dict,
    validate_password,
    validate_username,
    verify_user_token,
)
from services.plaza_db import PlazaDb
from services.plaza_posts import PLAZA_UPLOAD_DIR_NAME, post_public_dict, publish_post
from services.reward_system import RewardError, RewardSystem
from services.payments import Payments
from services.workspace_sync import WorkspaceSync

app = Blueprint("plaza", __name__)
BASE_DIR = Path(__file__).resolve().parent.parent
IMAGE_UPLOAD_DIR = Path(os.getenv("PLAZA_UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
PLAZA_DB = PlazaDb(Path(os.environ["PLAZA_DB_PATH"]) if os.getenv("PLAZA_DB_PATH") else None)
REWARD_SYSTEM = RewardSystem(PLAZA_DB.db_path)
PAYMENTS = Payments(REWARD_SYSTEM)
WORKSPACES = WorkspaceSync(PLAZA_DB)

def _json_fail(code: str, http_status: int = 400):
    body = fail(code=code)
    return jsonify(body), http_status


def _json_ok(payload: dict, http_status: int = 200):
    return jsonify({"ok": True, **payload}), http_status


def _reward_fail(error: RewardError):
    return jsonify(fail(code="INVALID_ARGUMENT", message=error.message, retryable=False)), error.status


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


@app.get("/api/payments/capabilities")
@app.post("/api/payments/orders")
@app.get("/api/payments/orders/<order_id>")
@app.post("/api/payments/orders/<order_id>/cancel")
def payment_order(order_id=None):
    user, err = _require_plaza_user()
    if err:
        return err
    try:
        if request.path.endswith("capabilities"):
            result = PAYMENTS.capabilities()
        elif order_id:
            result = {"order": PAYMENTS.cancel(user.user_id, order_id) if request.method == "POST" else PAYMENTS.query(user.user_id, order_id)}
        else:
            body = request.get_json(silent=True)
            if not isinstance(body, dict):
                return _json_fail("INVALID_ARGUMENT")
            result = PAYMENTS.create(user.user_id, body.get("packageId"), body.get("requestId"))
        return _json_ok({"result": result})
    except RewardError as exc:
        return _reward_fail(exc)
    except Exception:
        # Unknown provider outcome must be reconciled using the SAME order/request.
        return _reward_fail(RewardError("PAYMENT_UNCERTAIN", "支付服务暂不可用，请查询原订单，不要重复付款。", 502))


@app.post("/api/payments/callback")
def payment_callback():
    if request.content_length is None or request.content_length > 65536:
        return _json_fail("INVALID_ARGUMENT", 413)
    try:
        return _json_ok({"result": {"order": PAYMENTS.callback(request.get_data(), dict(request.headers))}})
    except RewardError as exc:
        return _reward_fail(exc)
    except Exception:
        return _json_fail("INVALID_ARGUMENT", 400)


@app.get("/api/workspace")
@app.put("/api/workspace")
@app.get("/api/workspace/chunks/<sha>")
@app.put("/api/workspace/chunks/<sha>")
def workspace(sha=None):
    user, err = _require_plaza_user()
    if err:
        return err
    try:
        body = request.get_json(silent=True) if request.method == "PUT" else None
        if request.method == "PUT" and not isinstance(body, dict):
            return _json_fail("INVALID_ARGUMENT")
        if sha:
            if request.method == "PUT" and "base64" not in body:
                return _json_fail("INVALID_ARGUMENT")
            result = WORKSPACES.chunk(user.user_id, sha, body.get("base64") if body else None)
        else:
            result = WORKSPACES.read(user.user_id) if request.method == "GET" else WORKSPACES.put(user.user_id, body.get("revision"), body.get("document"))
        return _json_ok({"result": result})
    except RewardError as exc:
        return _reward_fail(exc)



@app.post("/api/plaza/auth/register")
def plaza_register():
    body = request.get_json(silent=True) or {}
    username = body.get("username") if isinstance(body, dict) else None
    password = body.get("password") if isinstance(body, dict) else None
    role = body.get("role", "child") if isinstance(body, dict) else "child"
    if os.getenv("APP_ENV") not in {"dev", "development", "test", "local"} and role not in {"child", "parent"}:
        return _reward_fail(RewardError("ROLE_APPROVAL_REQUIRED", "教师及管理员账号需由管理员审核开通。", 403))
    if not isinstance(username, str) or not isinstance(password, str):
        return _json_fail("INVALID_ARGUMENT")
    if role not in {"child", "parent", "art_teacher", "chinese_teacher"}:
        return jsonify(fail(code="INVALID_ARGUMENT", message="账号身份无效。")), 400
    if validate_username(username):
        return jsonify(fail(code="INVALID_ARGUMENT", message="用户名格式不正确。")), 400
    if validate_password(password):
        return jsonify(fail(code="INVALID_ARGUMENT", message="密码需为3到20位之间，请重新输入")), 400
    existing = PLAZA_DB.find_user_by_username(username)
    if existing:
        return jsonify(fail(code="INVALID_ARGUMENT", message="账号已存在，请前往登录界面")), 409
    try:
        user = register_user(PLAZA_DB, username, password, role)
    except ValueError as exc:
        code = str(exc)
        if code == "USERNAME_TAKEN":
            return jsonify(fail(code="INVALID_ARGUMENT", message="账号已存在，请前往登录界面")), 409
        return _json_fail("INVALID_ARGUMENT")
    token = issue_user_token(user)
    daily_reward_granted = REWARD_SYSTEM.on_login(user)
    return _json_ok(
        {
            "result": {
                "token": token,
                "user": user_public_dict(user),
                "dailyRewardGranted": daily_reward_granted,
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
    daily_reward_granted = REWARD_SYSTEM.on_login(user)
    return _json_ok(
        {
            "result": {
                "token": token,
                "user": user_public_dict(user),
                "dailyRewardGranted": daily_reward_granted,
            }
        }
    )


@app.get("/api/plaza/posts")
def plaza_list_posts():
    user, err = _require_plaza_user()
    if err:
        return err
    posts = []
    for row in PLAZA_DB.list_posts():
        post = post_public_dict(row)
        post.update(REWARD_SYSTEM.post_stats(user.user_id, row.post_id))
        posts.append(post)
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
    post = PLAZA_DB.get_post((post_id or "").strip())
    if not post:
        return _json_fail("INVALID_ARGUMENT", 404)
    public_post = post_public_dict(post)
    public_post.update(REWARD_SYSTEM.post_stats(user.user_id, post.post_id))
    return _json_ok({"result": {"post": public_post}})


@app.post("/api/plaza/posts")
def plaza_publish_post():
    user, err = _require_plaza_user()
    if err:
        return err

    project_id = (request.form.get("projectId") or "").strip()
    title = (request.form.get("title") or "").strip()
    output_type = (request.form.get("outputType") or "collage").strip()
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
            output_type=output_type,
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


@app.post("/api/plaza/posts/<post_id>/like")
def plaza_like_post(post_id: str):
    user, err = _require_plaza_user()
    if err:
        return err
    post = PLAZA_DB.get_post((post_id or "").strip())
    if not post:
        return _json_fail("INVALID_ARGUMENT", 404)
    try:
        result = REWARD_SYSTEM.like_post(user, post)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result}, 201)


@app.post("/api/plaza/posts/<post_id>/reviews")
def plaza_submit_review(post_id: str):
    user, err = _require_plaza_user()
    if err:
        return err
    post = PLAZA_DB.get_post((post_id or "").strip())
    if not post:
        return _json_fail("INVALID_ARGUMENT", 404)
    body = request.get_json(silent=True) or {}
    score = body.get("score") if isinstance(body, dict) else None
    comment = body.get("comment") if isinstance(body, dict) else None
    if isinstance(score, bool) or not isinstance(score, int) or not isinstance(comment, str):
        return _json_fail("INVALID_ARGUMENT")
    try:
        result = REWARD_SYSTEM.submit_review(user, post, score=score, comment=comment)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result}, 201)


@app.get("/api/rewards/dashboard")
def rewards_dashboard():
    user, err = _require_plaza_user()
    if err:
        return err
    return _json_ok({"result": REWARD_SYSTEM.dashboard(user)})


@app.post("/api/rewards/convert")
def rewards_convert():
    user, err = _require_plaza_user()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    diamonds = body.get("diamonds") if isinstance(body, dict) else None
    request_id = body.get("requestId") if isinstance(body, dict) else None
    if isinstance(diamonds, bool) or not isinstance(diamonds, int) or not isinstance(request_id, str):
        return _json_fail("INVALID_ARGUMENT")
    try:
        result = REWARD_SYSTEM.convert_diamonds(user, diamonds, request_id)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result})


@app.post("/api/rewards/recharge")
def rewards_recharge():
    # Legacy simulated credit is not a production payment endpoint.
    if os.getenv("APP_ENV") not in {"development", "test"} or os.getenv("ALLOW_SIMULATED_RECHARGE") != "true":
        return _reward_fail(RewardError("PAYMENT_DISABLED", "模拟充值已关闭，请使用支付订单接口。", 403))
    user, err = _require_plaza_user()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    yuan = body.get("yuan") if isinstance(body, dict) else None
    request_id = body.get("requestId") if isinstance(body, dict) else None
    if isinstance(yuan, bool) or not isinstance(yuan, int) or not isinstance(request_id, str):
        return _json_fail("INVALID_ARGUMENT")
    try:
        result = REWARD_SYSTEM.recharge_diamonds(user, yuan, request_id)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result})


@app.get("/api/rewards/inbox")
def rewards_inbox():
    user, err = _require_plaza_user()
    if err:
        return err
    try:
        messages = REWARD_SYSTEM.list_inbox(user)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": {"messages": messages}})


@app.post("/api/rewards/inbox/<message_id>/claim")
def rewards_claim_message(message_id: str):
    user, err = _require_plaza_user()
    if err:
        return err
    try:
        result = REWARD_SYSTEM.claim_message(user, (message_id or "").strip())
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result})


@app.post("/api/rewards/store/redeem")
def rewards_redeem():
    user, err = _require_plaza_user()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    product_id = body.get("productId") if isinstance(body, dict) else None
    currency = body.get("currency") if isinstance(body, dict) else None
    request_id = body.get("requestId") if isinstance(body, dict) else None
    if not all(isinstance(value, str) for value in (product_id, currency, request_id)):
        return _json_fail("INVALID_ARGUMENT")
    try:
        result = REWARD_SYSTEM.redeem(user, product_id, currency, request_id)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result}, 201)


@app.post("/api/rewards/bear/feed")
def rewards_feed_bear():
    user, err = _require_plaza_user()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    food_id = body.get("foodId") if isinstance(body, dict) else None
    currency = body.get("currency") if isinstance(body, dict) else None
    request_id = body.get("requestId") if isinstance(body, dict) else None
    if not all(isinstance(value, str) for value in (food_id, currency, request_id)):
        return _json_fail("INVALID_ARGUMENT")
    try:
        result = REWARD_SYSTEM.feed_bear(user, food_id, currency, request_id)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result}, 201)


@app.put("/api/rewards/bear/room")
def rewards_save_room():
    user, err = _require_plaza_user()
    if err:
        return err
    try:
        result = REWARD_SYSTEM.save_room(user, request.get_json(silent=True))
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": result})


@app.get("/api/rewards/admin/config")
def rewards_get_admin_config():
    user, err = _require_plaza_user()
    if err:
        return err
    try:
        result = REWARD_SYSTEM.get_admin_config(user)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": {"config": result}})


@app.put("/api/rewards/admin/config")
def rewards_update_admin_config():
    user, err = _require_plaza_user()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return _json_fail("INVALID_ARGUMENT")
    try:
        result = REWARD_SYSTEM.update_admin_config(user, body)
    except RewardError as exc:
        return _reward_fail(exc)
    return _json_ok({"result": {"config": result}})
