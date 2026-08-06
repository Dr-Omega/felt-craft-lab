# -*- coding: utf-8 -*-
"""Python regressions for scripts/build-ywn-manifest.py (fail-closed + contentVersion)."""
from __future__ import annotations

import importlib.util
import json
import os
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


def _seed_formal_pack(repo: Path, source: Path, snapshot_id: str = "snapshot_ywn_test_published_001") -> str:
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

    generated = repo / "assets" / "generated"
    material = generated / "material" / snapshot_id
    audio = generated / "audio" / snapshot_id
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
        "imageUrl": f"felt-resource://material/{snapshot_id}/{image}",
        "thumbnailUrl": f"felt-resource://material/{snapshot_id}/{thumb}",
        "audio": {
            "nameZhUrl": f"felt-resource://audio/{snapshot_id}/{audio_zh}",
            "nameEnUrl": f"felt-resource://audio/{snapshot_id}/{audio_en}",
            "introZhUrl": f"felt-resource://audio/{snapshot_id}/{audio_intro}",
        },
        "contentVersion": 3,
        "status": "ready",
        "source": "Midjourney",
        "license": "MJ",
    }
    manifest = {
        "schemaVersion": 1,
        "assetSnapshotId": snapshot_id,
        "generatedAt": "2026-08-05T00:00:00.000Z",
        "sourcePack": "test",
        "assets": [record],
        "snapshotContext": {"snapshots": {snapshot_id: [{"assetId": asset_id, "type": "sticker"}]}},
    }
    payload = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (generated / "assets.manifest.json").write_text(payload, encoding="utf-8")
    snapshot_manifest_dir = generated / "snapshots" / snapshot_id
    snapshot_manifest_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_manifest_dir / "assets.manifest.json").write_text(payload, encoding="utf-8")

    renderer = repo / "src" / "renderer" / "src" / "catalog"
    renderer.mkdir(parents=True, exist_ok=True)
    (renderer / "assets.manifest.json").write_text(payload, encoding="utf-8")
    (renderer / "snapshots").mkdir(parents=True, exist_ok=True)
    (renderer / "snapshots" / f"{snapshot_id}.manifest.json").write_text(payload, encoding="utf-8")

    registry = {
        "latestSnapshotId": snapshot_id,
        "snapshots": {
            snapshot_id: {
                "manifest": f"assets/generated/snapshots/{snapshot_id}/assets.manifest.json",
                "generatedAt": "2026-08-05T00:00:00.000Z",
            }
        },
    }
    registry_payload = json.dumps(registry, ensure_ascii=False, indent=2) + "\n"
    (generated / "snapshot-registry.json").write_text(registry_payload, encoding="utf-8")
    (renderer / "snapshot-registry.json").write_text(registry_payload, encoding="utf-8")

    projection = builder.content_projection(
        record,
        {
            "image": builder.media_identity(image, builder.sha256_file(material / image)),
            "thumbnail": builder.media_identity(thumb, builder.sha256_file(material / thumb)),
            "preSplit": builder.empty_media_identity(),
            "nameZhAudio": builder.media_identity(audio_zh, builder.sha256_file(audio / audio_zh)),
            "nameEnAudio": builder.media_identity(audio_en, builder.sha256_file(audio / audio_en)),
            "introZhAudio": builder.media_identity(
                audio_intro, builder.sha256_file(audio / audio_intro)
            ),
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
    return snapshot_id


def _paths(repo: Path) -> dict[str, Path]:
    generated = repo / "assets" / "generated"
    renderer = repo / "src" / "renderer" / "src" / "catalog"
    return {
        "manifest": generated / "assets.manifest.json",
        "versions": generated / "content-versions.json",
        "registry": generated / "snapshot-registry.json",
        "renderer": renderer / "assets.manifest.json",
        "renderer_registry": renderer / "snapshot-registry.json",
        "report": generated / "validation-report.json",
        "sample": repo / "docs" / "sample.md",
    }


def _build(source: Path, repo: Path, snapshot_id: str) -> int:
    p = _paths(repo)
    return builder.build_manifest(
        source_root=source,
        snapshot_id=snapshot_id,
        repo_root=repo,
        manifest_path=p["manifest"],
        renderer_manifest=p["renderer"],
        versions_path=p["versions"],
        registry_path=p["registry"],
        renderer_registry=p["renderer_registry"],
        report_path=p["report"],
        sample_path=p["sample"],
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
            published_snap = _seed_formal_pack(repo, source)
            p = _paths(repo)

            image_path = (
                repo / "assets" / "generated" / "material" / published_snap / "sticker_fu_001.png"
            )
            snapshot_manifest = (
                repo
                / "assets"
                / "generated"
                / "snapshots"
                / published_snap
                / "assets.manifest.json"
            )
            before = {
                "manifest": p["manifest"].read_text(encoding="utf-8"),
                "versions": p["versions"].read_text(encoding="utf-8"),
                "registry": p["registry"].read_text(encoding="utf-8"),
                "renderer": p["renderer"].read_text(encoding="utf-8"),
                "renderer_registry": p["renderer_registry"].read_text(encoding="utf-8"),
                "snapshot_manifest": snapshot_manifest.read_text(encoding="utf-8"),
                "image": image_path.read_bytes(),
            }

            # Bad licenseStatus → fail; must not rewrite published pack.
            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row(licenseStatus="")],
            )

            code = _build(source, repo, "snapshot_ywn_should_not_publish")
            self.assertEqual(code, 1)
            self.assertEqual(p["manifest"].read_text(encoding="utf-8"), before["manifest"])
            self.assertEqual(p["versions"].read_text(encoding="utf-8"), before["versions"])
            self.assertEqual(p["registry"].read_text(encoding="utf-8"), before["registry"])
            self.assertEqual(p["renderer"].read_text(encoding="utf-8"), before["renderer"])
            self.assertEqual(
                p["renderer_registry"].read_text(encoding="utf-8"), before["renderer_registry"]
            )
            self.assertEqual(
                snapshot_manifest.read_text(encoding="utf-8"), before["snapshot_manifest"]
            )
            self.assertEqual(image_path.read_bytes(), before["image"])
            self.assertFalse(
                (repo / "assets" / "generated" / "snapshots" / "snapshot_ywn_should_not_publish").exists()
            )
            report = json.loads(p["report"].read_text(encoding="utf-8"))
            self.assertEqual(report["failed"], 1)
            self.assertFalse(report["published"])
            registry = json.loads(p["registry"].read_text(encoding="utf-8"))
            self.assertEqual(registry["latestSnapshotId"], published_snap)

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

            new_snap = "snapshot_ywn_test_new_002"
            code = _build(source, repo, new_snap)
            self.assertEqual(code, 0)
            p = _paths(repo)
            manifest = json.loads(p["manifest"].read_text(encoding="utf-8"))
            self.assertEqual(manifest["assetSnapshotId"], new_snap)
            self.assertEqual(manifest["assets"][0]["contentVersion"], 4)
            self.assertEqual(
                manifest["assets"][0]["imageUrl"],
                f"felt-resource://material/{new_snap}/sticker_fu_001.png",
            )
            versions = json.loads(p["versions"].read_text(encoding="utf-8"))
            self.assertEqual(versions["assets"]["sticker_fu_001"]["contentVersion"], 4)
            # Historical assetId absent from this ready batch must remain.
            self.assertEqual(versions["assets"]["sticker_historical_001"]["contentVersion"], 7)
            proj = versions["assets"]["sticker_fu_001"]["projection"]
            self.assertEqual(proj["image"]["logicalName"], "sticker_fu_001.png")
            self.assertTrue(proj["image"]["sha256"])
            self.assertNotIn("imageUrl", proj)
            self.assertTrue(
                (repo / "assets" / "generated" / "material" / new_snap / "sticker_fu_001.png").is_file()
            )
            registry = json.loads(p["registry"].read_text(encoding="utf-8"))
            self.assertEqual(registry["latestSnapshotId"], new_snap)

    def test_same_content_across_snapshots_keeps_content_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            # Fresh repo: publish snap_001 then snap_002 with identical logical bytes.
            for name, body in (
                ("sticker_fu_001.png", "IMAGE-V1"),
                ("sticker_fu_001_thumb.png", "THUMB-V1"),
                ("sticker_fu_001_name_zh.mp3", "AZH-V1"),
                ("sticker_fu_001_name_en.mp3", "AEN-V1"),
                ("sticker_fu_001_intro_zh.mp3", "AINTRO-V1"),
            ):
                if name.endswith(".png"):
                    _write(source / "spring_festival" / "stickers" / name, body)
                else:
                    _write(source / "audio" / name, body)
            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row()],
            )

            snap1 = "snapshot_ywn_same_content_001"
            snap2 = "snapshot_ywn_same_content_002"
            self.assertEqual(_build(source, repo, snap1), 0)
            p = _paths(repo)
            first = json.loads(p["manifest"].read_text(encoding="utf-8"))
            self.assertEqual(first["assets"][0]["contentVersion"], 1)
            ref1 = first["assets"][0]["imageUrl"]

            self.assertEqual(_build(source, repo, snap2), 0)
            second = json.loads(p["manifest"].read_text(encoding="utf-8"))
            versions = json.loads(p["versions"].read_text(encoding="utf-8"))
            self.assertEqual(second["assets"][0]["contentVersion"], 1)
            self.assertEqual(versions["assets"]["sticker_fu_001"]["contentVersion"], 1)
            ref2 = second["assets"][0]["imageUrl"]
            self.assertNotEqual(ref1, ref2)
            self.assertIn(snap1, ref1)
            self.assertIn(snap2, ref2)
            registry = json.loads(p["registry"].read_text(encoding="utf-8"))
            self.assertEqual(registry["latestSnapshotId"], snap2)
            self.assertIn(snap1, registry["snapshots"])
            self.assertIn(snap2, registry["snapshots"])
            self.assertTrue(
                (repo / "assets" / "generated" / "snapshots" / snap1 / "assets.manifest.json").is_file()
            )
            self.assertTrue(
                (repo / "assets" / "generated" / "snapshots" / snap2 / "assets.manifest.json").is_file()
            )

    def test_duplicate_snapshot_id_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            published = _seed_formal_pack(repo, source)
            p = _paths(repo)
            before_registry = p["registry"].read_text(encoding="utf-8")
            before_manifest = p["manifest"].read_text(encoding="utf-8")

            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row()],
            )
            code = _build(source, repo, published)
            self.assertEqual(code, 1)
            self.assertEqual(p["registry"].read_text(encoding="utf-8"), before_registry)
            self.assertEqual(p["manifest"].read_text(encoding="utf-8"), before_manifest)
            report = json.loads(p["report"].read_text(encoding="utf-8"))
            self.assertFalse(report["published"])
            self.assertTrue(any("already exists" in e for issue in report["issues"] for e in issue["errors"]))

    def test_failed_build_does_not_change_latest_snapshot_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            published = _seed_formal_pack(repo, source)
            p = _paths(repo)
            before_latest = json.loads(p["registry"].read_text(encoding="utf-8"))["latestSnapshotId"]

            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row(licenseStatus="pending")],
            )
            code = _build(source, repo, "snapshot_ywn_fail_latest")
            self.assertEqual(code, 1)
            after = json.loads(p["registry"].read_text(encoding="utf-8"))
            self.assertEqual(after["latestSnapshotId"], before_latest)
            self.assertEqual(after["latestSnapshotId"], published)
            self.assertNotIn("snapshot_ywn_fail_latest", after["snapshots"])

    def test_publish_fault_after_snapshot_rolls_back_mutable_and_new_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            snap1 = _seed_formal_pack(repo, source)
            p = _paths(repo)
            before_registry = p["registry"].read_bytes()
            before_versions = p["versions"].read_bytes()
            before_manifest = p["manifest"].read_bytes()
            before_renderer = p["renderer"].read_bytes()
            before_renderer_registry = p["renderer_registry"].read_bytes()
            snap1_manifest = (
                repo / "assets" / "generated" / "snapshots" / snap1 / "assets.manifest.json"
            ).read_bytes()

            for name, body in (
                ("sticker_fu_001.png", "NEW"),
                ("sticker_fu_001_thumb.png", "NEWT"),
                ("sticker_fu_001_name_zh.mp3", "N1"),
                ("sticker_fu_001_name_en.mp3", "N2"),
                ("sticker_fu_001_intro_zh.mp3", "N3"),
            ):
                if name.endswith(".png"):
                    _write(source / "spring_festival" / "stickers" / name, body)
                else:
                    _write(source / "audio" / name, body)
            _write_xlsx(
                source / "spring_festival" / "feishu_fields_spring_festival.xlsx",
                HEADERS,
                [_ready_row()],
            )

            snap2 = "snapshot_ywn_fault_inject_002"
            old_env = os.environ.get("FELT_PUBLISH_FAIL_AFTER_SNAPSHOT")
            os.environ["FELT_PUBLISH_FAIL_AFTER_SNAPSHOT"] = "1"
            try:
                code = _build(source, repo, snap2)
            finally:
                if old_env is None:
                    os.environ.pop("FELT_PUBLISH_FAIL_AFTER_SNAPSHOT", None)
                else:
                    os.environ["FELT_PUBLISH_FAIL_AFTER_SNAPSHOT"] = old_env

            self.assertEqual(code, 1)
            self.assertEqual(p["registry"].read_bytes(), before_registry)
            self.assertEqual(p["versions"].read_bytes(), before_versions)
            self.assertEqual(p["manifest"].read_bytes(), before_manifest)
            self.assertEqual(p["renderer"].read_bytes(), before_renderer)
            self.assertEqual(p["renderer_registry"].read_bytes(), before_renderer_registry)
            after = json.loads(p["registry"].read_text(encoding="utf-8"))
            self.assertEqual(after["latestSnapshotId"], snap1)
            self.assertNotIn(snap2, after["snapshots"])
            self.assertTrue(
                (repo / "assets" / "generated" / "snapshots" / snap1 / "assets.manifest.json").is_file()
            )
            self.assertEqual(
                (repo / "assets" / "generated" / "snapshots" / snap1 / "assets.manifest.json").read_bytes(),
                snap1_manifest,
            )
            self.assertFalse((repo / "assets" / "generated" / "snapshots" / snap2).exists())
            self.assertFalse((repo / "assets" / "generated" / "material" / snap2).exists())
            self.assertFalse((repo / "assets" / "generated" / "audio" / snap2).exists())
            self.assertFalse(
                (repo / "src" / "renderer" / "src" / "catalog" / "snapshots" / f"{snap2}.manifest.json").exists()
            )
            report = json.loads(p["report"].read_text(encoding="utf-8"))
            self.assertFalse(report["published"])

    def test_background_presplit_and_stem_mismatch_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            repo = root / "repo"
            _seed_formal_pack(repo, source)
            p = _paths(repo)
            before = p["manifest"].read_text(encoding="utf-8")
            before_registry = p["registry"].read_text(encoding="utf-8")

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

            code = _build(source, repo, "snapshot_ywn_fail_rules")
            self.assertEqual(code, 1)
            self.assertEqual(p["manifest"].read_text(encoding="utf-8"), before)
            self.assertEqual(p["registry"].read_text(encoding="utf-8"), before_registry)


if __name__ == "__main__":
    unittest.main()
