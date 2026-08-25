"""Explicit real-API smoke for the Gateway-owned Seedream I2I path.

Usage from ``backend/``:
  python tools/smoke_seedream_i2i.py --input hand-drawing.png --save-dir i2i-smoke --real
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.image_input_guard import ImageInputError, validate_image_bytes  # noqa: E402
from services.image_profiles import resolve_generation_profile  # noqa: E402
from services.image_service import ImageService  # noqa: E402
from services.style_reference_sets import reference_set_summary  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one explicit real Seedream I2I smoke request.")
    parser.add_argument("--input", type=Path, required=True, help="Local PNG/JPEG content reference.")
    parser.add_argument("--save-dir", type=Path, required=True, help="Directory for the resulting PNG.")
    parser.add_argument("--real", action="store_true", help="Required acknowledgement that this calls Seedream.")
    args = parser.parse_args()
    if not args.real:
        parser.error("--real is required; this tool never calls Seedream by default")
    if not (os.getenv("ARK_API_KEY") or "").strip():
        print(json.dumps({"ok": False, "error": "ARK_API_KEY is not configured"}))
        return 2

    mime_type = mimetypes.guess_type(args.input.name)[0] or ""
    try:
        content = validate_image_bytes(args.input.read_bytes(), mime_type=mime_type)
    except (OSError, ImageInputError):
        # Do not reveal a local path in smoke output.
        print(json.dumps({"ok": False, "error": "input image is invalid"}))
        return 2

    request_id = f"i2i-smoke-{uuid.uuid4()}"
    result = ImageService().transform(content_image=content.data_uri, request_id=request_id)
    if not result.get("ok"):
        print(json.dumps({"ok": False, "requestId": request_id, "errorCode": (result.get("error") or {}).get("code")}))
        return 1

    payload = result["result"]
    try:
        image_bytes = base64.b64decode(payload["imageBase64"], validate=True)
    except (KeyError, ValueError, TypeError):
        print(json.dumps({"ok": False, "requestId": request_id, "errorCode": "INVALID_OUTPUT"}))
        return 1
    args.save_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{request_id}.png"
    (args.save_dir / filename).write_bytes(image_bytes)
    profile = resolve_generation_profile("core_pattern")
    print(json.dumps({
        "ok": True,
        "requestId": payload.get("requestId") or request_id,
        "provider": payload.get("provider"),
        "model": profile.model,
        **reference_set_summary(profile.reference_set_id),
        "referenceCount": 9,
        "savedFilename": filename,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
