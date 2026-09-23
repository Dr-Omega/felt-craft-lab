"""SQLite persistence for plaza users and shared posts."""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "plaza.db"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass(frozen=True)
class PlazaUserRow:
    user_id: str
    username: str
    password_hash: str
    created_at: str


@dataclass(frozen=True)
class PlazaPostRow:
    post_id: str
    user_id: str
    project_id: str
    title: str
    author_name: str
    preview_filename: str
    created_at: str


class PlazaDb:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS plaza_users (
                  user_id TEXT PRIMARY KEY,
                  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                  password_hash TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS plaza_posts (
                  post_id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  project_id TEXT NOT NULL,
                  title TEXT NOT NULL,
                  author_name TEXT NOT NULL,
                  preview_filename TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(user_id, project_id),
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_plaza_posts_created
                  ON plaza_posts(created_at DESC);
                """
            )

    def create_user(self, username: str, password_hash: str) -> PlazaUserRow:
        user_id = f"user_{uuid.uuid4().hex}"
        created_at = _utc_now_iso()
        with self._connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO plaza_users (user_id, username, password_hash, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (user_id, username.strip(), password_hash, created_at),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("USERNAME_TAKEN") from exc
        return PlazaUserRow(
            user_id=user_id,
            username=username.strip(),
            password_hash=password_hash,
            created_at=created_at,
        )

    def find_user_by_username(self, username: str) -> Optional[PlazaUserRow]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id, username, password_hash, created_at FROM plaza_users WHERE username = ? COLLATE NOCASE",
                (username.strip(),),
            ).fetchone()
        if not row:
            return None
        return PlazaUserRow(
            user_id=row["user_id"],
            username=row["username"],
            password_hash=row["password_hash"],
            created_at=row["created_at"],
        )

    def find_user_by_id(self, user_id: str) -> Optional[PlazaUserRow]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id, username, password_hash, created_at FROM plaza_users WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if not row:
            return None
        return PlazaUserRow(
            user_id=row["user_id"],
            username=row["username"],
            password_hash=row["password_hash"],
            created_at=row["created_at"],
        )

    def create_post(
        self,
        *,
        user_id: str,
        project_id: str,
        title: str,
        author_name: str,
        preview_filename: str,
    ) -> PlazaPostRow:
        post_id = f"post_{uuid.uuid4().hex}"
        created_at = _utc_now_iso()
        with self._connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO plaza_posts
                      (post_id, user_id, project_id, title, author_name, preview_filename, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (post_id, user_id, project_id, title.strip(), author_name.strip(), preview_filename, created_at),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("PROJECT_ALREADY_SHARED") from exc
        return PlazaPostRow(
            post_id=post_id,
            user_id=user_id,
            project_id=project_id,
            title=title.strip(),
            author_name=author_name.strip(),
            preview_filename=preview_filename,
            created_at=created_at,
        )

    def list_posts(self) -> list[PlazaPostRow]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT post_id, user_id, project_id, title, author_name, preview_filename, created_at
                FROM plaza_posts
                ORDER BY datetime(created_at) DESC
                """
            ).fetchall()
        return [
            PlazaPostRow(
                post_id=row["post_id"],
                user_id=row["user_id"],
                project_id=row["project_id"],
                title=row["title"],
                author_name=row["author_name"],
                preview_filename=row["preview_filename"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def get_post(self, post_id: str) -> Optional[PlazaPostRow]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT post_id, user_id, project_id, title, author_name, preview_filename, created_at
                FROM plaza_posts WHERE post_id = ?
                """,
                (post_id,),
            ).fetchone()
        if not row:
            return None
        return PlazaPostRow(
            post_id=row["post_id"],
            user_id=row["user_id"],
            project_id=row["project_id"],
            title=row["title"],
            author_name=row["author_name"],
            preview_filename=row["preview_filename"],
            created_at=row["created_at"],
        )

    def find_post_by_user_project(self, user_id: str, project_id: str) -> Optional[PlazaPostRow]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT post_id, user_id, project_id, title, author_name, preview_filename, created_at
                FROM plaza_posts WHERE user_id = ? AND project_id = ?
                """,
                (user_id, project_id),
            ).fetchone()
        if not row:
            return None
        return PlazaPostRow(
            post_id=row["post_id"],
            user_id=row["user_id"],
            project_id=row["project_id"],
            title=row["title"],
            author_name=row["author_name"],
            preview_filename=row["preview_filename"],
            created_at=row["created_at"],
        )

    def list_shared_project_ids_for_user(self, user_id: str) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT project_id FROM plaza_posts WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        return [row["project_id"] for row in rows]

    def update_post(
        self,
        post_id: str,
        *,
        title: str,
        author_name: str,
        preview_filename: str,
    ) -> Optional[PlazaPostRow]:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE plaza_posts
                SET title = ?, author_name = ?, preview_filename = ?
                WHERE post_id = ?
                """,
                (title.strip(), author_name.strip(), preview_filename, post_id),
            )
        return self.get_post(post_id)

    def delete_post_for_user(self, user_id: str, project_id: str) -> Optional[PlazaPostRow]:
        existing = self.find_post_by_user_project(user_id, project_id)
        if not existing:
            return None
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM plaza_posts WHERE user_id = ? AND project_id = ?",
                (user_id, project_id),
            )
        return existing
