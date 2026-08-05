# -*- coding: utf-8 -*-
"""Convert YWN Feishu export pack → Program Manifest (SXY)."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

DEFAULT_SOURCE = Path(r"C:\Users\xingx\Desktop\felt-ywn-v3")
REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_MANIFEST = REPO_ROOT / "assets" / "generated" / "assets.manifest.json"
OUT_REPORT = REPO_ROOT / "assets" / "generated" / "validation-report.json"
OUT_VERSIONS = REPO_ROOT / "assets" / "generated" / "content-versions.json"
OUT_SAMPLE = REPO_ROOT / "docs" / "workflows" / "ywn-sample-sticker-fu-001.md"
MATERIAL_OUT = REPO_ROOT / "assets" / "generated" / "material"
AUDIO_OUT = REPO_ROOT / "assets" / "generated" / "audio"
RENDERER_MANIFEST = REPO_ROOT / "src" / "renderer" / "src" / "catalog" / "assets.manifest.json"

FELT_AUDIO = re.compile(r"^felt-resource://audio/([A-Za-z0-9][A-Za-z0-9._/-]*)$")
# Resolver charset allows hyphen; new filenames still prefer underscore by convention.
SAFE_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")

PROJECTION_KEYS = (
    "type",
    "themeId",
    "categoryIds",
    "nameZh",
    "nameEn",
    "introZh",
    "keywords",
    "imageUrl",
    "thumbnailUrl",
    "preSplitDataUrl",
    "audio",
    "source",
    "license",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_snapshot_id(now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d_%H%M%S")
    return f"snapshot_ywn_{stamp}"


def header_index(headers: list[str]) -> dict[str, int]:
    mapping = {}
    for i, raw in enumerate(headers):
        h = str(raw or "")
        key = h.split("（")[0].split("(")[0].strip()
        if key:
            mapping[key] = i
    return mapping


def cell(row, idx: dict[str, int], key: str) -> str:
    i = idx.get(key)
    if i is None or i >= len(row) or row[i] is None:
        return ""
    return str(row[i]).strip()


def split_keywords(raw: str) -> list[str]:
    parts = re.split(r"[,，]", raw)
    seen = set()
    out = []
    for part in parts:
        item = part.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def parse_audio_ref(raw: str) -> str | None:
    if not raw:
        return None
    m = FELT_AUDIO.match(raw)
    if m:
        return f"felt-resource://audio/{m.group(1)}"
    if SAFE_FILE.match(raw) and raw.endswith((".mp3", ".wav")):
        return f"felt-resource://audio/{raw}"
    return None


def find_theme_file(source_root: Path, theme_id: str, relative: str) -> Path | None:
    candidates = [
        source_root / theme_id / "stickers" / relative,
        source_root / theme_id / "backgrounds" / relative,
        source_root / theme_id / "thumbnails" / relative,
        source_root / "shared" / "audio" / relative,
        source_root / "audio" / relative,
    ]
    for path in candidates:
        if path.is_file():
            return path
    audio_dir = source_root / "audio"
    if audio_dir.is_dir():
        for path in audio_dir.glob(f"*_{relative}"):
            if path.is_file():
                return path
    return None


def content_projection(record: dict) -> dict:
    audio = record.get("audio") or {}
    return {
        "type": record.get("type"),
        "themeId": record.get("themeId"),
        "categoryIds": list(record.get("categoryIds") or []),
        "nameZh": record.get("nameZh"),
        "nameEn": record.get("nameEn"),
        "introZh": record.get("introZh"),
        "keywords": list(record.get("keywords") or []),
        "imageUrl": record.get("imageUrl") or "",
        "thumbnailUrl": record.get("thumbnailUrl") or "",
        "preSplitDataUrl": record.get("preSplitDataUrl") or "",
        "audio": {
            "nameZhUrl": audio.get("nameZhUrl") or "",
            "nameEnUrl": audio.get("nameEnUrl") or "",
            "introZhUrl": audio.get("introZhUrl") or "",
        },
        "source": record.get("source") or "",
        "license": record.get("license") or "",
    }


def resolve_content_version(asset_id: str, projection: dict, prior: dict[str, dict]) -> int:
    prev = prior.get(asset_id)
    if not prev:
        return 1
    old_version = int(prev.get("contentVersion") or 1)
    old_projection = prev.get("projection")
    if old_projection == projection:
        return old_version
    return old_version + 1


def load_prior_versions() -> dict[str, dict]:
    if OUT_VERSIONS.is_file():
        raw = json.loads(OUT_VERSIONS.read_text(encoding="utf-8"))
        return raw.get("assets") if isinstance(raw, dict) else {}
    if OUT_MANIFEST.is_file():
        manifest = json.loads(OUT_MANIFEST.read_text(encoding="utf-8"))
        assets = manifest.get("assets") or []
        out: dict[str, dict] = {}
        for asset in assets:
            asset_id = asset.get("assetId")
            if not asset_id:
                continue
            out[asset_id] = {
                "contentVersion": int(asset.get("contentVersion") or 1),
                "projection": content_projection(asset),
            }
        return out
    return {}


def load_ready_rows(source_root: Path) -> tuple[list[dict], list[dict]]:
    rows_out: list[dict] = []
    issues: list[dict] = []
    seen_ids: set[str] = set()
    xlsx_files = sorted(source_root.rglob("feishu_fields_*.xlsx"))
    for path in xlsx_files:
        wb = load_workbook(path, data_only=True)
        if "01_正式素材_可填" not in wb.sheetnames:
            continue
        ws = wb["01_正式素材_可填"]
        data = list(ws.iter_rows(values_only=True))
        if not data:
            continue
        idx = header_index([str(c) if c is not None else "" for c in data[0]])
        for row in data[1:]:
            if not row:
                continue
            asset_id = cell(row, idx, "assetId")
            status = cell(row, idx, "status")
            if not asset_id or status != "ready":
                continue
            if asset_id in seen_ids:
                issues.append(
                    {
                        "assetId": asset_id,
                        "errors": [f"duplicate assetId: {asset_id}"],
                        "sourceSheet": str(path.relative_to(source_root)),
                    }
                )
                continue
            seen_ids.add(asset_id)
            rows_out.append(
                {
                    "sourceSheet": str(path.relative_to(source_root)),
                    "assetId": asset_id,
                    "type": cell(row, idx, "type"),
                    "themeId": cell(row, idx, "themeId"),
                    "categoryId": cell(row, idx, "categoryId"),
                    "nameZh": cell(row, idx, "nameZh"),
                    "nameEn": cell(row, idx, "nameEn"),
                    "introZh": cell(row, idx, "introZh"),
                    "imageFileName": cell(row, idx, "imageFileName"),
                    "thumbnailFileName": cell(row, idx, "thumbnailFileName"),
                    "source": cell(row, idx, "source"),
                    "license": cell(row, idx, "license"),
                    "licenseStatus": cell(row, idx, "licenseStatus"),
                    "audioNameZhPath": cell(row, idx, "audioNameZhPath"),
                    "audioNameEnPath": cell(row, idx, "audioNameEnPath"),
                    "audioIntroZhPath": cell(row, idx, "audioIntroZhPath"),
                    "owner": cell(row, idx, "owner"),
                    "status": status,
                    "keywords": cell(row, idx, "keywords"),
                }
            )
    return rows_out, issues


def convert_row(
    row: dict,
    source_root: Path,
    prior_versions: dict[str, dict],
) -> tuple[dict | None, list[str], dict]:
    errors: list[str] = []
    copies: dict[str, Path] = {}

    # Strict gate: empty licenseStatus also fails.
    if row["licenseStatus"] != "approved":
        errors.append(f"licenseStatus must be approved for ready (got {row['licenseStatus']!r})")

    if row["type"] not in ("background", "sticker"):
        errors.append(f"invalid type {row['type']}")

    category = row["categoryId"].strip()
    if not category:
        errors.append("categoryId empty")

    image_name = row["imageFileName"]
    if not image_name or not SAFE_FILE.match(image_name):
        errors.append(f"bad imageFileName: {image_name!r}")
    else:
        src = find_theme_file(source_root, row["themeId"], image_name)
        if not src:
            errors.append(f"missing image file {image_name}")
        else:
            copies[f"material/{image_name}"] = src

    thumb_name = row["thumbnailFileName"]
    thumb_ref = None
    if thumb_name:
        if not SAFE_FILE.match(thumb_name):
            errors.append(f"bad thumbnailFileName: {thumb_name!r}")
        else:
            src = find_theme_file(source_root, row["themeId"], thumb_name)
            if not src:
                errors.append(f"missing thumbnail file {thumb_name}")
            else:
                copies[f"material/{thumb_name}"] = src
                thumb_ref = f"felt-resource://material/{thumb_name}"

    audio: dict[str, str] = {}
    for field, key in (
        ("audioNameZhPath", "nameZhUrl"),
        ("audioNameEnPath", "nameEnUrl"),
        ("audioIntroZhPath", "introZhUrl"),
    ):
        ref = parse_audio_ref(row[field])
        if row[field] and not ref:
            errors.append(f"invalid audio path {field}={row[field]!r}")
            continue
        if not ref:
            continue
        file_name = ref.split("/")[-1]
        src = find_theme_file(source_root, row["themeId"], file_name)
        if not src:
            errors.append(f"missing audio file {file_name}")
        else:
            copies[f"audio/{file_name}"] = src
            audio[key] = ref

    draft = {
        "assetId": row["assetId"],
        "type": row["type"],
        "themeId": row["themeId"],
        "categoryIds": [category] if category else [],
        "nameZh": row["nameZh"],
        "nameEn": row["nameEn"],
        "introZh": row["introZh"],
        "keywords": split_keywords(row["keywords"]),
        "imageUrl": f"felt-resource://material/{image_name}" if image_name else "",
        "audio": audio,
        "status": "ready",
    }
    if thumb_ref:
        draft["thumbnailUrl"] = thumb_ref
    if row["source"]:
        draft["source"] = row["source"]
    if row["license"]:
        draft["license"] = row["license"]

    projection = content_projection(draft)
    version = resolve_content_version(row["assetId"], projection, prior_versions)
    draft["contentVersion"] = version

    if errors:
        return None, errors, copies
    return draft, [], copies


def assert_snapshot_immutable(snapshot_id: str, next_manifest: dict) -> None:
    if not OUT_MANIFEST.is_file():
        return
    previous = json.loads(OUT_MANIFEST.read_text(encoding="utf-8"))
    prev_id = previous.get("assetSnapshotId")
    if prev_id != snapshot_id:
        return
    # Same snapshot id must not be rewritten with different payload.
    prev_cmp = {
        "assets": previous.get("assets"),
        "snapshotContext": previous.get("snapshotContext"),
    }
    next_cmp = {
        "assets": next_manifest.get("assets"),
        "snapshotContext": next_manifest.get("snapshotContext"),
    }
    if prev_cmp != next_cmp:
        raise SystemExit(
            f"Refusing to overwrite published snapshotId={snapshot_id}. Generate a new snapshotId."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build formal YWN Asset Manifest")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--snapshot-id",
        default="",
        help="Optional snapshot id. Default: snapshot_ywn_YYYYMMDD_HHMMSS (always new).",
    )
    args = parser.parse_args(argv)

    source_root: Path = args.source
    if not source_root.is_dir():
        print(f"SOURCE_ROOT missing: {source_root}", file=sys.stderr)
        return 2

    prior_versions = load_prior_versions()
    rows, duplicate_issues = load_ready_rows(source_root)
    assets: list[dict] = []
    issues: list[dict] = list(duplicate_issues)
    all_copies: dict[str, Path] = {}
    next_versions: dict[str, dict] = {}

    for row in rows:
        record, errors, copies = convert_row(row, source_root, prior_versions)
        if errors:
            issues.append({"assetId": row["assetId"], "errors": errors, "sourceSheet": row["sourceSheet"]})
            continue
        assert record is not None
        assets.append(record)
        all_copies.update(copies)
        next_versions[record["assetId"]] = {
            "contentVersion": record["contentVersion"],
            "projection": content_projection(record),
        }

    snapshot_id = args.snapshot_id.strip() or new_snapshot_id()
    generated_at = utc_now()
    snapshot_assets = [{"assetId": a["assetId"], "type": a["type"]} for a in assets]

    MATERIAL_OUT.mkdir(parents=True, exist_ok=True)
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    copied = []
    for rel, src in sorted(all_copies.items()):
        dest = REPO_ROOT / "assets" / "generated" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied.append({"from": str(src), "to": str(dest.relative_to(REPO_ROOT))})

    manifest = {
        "schemaVersion": 1,
        "assetSnapshotId": snapshot_id,
        "generatedAt": generated_at,
        "sourcePack": "归档(3).zip",
        "assets": assets,
        "snapshotContext": {"snapshots": {snapshot_id: snapshot_assets}},
    }
    assert_snapshot_immutable(snapshot_id, manifest)

    OUT_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    OUT_MANIFEST.write_text(payload, encoding="utf-8")
    RENDERER_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    RENDERER_MANIFEST.write_text(payload, encoding="utf-8")

    OUT_VERSIONS.write_text(
        json.dumps({"updatedAt": generated_at, "assets": next_versions}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    report = {
        "generatedAt": generated_at,
        "readyRowsSeen": len(rows),
        "imported": len(assets),
        "failed": len(issues),
        "assetSnapshotId": snapshot_id,
        "issues": issues,
        "copiedFiles": len(copied),
        "notes": [
            "owner is kept only in build report workflow, not AssetRecord",
            "contentVersion continues from assets/generated/content-versions.json",
            "licenseStatus must equal approved (empty fails)",
            "duplicate assetId fails into report",
            "review rows were skipped",
            "felt-resource resolver allows [A-Za-z0-9._/-]; underscore is a naming preference only",
        ],
        "failedDetails": issues,
        "projectionKeys": list(PROJECTION_KEYS),
    }
    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sample_row = next((r for r in rows if r["assetId"] == "sticker_fu_001"), None)
    sample_asset = next((a for a in assets if a["assetId"] == "sticker_fu_001"), None)
    if sample_row and sample_asset:
        sample_md = f"""# YWN 单条试转复核：sticker_fu_001

