"""
第 9 步：固定文案 TTS 批量工具

流程（规范 11.1）：
  YWN 准备 CSV/JSON 文案
  → 本工具调用 MiniMax
  → 输出 mp3 + audio-index.json
  → YWN 试听确认后，交给 SXY 用 AudioService 播放

用法（在 backend 目录，已激活 venv）：
  python tools/fixed_tts/batch_fixed_tts.py
  python tools/fixed_tts/batch_fixed_tts.py --input tools/fixed_tts/scripts.example.csv
  python tools/fixed_tts/batch_fixed_tts.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from providers.tts.minimax_provider import CACHE_DIR  # noqa: E402
from services.tts_service import TtsService  # noqa: E402

DEFAULT_INPUT = Path(__file__).resolve().parent / "scripts.example.csv"
DEFAULT_OUT = ROOT_DIR / "frontend" / "assets" / "fixed-audio"
SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]+$")


def load_items(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"找不到文案文件：{path}")

    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        items = data.get("items") if isinstance(data, dict) else data
        if not isinstance(items, list):
            raise ValueError("JSON 需要是 { items: [...] } 或数组")
        return [_normalize(x, i) for i, x in enumerate(items)]

    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            return [_normalize(row, i) for i, row in enumerate(reader)]

    raise ValueError("仅支持 .csv 或 .json")


def _normalize(row: dict, index: int) -> dict:
    item_id = str(row.get("id") or "").strip()
    asset_id = str(row.get("assetId") or row.get("asset_id") or "").strip()
    text = str(row.get("text") or "").strip()
    if not item_id:
        raise ValueError(f"第 {index + 1} 行缺少 id")
    if not SAFE_ID.match(item_id):
        raise ValueError(f"id 只能含字母数字下划线短横线：{item_id}")
    if not text:
        raise ValueError(f"id={item_id} 的 text 为空")
    return {"id": item_id, "assetId": asset_id, "text": text}


def run_batch(*, input_path: Path, out_dir: Path, dry_run: bool, sleep_s: float) -> int:
    items = load_items(input_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    service = TtsService()

    index_items: list[dict] = []
    ok_n = 0
    fail_n = 0

    print(f"输入：{input_path}")
    print(f"输出：{out_dir}")
    print(f"条数：{len(items)}  dry_run={dry_run}")
    print("-" * 48)

    for i, item in enumerate(items, start=1):
        item_id = item["id"]
        text = item["text"]
        print(f"[{i}/{len(items)}] {item_id} …")

        if dry_run:
            index_items.append(
                {
                    "id": item_id,
                    "assetId": item["assetId"],
                    "text": text,
                    "file": f"{item_id}.mp3",
                    "url": f"/fixed-audio/{item_id}.mp3",
                    "status": "dry_run",
                }
            )
            ok_n += 1
            continue

        result = service.synthesize(text=text, voice_purpose="fixed_snapshot")
        if not result.get("ok"):
            err = result.get("error") or {}
            print(f"  FAIL {err.get('code')}: {err.get('message')}")
            index_items.append(
                {
                    "id": item_id,
                    "assetId": item["assetId"],
                    "text": text,
                    "file": f"{item_id}.mp3",
                    "url": f"/fixed-audio/{item_id}.mp3",
                    "status": "error",
                    "error": err,
                }
            )
            fail_n += 1
            continue

        audio_url = (result.get("result") or {}).get("audioUrl") or ""
        src_name = Path(str(audio_url)).name
        src = CACHE_DIR / src_name
        dest = out_dir / f"{item_id}.mp3"

        if not src.exists() or src.stat().st_size <= 0:
            print(f"  FAIL 缓存文件不存在：{src}")
            index_items.append(
                {
                    "id": item_id,
                    "assetId": item["assetId"],
                    "text": text,
                    "file": f"{item_id}.mp3",
                    "url": f"/fixed-audio/{item_id}.mp3",
                    "status": "error",
                    "error": {"code": "TTS_CACHE_MISSING", "message": str(src)},
                }
            )
            fail_n += 1
            continue

        shutil.copyfile(src, dest)
        cache_hit = bool((result.get("result") or {}).get("cacheHit"))
        print(f"  OK → {dest.name}  cacheHit={cache_hit}")
        index_items.append(
            {
                "id": item_id,
                "assetId": item["assetId"],
                "text": text,
                "file": f"{item_id}.mp3",
                "url": f"/fixed-audio/{item_id}.mp3",
                "status": "ok",
                "cacheHit": cache_hit,
            }
        )
        ok_n += 1
        if sleep_s > 0 and i < len(items):
            time.sleep(sleep_s)

    index = {
        "version": 1,
        "purpose": "fixed_snapshot",
        "source": str(input_path.name),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "summary": {"ok": ok_n, "failed": fail_n, "total": len(items)},
        "items": index_items,
    }
    index_name = "audio-index.dry-run.json" if dry_run else "audio-index.json"
    index_path = out_dir / index_name
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print("-" * 48)
    print(f"索引已写：{index_path}")
    print(f"成功 {ok_n} / 失败 {fail_n} / 合计 {len(items)}")
    return 0 if fail_n == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="固定文案 TTS 批量生成")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="CSV 或 JSON 文案")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="输出目录")
    parser.add_argument("--dry-run", action="store_true", help="只校验文案并写索引，不调 MiniMax")
    parser.add_argument("--sleep", type=float, default=0.4, help="每条间隔秒数，降低限流风险")
    args = parser.parse_args()
    try:
        return run_batch(
            input_path=args.input.resolve(),
            out_dir=args.out.resolve(),
            dry_run=args.dry_run,
            sleep_s=max(0.0, args.sleep),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"错误：{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
