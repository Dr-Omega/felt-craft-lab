"""Explicit, paid-only Seedream T2I A/B smoke for cutout-friendly prompt profiles.

Run from ``backend/`` with an ARK_API_KEY configured:
  python tools/smoke_seedream_cutout_prompt.py --profile v2 --save-dir cutout-prompt-smoke/v2 --real
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.image_profiles import resolve_generation_profile  # noqa: E402
from services.image_service import ImageService, InternalGenerateSmokeResult  # noqa: E402
from services.style_reference_sets import reference_set_summary  # noqa: E402


@dataclass(frozen=True)
class SmokeCase:
    case_id: str
    prompt: str


# Fixed cases deliberately cover light, dark, colored, and multi-subject risks.
SMOKE_CASES = (
    SmokeCase("S01", "一只黑白熊猫，白色脸部和黑色耳朵，抱着红色皮球"),
    SmokeCase("S02", "一只白色或浅灰色小兔子，粉色耳朵内侧"),
    SmokeCase("S03", "一朵奶白色小花，淡黄色花心"),
    SmokeCase("S04", "一只深色黑猫，清楚可见的眼睛和尾巴"),
    SmokeCase("S05", "一片绿色大叶子和两片小绿叶"),
    SmokeCase("S06", "一只蓝色小鲸鱼吐出泡泡"),
    SmokeCase("S07", "一只红黄蓝多色小鸟，展开翅膀"),
    SmokeCase("S08", "一只熊猫抱着一个红色皮球，两个主体保持明确关系"),
)
_PROFILE_BY_ALIAS = {"v1": "felt-seedream45-ref8-v1", "v2": "felt-seedream45-ref8-v2-cutout"}


def _raw_suffix(raw_image_bytes: bytes, content_type: str) -> str:
    if raw_image_bytes.startswith(b"\xff\xd8\xff") or content_type.lower() in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    return ".png"


def _write_case(
    *,
    root: Path,
    case: SmokeCase,
    profile_id: str,
    profile,
    smoke_result: InternalGenerateSmokeResult,
) -> dict:
    case_dir = root / case.case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    raw_filename = "raw" + _raw_suffix(smoke_result.raw_image_bytes, smoke_result.raw_content_type)
    (case_dir / raw_filename).write_bytes(smoke_result.raw_image_bytes)
    final = smoke_result.final_envelope
    final_filename: str | None = None
    if final.get("ok"):
        encoded = ((final.get("result") or {}).get("imageBase64") or "").strip()
        try:
            final_bytes = base64.b64decode(encoded, validate=True)
        except (TypeError, ValueError):
            final = {"ok": False, "error": {"code": "INVALID_OUTPUT"}}
        else:
            final_filename = "final.png"
            (case_dir / final_filename).write_bytes(final_bytes)
    metadata = {
        "caseId": case.case_id,
        "profileId": profile_id,
        "provider": smoke_result.provider_name,
        "model": profile.model,
        **reference_set_summary(profile.reference_set_id),
        "referenceCount": 8,
        "rawFilename": raw_filename,
        "finalFilename": final_filename,
        "finalStatus": "SUCCESS" if final.get("ok") else "ERROR",
        "errorCode": None if final.get("ok") else (final.get("error") or {}).get("code"),
    }
    (case_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Deliberately no prompt, Base64, key, request headers, or local absolute paths.
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description="Run fixed Seedream T2I raw/final cutout-prompt smoke cases.")
    parser.add_argument("--profile", choices=sorted(_PROFILE_BY_ALIAS), required=True, help="Profile variant to test.")
    parser.add_argument("--save-dir", type=Path, required=True, help="Directory for case subdirectories.")
    parser.add_argument("--real", action="store_true", help="Required acknowledgement that this consumes Seedream quota.")
    args = parser.parse_args()
    if not args.real:
        parser.error("--real is required; this tool never calls Seedream by default")
    if not (os.getenv("ARK_API_KEY") or "").strip():
        print(json.dumps({"ok": False, "error": "ARK_API_KEY is not configured"}))
        return 2

    profile_id = _PROFILE_BY_ALIAS[args.profile]
    os.environ["IMAGE_PROFILE_CORE_PATTERN"] = profile_id
    profile = resolve_generation_profile("core_pattern")
    records: list[dict] = []
    for case in SMOKE_CASES:
        request_id = f"cutout-{args.profile.lower()}-{case.case_id.lower()}-{uuid.uuid4()}"
        result = ImageService().generate_for_internal_smoke(
            positive_prompt=case.prompt,
            asset_role="core_pattern",
            request_id=request_id,
        )
        if not isinstance(result, InternalGenerateSmokeResult):
            records.append({
                "caseId": case.case_id,
                "profileId": profile_id,
                "provider": profile.provider,
                "model": profile.model,
                "referenceCount": 8,
                "errorCode": (result.get("error") or {}).get("code"),
            })
            continue
        records.append(_write_case(root=args.save_dir, case=case, profile_id=profile_id, profile=profile, smoke_result=result))

    # Stdout is intentionally a small audit summary, never image contents or prompts.
    print(json.dumps(records, ensure_ascii=False, indent=2))
    return 0 if all(record.get("finalStatus") == "SUCCESS" for record in records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
