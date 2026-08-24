"""Live Gateway smoke for voice-to-image (mock by default; optional wan).

Usage (from backend/):
  .venv\\Scripts\\python.exe tools/smoke_image_providers.py
  .venv\\Scripts\\python.exe tools/smoke_image_providers.py --also-wan

Does not print secrets. Writes a JSON summary to stdout.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import uuid
import time
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


def _generate(client, provider: str | None, *, prompt: str = "flat color block panda holding a red ball, plain light background") -> tuple[dict, bytes | None]:
    payload = {
        "positivePrompt": prompt,
        "negativePrompt": "photo, realistic fur",
        "width": 128,
        "height": 128,
        "assetRole": "core_pattern",
    }
    if provider:
        payload["provider"] = provider
    started = time.perf_counter()
    response = client.post(
        "/api/image/generate",
        json=payload,
        headers=_auth_headers(),
    )
    body = response.get_json() or {}
    result = body.get("result") or {}
    encoded = result.get("imageBase64") or ""
    quality = result.get("quality") or {}
    record = {
        "ok": response.status_code == 200 and body.get("ok") is True and bool(encoded),
        "status": response.status_code,
        "provider": result.get("provider") or provider or "seedream_ark",
        "imageBytesApprox": int(len(encoded) * 3 / 4) if encoded else 0,
        "qualityVerdict": quality.get("verdict"),
        "errorCode": (body.get("error") or {}).get("code") if not body.get("ok") else None,
        "errorMessage": (body.get("error") or {}).get("message") if not body.get("ok") else None,
        "latencyMs": round((time.perf_counter() - started) * 1000),
    }
    try:
        image_bytes = base64.b64decode(encoded) if body.get("ok") and encoded else None
    except Exception:  # noqa: BLE001
        image_bytes = None
    return record, image_bytes


SEEDREAM_ACCEPTANCE_PROMPTS = (
    "我想要一只熊猫抱着红色皮球",
    "一只戴黄色围巾的小狐狸",
    "一朵有笑脸的粉色郁金香",
    "一只蓝色小鲸鱼吐出泡泡",
    "一只背着书包的小兔子",
    "一个红色苹果和两片绿叶",
    "一只正在飞的橙色蝴蝶",
    "一辆装满花朵的小火车",
    "一只抱着胡萝卜的小熊",
    "一座有彩虹和云朵的小房子",
)


def _seedream_smoke(client, save_dir: Path | None) -> list[dict]:
    records: list[dict] = []
    for index, prompt in enumerate(SEEDREAM_ACCEPTANCE_PROMPTS, start=1):
        result, image_bytes = _generate(client, None, prompt=prompt)
        if save_dir and result["ok"] and image_bytes:
            # Saving is opt-in for visual evaluation; stdout never includes data,
            # prompt text, signed URLs, paths, or Base64.
            (save_dir / f"seedream-{index:02d}.png").write_bytes(image_bytes)
        records.append({
            "provider": result["provider"],
            "profileId": "felt-seedream45-ref8-v1",
            "referenceSetId": "felt-style-ref-v1",
            "referenceCount": 8,
            "success": result["ok"],
            "qualityVerdict": result["qualityVerdict"],
            "latencyMs": result["latencyMs"],
            "errorCode": result["errorCode"],
        })
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--also-wan", action="store_true", help="Also call wan_dashscope (uses cloud quota).")
    parser.add_argument("--also-sd-local", action="store_true", help="Also call sd_local (needs WebUI).")
    parser.add_argument("--also-seedream", action="store_true", help="Run ten real Seedream Profile prompts (uses cloud quota).")
    parser.add_argument("--save-dir", type=Path, help="Optional directory for Seedream PNG review artifacts.")
    args = parser.parse_args()

    summary: dict = {"health": {}, "mock": {}, "wan_dashscope": None, "sd_local": None, "seedream_ark": None}
    with app.test_client() as client:
        summary["health"] = _check_health(client)
        summary["mock"], _ = _generate(client, "mock")
        if args.also_wan:
            summary["wan_dashscope"], _ = _generate(client, "wan_dashscope")
        if args.also_sd_local:
            summary["sd_local"], _ = _generate(client, "sd_local")
        if args.also_seedream:
            if args.save_dir:
                args.save_dir.mkdir(parents=True, exist_ok=True)
            summary["seedream_ark"] = _seedream_smoke(client, args.save_dir)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    ok = summary["health"].get("ok") and summary["mock"].get("ok") and not summary["health"].get("leaksSecret")
    if summary.get("wan_dashscope") is not None:
        ok = ok and bool(summary["wan_dashscope"].get("ok"))
    if summary.get("sd_local") is not None:
        ok = ok and bool(summary["sd_local"].get("ok"))
    if summary.get("seedream_ark") is not None:
        ok = ok and all(record["success"] for record in summary["seedream_ark"])
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
