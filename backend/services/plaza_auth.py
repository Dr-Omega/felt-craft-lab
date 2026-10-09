"""User accounts and JWT for the share plaza (separate from installation session tokens)."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from werkzeug.security import check_password_hash, generate_password_hash

from services.plaza_db import PlazaDb, PlazaUserRow

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fff]{2,40}$")
MIN_PASSWORD_LEN = 3
MAX_PASSWORD_LEN = 20
TOKEN_TTL_DAYS = 14
USER_ROLES = frozenset({"child", "parent", "art_teacher", "chinese_teacher", "admin"})


@dataclass(frozen=True)
class PlazaAuthClaims:
    user_id: str
    username: str
    exp: datetime


def _jwt_secret() -> str:
    secret = (os.getenv("PLAZA_JWT_SECRET") or "").strip()
    if secret:
        return secret
    dev = (os.getenv("APP_ENV") or "").strip().lower()
    if dev in {"dev", "development", "local"}:
        return "felt-plaza-development-secret-change-me"
    raise RuntimeError("PLAZA_JWT_SECRET is required outside development")


def validate_username(username: str) -> str | None:
    name = (username or "").strip()
    if not USERNAME_RE.fullmatch(name):
        return "INVALID_USERNAME"
    return None


def validate_password(password: str) -> str | None:
    pwd = password or ""
    if len(pwd) < MIN_PASSWORD_LEN or len(pwd) > MAX_PASSWORD_LEN:
        return "INVALID_PASSWORD_LENGTH"
    return None


def register_user(db: PlazaDb, username: str, password: str, role: str = "child") -> PlazaUserRow:
    if validate_username(username):
        raise ValueError("INVALID_USERNAME")
    if validate_password(password):
        raise ValueError("INVALID_PASSWORD")
    if role not in USER_ROLES:
        raise ValueError("INVALID_ROLE")
    password_hash = generate_password_hash(password)
    return db.create_user(username, password_hash, role)


def authenticate_user(db: PlazaDb, username: str, password: str) -> PlazaUserRow | None:
    user = db.find_user_by_username(username)
    if not user:
        return None
    if not check_password_hash(user.password_hash, password):
        return None
    return user


def issue_user_token(user: PlazaUserRow) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=TOKEN_TTL_DAYS)
    payload = {
        "sub": user.user_id,
        "username": user.username,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "typ": "plaza_user",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def verify_user_token(token: str) -> PlazaAuthClaims | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != "plaza_user":
        return None
    user_id = str(payload.get("sub") or "").strip()
    username = str(payload.get("username") or "").strip()
    exp_ts = payload.get("exp")
    if not user_id or not username or not isinstance(exp_ts, (int, float)):
        return None
    return PlazaAuthClaims(user_id=user_id, username=username, exp=datetime.fromtimestamp(exp_ts, tz=timezone.utc))


def parse_bearer_user_token(header_value: str | None) -> str | None:
    raw = (header_value or "").strip()
    if not raw.lower().startswith("bearer "):
        return None
    token = raw[7:].strip()
    return token or None


def user_public_dict(user: PlazaUserRow) -> dict[str, Any]:
    return {"userId": user.user_id, "username": user.username, "role": user.role}
