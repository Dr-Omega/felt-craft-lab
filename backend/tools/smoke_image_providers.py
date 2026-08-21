"""Live Gateway smoke for voice-to-image (mock by default; optional wan).

Usage (from backend/):
  .venv\\Scripts\\python.exe tools/smoke_image_providers.py
  .venv\\Scripts\\python.exe tools/smoke_image_providers.py --also-wan

Does not print secrets. Writes a JSON summary to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AI_SMOKE_ENABLED", "false")
# Prefer mock for the always-on path unless caller already set something else for Flask.
# This script talks to a running Flask; it only sets provider per-request.

from app import app  # noqa: E402
from services.session_auth import issue_session_token  # noqa: E402


def _auth_headers() -> dict[str, str]:
    iid = str(uuid.uuid4())
    issued = issue_session_token(iid)
    return {
        "Authorization": f"Bearer {issued['token']}",
        "X-Felt-Installation-Id": iid,
    }


def _check_health(client) -> dict:
    response = client.get("/api/health")
    body = response.get_json() or {}
    selected = (body.get("selected") or {}).get("image")
    providers = (body.get("providers") or {}).get("image") or []
    keys = body.get("keysConfigured") or {}
    dumped = response.get_data(as_text=True).lower()
    return {
        "ok": response.status_code == 200 and body.get("ok") is True,
        "status": response.status_code,
        "selectedImage": selected,
        "providersImage": providers,
        "keysDashscope": bool(keys.get("dashscope")),
        "keysSdLocal": bool(keys.get("sdLocal")),
        "leaksSecret": ("sk-" in dumped) or ("api_key" in dumped and "keysconfigured" not in dumped),
    }


def _generate(client, provider: str) -> dict:
    response = client.post(
        "/api/image/generate",
        json={
            "positivePrompt": "flat color block panda holding a red ball, plain light background",
            "negativePrompt": "photo, realistic fur",
            "width": 128,
            "height": 128,
            "provider": provider,
            "assetRole": "core_pattern",
        },
        headers=_auth_headers(),
    )
    body = response.get_json() or {}
    result = body.get("result") or {}
    encoded = result.get("imageBase64") or ""
    quality = result.get("quality") or {}
    return {
        "ok": response.status_code == 200 and body.get("ok") is True and bool(encoded),
        "status": response.status_code,
        "provider": result.get("provider") or provider,
        "imageBytesApprox": int(len(encoded) * 3 / 4) if encoded else 0,
        "qualityVerdict": quality.get("verdict"),
        "errorCode": (body.get("error") or {}).get("code") if not body.get("ok") else None,
        "errorMessage": (body.get("error") or {}).get("message") if not body.get("ok") else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--also-wan", action="store_true", help="Also call wan_dashscope (uses cloud quota).")
    parser.add_argument("--also-sd-local", action="store_true", help="Also call sd_local (needs WebUI).")
    args = parser.parse_args()

    summary: dict = {"health": {}, "mock": {}, "wan_dashscope": None, "sd_local": None}
    with app.test_client() as client:
        summary["health"] = _check_health(client)
        summary["mock"] = _generate(client, "mock")
        if args.also_wan:
            summary["wan_dashscope"] = _generate(client, "wan_dashscope")
        if args.also_sd_local:
            summary["sd_local"] = _generate(client, "sd_local")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    ok = summary["health"].get("ok") and summary["mock"].get("ok") and not summary["health"].get("leaksSecret")
    if summary.get("wan_dashscope") is not None:
        ok = ok and bool(summary["wan_dashscope"].get("ok"))
    if summary.get("sd_local") is not None:
        ok = ok and bool(summary["sd_local"].get("ok"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
