"""Safe image-provider smoke utility.

Default output deliberately contains only operational metadata.  A separately
chosen output directory is required to retain real E2E PNGs for visual review.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.image_profiles import resolve_generation_profile
from services.image_service import ImageService

REAL_ACCEPTANCE_PROMPTS = (
    "我想要一只熊猫抱着红色皮球",
    "一只戴着黄色围巾的小狐狸",
    "一朵有笑脸的粉色郁金香",
    "一只蓝色小鲸鱼吐出泡泡",
    "一只背着书包的小兔子",
    "一个红色苹果和两片绿叶",
    "一只正在飞的橙色蝴蝶",
    "一辆装满花朵的小火车",
    "一只抱着胡萝卜的小熊",
    "一座有彩虹和云朵的小房子",
)


def _run(prompt: str, save_dir: Path | None, index: int) -> dict:
    profile = resolve_generation_profile("core_pattern")
    started = time.perf_counter()
    body = ImageService().generate(canonical_prompt=prompt, asset_role="core_pattern")
    latency_ms = round((time.perf_counter() - started) * 1000)
    record = {
        "provider": profile.provider,
        "profileId": profile.profile_id,
        "referenceSetId": profile.reference_set_id,
        "referenceCount": 8,
        "success": bool(body.get("ok")),
        "qualityVerdict": body.get("result", {}).get("qualityVerdict"),
        "latencyMs": latency_ms,
        "errorCode": body.get("error", {}).get("code"),
    }
    if save_dir and body.get("ok"):
        png = base64.b64decode(body["result"]["imageBase64"])
        (save_dir / f"seedream-{index:02d}.png").write_bytes(png)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--also-seedream", action="store_true", help="Run the configured real Seedream Core Pattern profile.")
    parser.add_argument("--save-dir", type=Path, help="Explicit directory for real E2E PNG retention.")
    args = parser.parse_args()
    if not args.also_seedream:
        print(json.dumps({"success": False, "errorCode": "SEEDREAM_NOT_REQUESTED"}, ensure_ascii=False))
        return 0
    save_dir = args.save_dir
    if save_dir:
        save_dir.mkdir(parents=True, exist_ok=True)
    records = [_run(prompt, save_dir, index) for index, prompt in enumerate(REAL_ACCEPTANCE_PROMPTS, start=1)]
    # Do not include prompts, secrets, base64, URLs, or filesystem paths.
    print(json.dumps(records, ensure_ascii=False))
    return 0 if all(record["success"] for record in records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
