"""短期 Session Token：HMAC 签名，密钥仅留 Gateway，不进 Electron。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

_log = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

_DEFAULT_TTL_SEC = int(os.getenv("AI_SESSION_TTL_SEC", "3600"))
_ephemeral_secret: Optional[bytes] = None


def is_valid_installation_id(value: str) -> bool:
    return bool(value and _UUID_RE.match(value.strip()))


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + pad).encode("ascii"))


def session_hmac_secret() -> bytes:
    """Gateway-only secret. Never ship to Electron."""
    global _ephemeral_secret
    configured = (os.getenv("AI_SESSION_HMAC_SECRET") or "").strip()
    if configured:
        return configured.encode("utf-8")
    env = (os.getenv("APP_ENV") or "development").strip().lower()
    if env in {"development", "dev", "test"}:
        if _ephemeral_secret is None:
            _ephemeral_secret = secrets.token_bytes(32)
            _log.warning(
                "AI_SESSION_HMAC_SECRET unset; using ephemeral in-process secret (dev/test only)."
            )
        return _ephemeral_secret
    raise RuntimeError("AI_SESSION_HMAC_SECRET is required outside development")


@dataclass(frozen=True)
class SessionClaims:
    installation_id: str
    iat: int
    exp: int
    jti: str


def issue_session_token(
    installation_id: str,
    *,
    ttl_sec: Optional[int] = None,
    now: Optional[float] = None,
) -> dict[str, Any]:
    if not is_valid_installation_id(installation_id):
        raise ValueError("invalid_installation_id")
    ttl = int(ttl_sec if ttl_sec is not None else _DEFAULT_TTL_SEC)
    if ttl < 60:
        ttl = 60
    ts = int(now if now is not None else time.time())
    payload = {
        "installationId": installation_id.strip().lower(),
        "iat": ts,
        "exp": ts + ttl,
        "jti": uuid.uuid4().hex,
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = _b64url_encode(
        hmac.new(session_hmac_secret(), body.encode("ascii"), hashlib.sha256).digest()
    )
    return {
        "token": f"{body}.{sig}",
        "expiresAt": payload["exp"],
        "installationId": payload["installationId"],
    }


def verify_session_token(
    token: str,
    *,
    expected_installation_id: Optional[str] = None,
    now: Optional[float] = None,
) -> Optional[SessionClaims]:
    raw = (token or "").strip()
    if not raw or raw.count(".") != 1:
        return None
    body, sig = raw.split(".", 1)
    try:
        expected = hmac.new(session_hmac_secret(), body.encode("ascii"), hashlib.sha256).digest()
        got = _b64url_decode(sig)
    except Exception:  # noqa: BLE001
        return None
    if not hmac.compare_digest(expected, got):
        return None
    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(payload, dict):
        return None
    installation_id = str(payload.get("installationId") or "").strip().lower()
    try:
        iat = int(payload.get("iat"))
        exp = int(payload.get("exp"))
    except (TypeError, ValueError):
        return None
    jti = str(payload.get("jti") or "").strip()
    if not is_valid_installation_id(installation_id) or not jti:
        return None
    ts = int(now if now is not None else time.time())
    if exp < ts:
        return None
    if expected_installation_id:
        if installation_id != expected_installation_id.strip().lower():
            return None
    return SessionClaims(installation_id=installation_id, iat=iat, exp=exp, jti=jti)


def parse_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None
