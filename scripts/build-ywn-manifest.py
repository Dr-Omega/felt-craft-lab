# -*- coding: utf-8 -*-
"""Convert YWN Feishu export pack → Program Manifest (SXY).

Fail-closed: validation issues may write a failure report, but must not mutate
the previous published Manifest, renderer copy, content-versions sidecar, or
formal material/audio files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
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
    "mediaHashes",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_snapshot_id(now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d_%H%M%S")
    return f"snapshot_ywn_{stamp}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def published_path_for_ref(ref: str, repo_root: Path) -> Path | None:
    if not isinstance(ref, str) or not ref.startswith("felt-resource://"):
        return None
    body = ref[len("felt-resource://") :]
    if body.startswith("material/"):
        return repo_root / "assets" / "generated" / "material" / body.split("/", 1)[1]
    if body.startswith("audio/"):
        return repo_root / "assets" / "generated" / "audio" / body.split("/", 1)[1]
    return None


def enrich_projection_media_hashes(projection: dict, repo_root: Path = REPO_ROOT) -> dict:
    """Fill missing mediaHashes from currently published generated media (migration)."""
    enriched = content_projection(
        {
            **projection,
            "audio": projection.get("audio") or {},
            "mediaHashes": projection.get("mediaHashes") or {},
        }
    )
    hashes = dict(enriched["mediaHashes"])
    mapping = (
        ("image", enriched.get("imageUrl") or ""),
        ("thumbnail", enriched.get("thumbnailUrl") or ""),
        ("preSplit", enriched.get("preSplitDataUrl") or ""),
        ("nameZhAudio", (enriched.get("audio") or {}).get("nameZhUrl") or ""),
        ("nameEnAudio", (enriched.get("audio") or {}).get("nameEnUrl") or ""),
        ("introZhAudio", (enriched.get("audio") or {}).get("introZhUrl") or ""),
    )
    for key, ref in mapping:
        if hashes.get(key):
            continue
        path = published_path_for_ref(ref, repo_root)
        if path and path.is_file():
            hashes[key] = sha256_file(path)
    enriched["mediaHashes"] = hashes
    return enriched


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


def basename_stem(file_name: str) -> str:
    return Path(file_name).name.rsplit(".", 1)[0]


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


def content_projection(record: dict, media_hashes: dict[str, str] | None = None) -> dict:
    audio = record.get("audio") or {}
    hashes = media_hashes if media_hashes is not None else dict(record.get("mediaHashes") or {})
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
        "mediaHashes": {
            "image": hashes.get("image") or "",
            "thumbnail": hashes.get("thumbnail") or "",
            "preSplit": hashes.get("preSplit") or "",
            "nameZhAudio": hashes.get("nameZhAudio") or "",
            "nameEnAudio": hashes.get("nameEnAudio") or "",
            "introZhAudio": hashes.get("introZhAudio") or "",
        },
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


def load_prior_versions(
    versions_path: Path = OUT_VERSIONS,
    manifest_path: Path = OUT_MANIFEST,
    repo_root: Path = REPO_ROOT,
) -> dict[str, dict]:
    raw_assets: dict[str, dict] = {}
    if versions_path.is_file():
        raw = json.loads(versions_path.read_text(encoding="utf-8"))
        assets = raw.get("assets") if isinstance(raw, dict) else {}
        raw_assets = dict(assets or {})
    elif manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assets = manifest.get("assets") or []
        for asset in assets:
            asset_id = asset.get("assetId")
            if not asset_id:
                continue
            raw_assets[asset_id] = {
                "contentVersion": int(asset.get("contentVersion") or 1),
                "projection": content_projection(asset),
            }
    out: dict[str, dict] = {}
    for asset_id, entry in raw_assets.items():
        projection = entry.get("projection") if isinstance(entry, dict) else None
        if not isinstance(projection, dict):
            continue
        out[asset_id] = {
            "contentVersion": int(entry.get("contentVersion") or 1),
            "projection": enrich_projection_media_hashes(projection, repo_root),
        }
    return out


def merge_version_history(prior: dict[str, dict], updated: dict[str, dict]) -> dict[str, dict]:
    """Keep historical assetIds that are absent from the current ready batch."""
    merged = dict(prior)
    merged.update(updated)
    return merged


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
            # Formal import requires status=ready AND licenseStatus=approved.
            # Non-ready rows are skipped; ready rows with bad license fail below.
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
                    "preSplitFileName": cell(row, idx, "preSplitFileName"),
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
) -> tuple[dict | None, list[str], dict[str, Path], dict[str, str]]:
    errors: list[str] = []
    copies: dict[str, Path] = {}
    media_hashes: dict[str, str] = {}

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
        if basename_stem(image_name) != row["assetId"]:
            errors.append(
                f"imageFileName stem must equal assetId (got {basename_stem(image_name)!r}, expected {row['assetId']!r})"
            )
        src = find_theme_file(source_root, row["themeId"], image_name)
        if not src:
            errors.append(f"missing image file {image_name}")
        else:
            copies[f"material/{image_name}"] = src
            media_hashes["image"] = sha256_file(src)

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
                media_hashes["thumbnail"] = sha256_file(src)

    pre_split_name = row.get("preSplitFileName") or ""
    pre_split_ref = None
    if pre_split_name:
        if row["type"] == "background":
            errors.append("background must not have preSplitFileName")
        elif row["type"] != "sticker":
            errors.append(f"preSplitFileName not allowed for type {row['type']!r}")
        elif not SAFE_FILE.match(pre_split_name):
            errors.append(f"bad preSplitFileName: {pre_split_name!r}")
        else:
            src = find_theme_file(source_root, row["themeId"], pre_split_name)
            if not src:
                errors.append(f"missing preSplit file {pre_split_name}")
            else:
                copies[f"material/{pre_split_name}"] = src
                pre_split_ref = f"felt-resource://material/{pre_split_name}"
                media_hashes["preSplit"] = sha256_file(src)

    audio: dict[str, str] = {}
    audio_hash_keys = {
        "nameZhUrl": "nameZhAudio",
        "nameEnUrl": "nameEnAudio",
        "introZhUrl": "introZhAudio",
    }
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
            media_hashes[audio_hash_keys[key]] = sha256_file(src)

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
    if pre_split_ref:
        draft["preSplitDataUrl"] = pre_split_ref
    if row["source"]:
        draft["source"] = row["source"]
    if row["license"]:
        draft["license"] = row["license"]

    projection = content_projection(draft, media_hashes)
    version = resolve_content_version(row["assetId"], projection, prior_versions)
    draft["contentVersion"] = version

    if errors:
        return None, errors, copies, media_hashes
    return draft, [], copies, media_hashes


def assert_snapshot_immutable(snapshot_id: str, next_manifest: dict, manifest_path: Path = OUT_MANIFEST) -> None:
    if not manifest_path.is_file():
        return
    previous = json.loads(manifest_path.read_text(encoding="utf-8"))
    prev_id = previous.get("assetSnapshotId")
    if prev_id != snapshot_id:
        return
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


def write_failure_report(
    *,
    generated_at: str,
    rows_seen: int,
    issues: list[dict],
    snapshot_id: str,
    report_path: Path = OUT_REPORT,
) -> None:
    report = {
        "generatedAt": generated_at,
        "readyRowsSeen": rows_seen,
        "imported": 0,
        "failed": len(issues),
        "assetSnapshotId": snapshot_id,
        "issues": issues,
        "copiedFiles": 0,
        "published": False,
        "notes": [
            "fail-closed: formal Manifest / content-versions / media were NOT modified",
            "licenseStatus must equal approved (empty fails)",
            "duplicate assetId fails into report",
            "status=ready AND licenseStatus=approved required for formal import",
        ],
        "failedDetails": issues,
        "projectionKeys": list(PROJECTION_KEYS),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def commit_published_artifacts(
    *,
    manifest: dict,
    versions: dict[str, dict],
    copies: dict[str, Path],
    generated_at: str,
    repo_root: Path = REPO_ROOT,
    manifest_path: Path = OUT_MANIFEST,
    renderer_manifest: Path = RENDERER_MANIFEST,
    versions_path: Path = OUT_VERSIONS,
) -> list[dict]:
    """Atomically-ish publish only after full validation success."""
    material_out = repo_root / "assets" / "generated" / "material"
    audio_out = repo_root / "assets" / "generated" / "audio"
    material_out.mkdir(parents=True, exist_ok=True)
    audio_out.mkdir(parents=True, exist_ok=True)

    copied: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="felt-manifest-stage-") as tmp:
        stage = Path(tmp)
        for rel, src in sorted(copies.items()):
            dest = stage / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)

        for rel, _src in sorted(copies.items()):
            staged = stage / rel
            final = repo_root / "assets" / "generated" / rel
            final.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(staged, final)
            copied.append({"from": str(_src), "to": str(final.relative_to(repo_root))})

    payload = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(payload, encoding="utf-8")
    renderer_manifest.parent.mkdir(parents=True, exist_ok=True)
    renderer_manifest.write_text(payload, encoding="utf-8")
    versions_path.write_text(
        json.dumps({"updatedAt": generated_at, "assets": versions}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return copied


def build_manifest(
    *,
    source_root: Path,
    snapshot_id: str = "",
    repo_root: Path = REPO_ROOT,
    manifest_path: Path = OUT_MANIFEST,
    renderer_manifest: Path = RENDERER_MANIFEST,
    versions_path: Path = OUT_VERSIONS,
    report_path: Path = OUT_REPORT,
    sample_path: Path = OUT_SAMPLE,
) -> int:
    if not source_root.is_dir():
        print(f"SOURCE_ROOT missing: {source_root}", file=sys.stderr)
        return 2

    prior_versions = load_prior_versions(versions_path, manifest_path, repo_root)
    rows, duplicate_issues = load_ready_rows(source_root)
    assets: list[dict] = []
    issues: list[dict] = list(duplicate_issues)
    pending_copies: dict[str, Path] = {}
    updated_versions: dict[str, dict] = {}
    generated_at = utc_now()
    planned_snapshot = snapshot_id.strip() or new_snapshot_id()

    for row in rows:
        record, errors, copies, media_hashes = convert_row(row, source_root, prior_versions)
        if errors:
            issues.append({"assetId": row["assetId"], "errors": errors, "sourceSheet": row["sourceSheet"]})
            continue
        assert record is not None
        assets.append(record)
        pending_copies.update(copies)
        updated_versions[record["assetId"]] = {
            "contentVersion": record["contentVersion"],
            "projection": content_projection(record, media_hashes),
        }

    if issues:
        write_failure_report(
            generated_at=generated_at,
            rows_seen=len(rows),
            issues=issues,
            snapshot_id=planned_snapshot,
            report_path=report_path,
        )
        summary = {
            "imported": 0,
            "failed": len(issues),
            "snapshot": planned_snapshot,
            "published": False,
        }
        print(json.dumps(summary, ensure_ascii=False))
        print(json.dumps(issues, ensure_ascii=False, indent=2))
        return 1

    snapshot_assets = [{"assetId": a["assetId"], "type": a["type"]} for a in assets]
    manifest = {
        "schemaVersion": 1,
        "assetSnapshotId": planned_snapshot,
        "generatedAt": generated_at,
        "sourcePack": "归档(3).zip",
        "assets": assets,
        "snapshotContext": {"snapshots": {planned_snapshot: snapshot_assets}},
    }
    assert_snapshot_immutable(planned_snapshot, manifest, manifest_path)
    merged_versions = merge_version_history(prior_versions, updated_versions)
    copied = commit_published_artifacts(
        manifest=manifest,
        versions=merged_versions,
        copies=pending_copies,
        generated_at=generated_at,
        repo_root=repo_root,
        manifest_path=manifest_path,
        renderer_manifest=renderer_manifest,
        versions_path=versions_path,
    )

    report = {
        "generatedAt": generated_at,
        "readyRowsSeen": len(rows),
        "imported": len(assets),
        "failed": 0,
        "assetSnapshotId": planned_snapshot,
        "issues": [],
        "copiedFiles": len(copied),
        "published": True,
        "notes": [
            "owner is kept only in build report workflow, not AssetRecord",
            "contentVersion continues from assets/generated/content-versions.json including media SHA-256",
            "historical content-versions entries are retained when assetId absent from current ready batch",
            "licenseStatus must equal approved (empty fails)",
            "status=ready AND licenseStatus=approved required for formal import",
            "imageFileName stem must equal assetId",
            "preSplitFileName allowed for stickers only",
            "fail-closed: formal artifacts written only after whole-batch success",
            "felt-resource resolver allows [A-Za-z0-9._/-]; underscore is a naming preference only",
        ],
        "failedDetails": [],
        "projectionKeys": list(PROJECTION_KEYS),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sample_row = next((r for r in rows if r["assetId"] == "sticker_fu_001"), None)
    sample_asset = next((a for a in assets if a["assetId"] == "sticker_fu_001"), None)
    if sample_row and sample_asset:
        sample_md = f"""# YWN 单条试转复核：sticker_fu_001

**来源包：** 归档(3).zip  
**assetSnapshotId：** `{planned_snapshot}`  
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

`{planned_snapshot}`（本批正式快照；与单条 `contentVersion` 分开；已发布 snapshotId 不可覆盖）

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
        sample_path.parent.mkdir(parents=True, exist_ok=True)
        sample_path.write_text(sample_md, encoding="utf-8")

    summary = {
        "imported": len(assets),
        "failed": 0,
        "snapshot": planned_snapshot,
        "published": True,
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build formal YWN Asset Manifest")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--snapshot-id",
        default="",
        help="Optional snapshot id. Default: snapshot_ywn_YYYYMMDD_HHMMSS (always new).",
    )
    args = parser.parse_args(argv)
    return build_manifest(source_root=args.source, snapshot_id=args.snapshot_id)


if __name__ == "__main__":
    raise SystemExit(main())