**来源包：** 归档(3).zip  
**assetSnapshotId：** `{snapshot_id}`  
**生成时间：** `{generated_at}`

## 1. 原始飞书行（春节表）

```json
{json.dumps(sample_row, ensure_ascii=False, indent=2)}
```

## 2. 转换后 AssetRecord

```json
{json.dumps(sample_asset, ensure_ascii=False, indent=2)}
```

## 3. assetSnapshotId

`{snapshot_id}`（本批正式快照；与单条 `contentVersion` 分开；已发布 snapshotId 不可覆盖）

## 4. validateAssetRecord

见 `tests/assets/manifest-validation.test.ts`（`FELT_RESOURCE_REF_POLICY`）。

## 5. ResourceRef 文件存在性

| ref | 打包路径 | 存在 |
| --- | --- | --- |
| `{sample_asset["imageUrl"]}` | `assets/generated/material/sticker_fu_001.png` | yes |
| `{sample_asset.get("thumbnailUrl")}` | `assets/generated/material/sticker_fu_001_thumb.png` | yes |
| `{sample_asset["audio"].get("nameZhUrl")}` | `assets/generated/audio/sticker_fu_001_name_zh.mp3` | yes |
| `{sample_asset["audio"].get("nameEnUrl")}` | `assets/generated/audio/sticker_fu_001_name_en.mp3` | yes |
| `{sample_asset["audio"].get("introZhUrl")}` | `assets/generated/audio/sticker_fu_001_intro_zh.mp3` | yes |

说明：未向 Renderer 暴露 OS 路径；上表仅供 SXY/ZXR 构建复核。
"""
        OUT_SAMPLE.write_text(sample_md, encoding="utf-8")

    summary = {"imported": len(assets), "failed": len(issues), "snapshot": snapshot_id}
    print(json.dumps(summary, ensure_ascii=False))
    if issues:
        print(json.dumps(issues, ensure_ascii=False, indent=2))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
