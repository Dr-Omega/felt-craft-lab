"""Development-only plaza accounts and sample posts for local QA."""



from __future__ import annotations



import os

import shutil

import struct

import zlib

from pathlib import Path



from werkzeug.security import generate_password_hash



from services.guards import is_dev_mode

from services.plaza_db import PlazaDb

from services.plaza_scene_preview import PLAZA_DEMO_SCENES, write_scene_preview_png



BASE_DIR = Path(__file__).resolve().parent.parent

DEMO_ASSET_DIR = BASE_DIR.parent / "assets" / "demo" / "plaza"



DEV_SEED_USERS: tuple[tuple[str, str, str], ...] = (
    ("111", "111", "child"),
    ("家长体验", "111", "parent"),
    ("美术老师", "111", "art_teacher"),
    ("语文老师", "111", "chinese_teacher"),
    ("运营管理员", "111", "admin"),
)



LEGACY_DEMO_PROJECT_IDS: tuple[str, ...] = (

    "demo_plaza_rabbit",

    "demo_plaza_sunflower",

)



DEMO_POSTS: tuple[dict[str, str], ...] = (

    {

        "project_id": "demo_plaza_mid_autumn_1",

        "title": "中秋1",

        "author_name": "小艺",

        "png_name": "demo-plaza-mid-autumn-1.png",

        "color": "#fff8e7",

        "output_type": "collage",

    },

    {

        "project_id": "demo_plaza_mid_autumn_2",

        "title": "中秋2",

        "author_name": "阿星",

        "png_name": "demo-plaza-mid-autumn-2.png",

        "color": "#fff8e7",

        "output_type": "story",

    },

)





def _hex_to_rgb(value: str) -> tuple[int, int, int]:

    raw = value.lstrip("#")

    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)





def _write_simple_png(path: Path, rgb: tuple[int, int, int]) -> None:

    width, height = 400, 300

    row = bytes([rgb[0], rgb[1], rgb[2]]) * width

    raw = b"".join([b"\x00" + row for _ in range(height)])

    compressed = zlib.compress(raw, level=9)



    def chunk(tag: bytes, data: bytes) -> bytes:

        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)



    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

    path.parent.mkdir(parents=True, exist_ok=True)

    path.write_bytes(png)





def _ensure_demo_png(plaza_dir: Path, png_name: str, fallback_color: str) -> None:

    target = plaza_dir / png_name

    plaza_dir.mkdir(parents=True, exist_ok=True)

    asset_copy = DEMO_ASSET_DIR / png_name

    DEMO_ASSET_DIR.mkdir(parents=True, exist_ok=True)



    composed = write_scene_preview_png(png_name, asset_copy)

    if composed:

        shutil.copyfile(asset_copy, target)

        return



    if asset_copy.is_file():

        shutil.copyfile(asset_copy, target)

        return



    if not target.is_file():

        _write_simple_png(target, _hex_to_rgb(fallback_color))





def _plaza_dev_seed_enabled() -> bool:

    env = (os.getenv("APP_ENV") or "").strip().lower()

    return is_dev_mode() or env == "local"





def seed_plaza_dev_users(db: PlazaDb) -> None:

    if not _plaza_dev_seed_enabled():

        return

    for username, password, role in DEV_SEED_USERS:

        if db.find_user_by_username(username):

            continue

        db.create_user(username, generate_password_hash(password), role)





def seed_plaza_demo_posts(db: PlazaDb, upload_root: Path) -> None:

    if not _plaza_dev_seed_enabled():

        return

    owner = db.find_user_by_username("111")

    if not owner:

        return



    for legacy_id in LEGACY_DEMO_PROJECT_IDS:

        db.delete_post_for_user(owner.user_id, legacy_id)



    plaza_dir = upload_root / "plaza"

    for spec in DEMO_POSTS:

        png_name = spec["png_name"]

        if png_name not in PLAZA_DEMO_SCENES:

            continue

        _ensure_demo_png(plaza_dir, png_name, spec["color"])



        existing = db.find_post_by_user_project(owner.user_id, spec["project_id"])

        if existing:

            db.update_post(

                existing.post_id,

                title=spec["title"],

                author_name=spec["author_name"],

                preview_filename=png_name,

                output_type=spec["output_type"],

            )

            continue



        db.create_post(

            user_id=owner.user_id,

            project_id=spec["project_id"],

            title=spec["title"],

            author_name=spec["author_name"],

            preview_filename=png_name,

            output_type=spec["output_type"],

        )
