# -*- coding: utf-8 -*-
"""Python regressions for scripts/build-ywn-manifest.py (fail-closed + contentVersion)."""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "build-ywn-manifest.py"
SPEC = importlib.util.spec_from_file_location("build_ywn_manifest", MODULE_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
sys.modules["build_ywn_manifest"] = builder
SPEC.loader.exec_module(builder)


def _write(path: Path, text: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _seed_formal_pack(repo: Path, source: Path) -> None:
    asset_id = "sticker_fu_001"
    theme = "spring_festival"
    image = f"{asset_id}.png"
    thumb = f"{asset_id}_thumb.png"
    audio_zh = f"{asset_id}_name_zh.mp3"
    audio_en = f"{asset_id}_name_en.mp3"
    audio_intro = f"{asset_id}_intro_zh.mp3"

    for name, body in (
        (image, "IMAGE-V1"),
        (thumb, "THUMB-V1"),
        (audio_zh, "AZH-V1"),
        (audio_en, "AEN-V1"),
        (audio_intro, "AINTRO-V1"),
    ):
        if name.endswith(".png"):
            _write(source / theme / "stickers" / name, body)
        else:
            _write(source / "audio" / name, body)

    # Minimal published formal artifacts
    generated = repo / "assets" / "generated"
    material = generated / "material"
    audio = generated / "audio"
    material.mkdir(parents=True, exist_ok=True)
    audio.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / theme / "stickers" / image, material / image)
    shutil.copy2(source / theme / "stickers" / thumb, material / thumb)
    for name in (audio_zh, audio_en, audio_intro):
        shutil.copy2(source / "audio" / name, audio / name)

    record = {
        "assetId": asset_id,
        "type": "sticker",
        "themeId": theme,
        "categoryIds": ["festival_decoration"],
        "nameZh": "福字",
        "nameEn": "Fu",
        "introZh": "intro",
        "keywords": ["春节"],
        "imageUrl": f"felt-resource://material/{image}",
        "thumbnailUrl": f"felt-resource://material/{thumb}",
        "audio": {
            "nameZhUrl": f"felt-resource://audio/{audio_zh}",
            "nameEnUrl": f"felt-resource://audio/{audio_en}",
            "introZhUrl": f"felt-resource://audio/{audio_intro}",
        },
        "contentVersion": 3,
        "status": "ready",
        "source": "Midjourney",
        "license": "MJ",
    }
    snap = "snapshot_ywn_test_published_001"
    manifest = {
        "schemaVersion": 1,
        "assetSnapshotId": snap,
        "generatedAt": "2026-08-05T00:00:00.000Z",
        "sourcePack": "test",
        "assets": [record],
        "snapshotContext": {"snapshots": {snap: [{"assetId": asset_id, "type": "sticker"}]}},
    }
    payload = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (generated / "assets.manifest.json").write_text(payload, encoding="utf-8")
    renderer = repo / "src" / "renderer" / "src" / "catalog"
    renderer.mkdir(parents=True, exist_ok=True)
    (renderer / "assets.manifest.json").write_text(payload, encoding="utf-8")

    projection = builder.content_projection(
        record,
        {
            "image": builder.sha256_file(material / image),
            "thumbnail": builder.sha256_file(material / thumb),
            "preSplit": "",
            "nameZhAudio": builder.sha256_file(audio / audio_zh),
            "nameEnAudio": builder.sha256_file(audio / audio_en),
            "introZhAudio": builder.sha256_file(audio / audio_intro),
        },
    )
    versions = {
        "updatedAt": "2026-08-05T00:00:00.000Z",
        "assets": {
            asset_id: {"contentVersion": 3, "projection": projection},
            "sticker_historical_001": {
                "contentVersion": 7,
                "projection": builder.content_projection(
                    {"assetId": "sticker_historical_001", "type": "sticker", "audio": {}},
                    {},
                ),
            },
        },
    }
    (generated / "content-versions.json").write_text(
        json.dumps(versions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _write_xlsx(path: Path, headers: list[str], rows: list[list[str]]) -> None:
    from openpyxl import Workbook

    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "01_正式素材_可填"
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)


HEADERS = [
    "assetId",
    "type",
    "themeId",
    "categoryId",
    "nameZh",
    "nameEn",
    "introZh",
    "keywords",
    "imageFileName",
    "thumbnailFileName",
    "preSplitFileName",
    "source",
    "license",
    "licenseStatus",
    "audioNameZhPath",
    "audioNameEnPath",
    "audioIntroZhPath",
    "owner",
    "status",
]


def _ready_row(**overrides: str) -> list[str]:
    base = {
        "assetId": "sticker_fu_001",
        "type": "sticker",
        "themeId": "spring_festival",
        "categoryId": "festival_decoration",
        "nameZh": "福字",
        "nameEn": "Fu",
        "introZh": "intro",
        "keywords": "春节",
        "imageFileName": "sticker_fu_001.png",
        "thumbnailFileName": "sticker_fu_001_thumb.png",
        "preSplitFileName": "",
        "source": "Midjourney",
        "license": "MJ",
        "licenseStatus": "approved",
        "audioNameZhPath": "felt-resource://audio/sticker_fu_001_name_zh.mp3",
        "audioNameEnPath": "felt-resource://audio/sticker_fu_001_name_en.mp3",
        "audioIntroZhPath": "felt-resource://audio/sticker_fu_001_intro_zh.mp3",
        "owner": "YWN",
        "status": "ready",
    }
    base.update(overrides)
    return [base[h] for h in HEADERS]


class BuildYwnManifestTests(unittest.TestCase):
    def test_fail_closed_preserves_published_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            _seed_formal_pack(repo, source)

            manifest_path = repo / "assets" / "generated" / "assets.manifest.json"
            versions_path = repo / "assets" / "generated" / "content-versions.json"
            renderer_path = repo / "src" / "renderer" / "src" / "catalog" / "assets.manifest.json"
            image_path = repo / "assets" / "generated" / "material" / "sticker_fu_001.png"
            before = {
                "manifest": manifest_path.read_text(encoding="utf-8"),
                "versions": versions_path.read_text(encoding="utf-8"),
                "renderer": renderer_path.read_text(encoding="utf-8"),
                "image": image_path.read_bytes(),
            }

            # Bad licenseStatus → fail; must not rewrite published pack.
            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row(licenseStatus="")],
            )

            code = builder.build_manifest(
                source_root=source,
                snapshot_id="snapshot_ywn_should_not_publish",
                repo_root=repo,
                manifest_path=manifest_path,
                renderer_manifest=renderer_path,
                versions_path=versions_path,
                report_path=repo / "assets" / "generated" / "validation-report.json",
                sample_path=repo / "docs" / "sample.md",
            )
            self.assertEqual(code, 1)
            self.assertEqual(manifest_path.read_text(encoding="utf-8"), before["manifest"])
            self.assertEqual(versions_path.read_text(encoding="utf-8"), before["versions"])
            self.assertEqual(renderer_path.read_text(encoding="utf-8"), before["renderer"])
            self.assertEqual(image_path.read_bytes(), before["image"])
            report = json.loads(
                (repo / "assets" / "generated" / "validation-report.json").read_text(encoding="utf-8")
            )
            self.assertEqual(report["failed"], 1)
            self.assertFalse(report["published"])

    def test_media_hash_change_bumps_content_version_and_keeps_history(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            _seed_formal_pack(repo, source)

            # Same filename, different bytes → version must bump 3 → 4
            (source / "spring_festival" / "stickers" / "sticker_fu_001.png").write_text(
                "IMAGE-V2-CHANGED", encoding="utf-8"
            )
            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row()],
            )

            manifest_path = repo / "assets" / "generated" / "assets.manifest.json"
            versions_path = repo / "assets" / "generated" / "content-versions.json"
            renderer_path = repo / "src" / "renderer" / "src" / "catalog" / "assets.manifest.json"

            code = builder.build_manifest(
                source_root=source,
                snapshot_id="snapshot_ywn_test_new_002",
                repo_root=repo,
                manifest_path=manifest_path,
                renderer_manifest=renderer_path,
                versions_path=versions_path,
                report_path=repo / "assets" / "generated" / "validation-report.json",
                sample_path=repo / "docs" / "sample.md",
            )
            self.assertEqual(code, 0)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["assets"][0]["contentVersion"], 4)
            versions = json.loads(versions_path.read_text(encoding="utf-8"))
            self.assertEqual(versions["assets"]["sticker_fu_001"]["contentVersion"], 4)
            # Historical assetId absent from this ready batch must remain.
            self.assertEqual(versions["assets"]["sticker_historical_001"]["contentVersion"], 7)
            self.assertIn("mediaHashes", versions["assets"]["sticker_fu_001"]["projection"])
            self.assertTrue(versions["assets"]["sticker_fu_001"]["projection"]["mediaHashes"]["image"])

    def test_background_presplit_and_stem_mismatch_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            _seed_formal_pack(repo, source)
            manifest_path = repo / "assets" / "generated" / "assets.manifest.json"
            before = manifest_path.read_text(encoding="utf-8")

            bg = "background_demo_001"
            _write(source / "spring_festival" / "backgrounds" / f"{bg}.png", "BG")
            _write(source / "spring_festival" / "backgrounds" / f"{bg}_thumb.png", "BGT")
            _write(source / "spring_festival" / "backgrounds" / "oops_presplit.png", "PS")
            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [
                    _ready_row(
                        assetId=bg,
                        type="background",
                        categoryId="festival_scene",
                        imageFileName=f"{bg}.png",
                        thumbnailFileName=f"{bg}_thumb.png",
                        preSplitFileName="oops_presplit.png",
                        audioNameZhPath="",
                        audioNameEnPath="",
                        audioIntroZhPath="",
                    ),
                    _ready_row(imageFileName="wrong_stem.png"),  # stem mismatch + missing file
                ],
            )

            code = builder.build_manifest(
                source_root=source,
                snapshot_id="snapshot_ywn_fail_rules",
                repo_root=repo,
                manifest_path=manifest_path,
                renderer_manifest=repo / "src" / "renderer" / "src" / "catalog" / "assets.manifest.json",
                versions_path=repo / "assets" / "generated" / "content-versions.json",
                report_path=repo / "assets" / "generated" / "validation-report.json",
                sample_path=repo / "docs" / "sample.md",
            )
            self.assertEqual(code, 1)
            self.assertEqual(manifest_path.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
