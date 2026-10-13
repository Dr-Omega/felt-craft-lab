"""Local-only gateway setup. Never prints credentials or calls a cloud provider."""
from pathlib import Path
import argparse
import os
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
ENV_FILE = BACKEND / ".env"
DATA = ROOT / "tmp" / "local-test-data"


def initialize():
    if ENV_FILE.exists():
        print("Existing backend/.env preserved; no keys or settings replaced.")
        return
    # Exclusive creation: a concurrent user edit must never be overwritten.
    text = (BACKEND / ".env.example").read_text(encoding="utf-8")
    text = text.replace(
        "AI_SESSION_HMAC_SECRET=replace-with-a-long-random-secret-at-least-32-chars",
        "AI_SESSION_HMAC_SECRET=" + secrets.token_urlsafe(48),
    )
    text += (
        "\n# Local test instance. Back up this directory and this env file together.\n"
        f"PLAZA_JWT_SECRET={secrets.token_urlsafe(48)}\n"
        f"PLAZA_DB_PATH={DATA.as_posix()}/plaza.db\n"
        f"PLAZA_UPLOAD_DIR={DATA.as_posix()}/uploads\n"
        "AI_GLOBAL_MAX_CALLS_PER_HOUR=60\n"
        "AI_GLOBAL_MAX_CALLS_PER_DAY=200\n"
    )
    DATA.mkdir(parents=True, exist_ok=True)
    with ENV_FILE.open("x", encoding="utf-8") as handle:
        handle.write(text)
    print("Created ignored backend/.env; provider keys remain blank. Local signing secrets generated.")


def load_configuration():
    from dotenv import dotenv_values
    if not ENV_FILE.is_file():
        raise SystemExit("Run --init first.")
    values = dotenv_values(ENV_FILE)
    # Load before importing any service: several modules read settings at import time.
    # Explicit local file wins over inherited developer/test/mock environment values.
    for key, value in values.items():
        if value is not None:
            os.environ[key] = value
    if os.environ.get("APP_ENV") != "development":
        raise SystemExit("This launcher is only for APP_ENV=development, not server deployment.")
    for key, expected in {
        "QWEN_ASR_PROVIDER": "qwen_cloud_http", "QA_PROVIDER": "deepseek",
        "TTS_PROVIDER": "minimax", "IMAGE_PROVIDER": "seedream_ark",
    }.items():
        if os.environ.get(key) != expected:
            raise SystemExit(f"Unexpected provider setting: {key}; local real-service profile required.")
    os.environ["ALLOW_SIMULATED_RECHARGE"] = "false"
    sys.path.insert(0, str(BACKEND))


def check():
    from services.session_auth import session_secret_status
    from services.style_reference_sets import resolve_reference_images
    import json
    ready = lambda key: bool(os.environ.get(key, "").strip())
    print(json.dumps({
        "mode": "local-real-services-no-mock",
        "qwenAsrKeyPresent": ready("QWEN_ASR_API_KEY") or ready("DASHSCOPE_API_KEY"),
        "storyKeyPresent": any(ready(k) for k in ("QWEN_STORY_API_KEY", "QWEN_ASR_API_KEY", "DASHSCOPE_API_KEY")),
        "deepseekKeyPresent": ready("DEEPSEEK_API_KEY"),
        "seedreamKeyPresent": ready("ARK_API_KEY"),
        "minimaxKeyAndGroupPresent": ready("MINIMAX_API_KEY") and ready("MINIMAX_GROUP_ID"),
        "sessionSecretUsable": session_secret_status()["usable"],
        "accountSecretPresent": ready("PLAZA_JWT_SECRET"),
        "styleReferenceCount": len(resolve_reference_images("felt-style-ref-v1")),
        "simulatedRecharge": False,
        "cloudRequestsMade": 0,
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--init", action="store_true")
    group.add_argument("--check", action="store_true")
    group.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.init:
        initialize()
    else:
        load_configuration()
        if args.check:
            check()
        else:
            from app import app
            # Never expose this local development server on LAN, or enable debugger/reloader.
            app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8788")),
                    debug=False, use_reloader=False)
