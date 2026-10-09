"""Private, revisioned account workspace snapshots plus content-addressed chunks.

No last-write-wins: stale revisions return 409. Chunks are private to an account,
and a snapshot only becomes visible once every referenced chunk is present.
"""
import base64
import hashlib
import json
import re
from services.reward_system import RewardError, _utc_now_iso

HEX = re.compile(r"^[0-9a-f]{64}$")
CHUNK_LIMIT = 512 * 1024
TABLES = ("drafts", "projects", "storyCards", "personalAssets", "personalAssetVersions", "assetAccess", "favorites", "learningProgress")


class WorkspaceSync:
    def __init__(self, db):
        self.db = db
        with db._connect() as conn:
            conn.executescript("""
              CREATE TABLE IF NOT EXISTS workspace_chunks (
                user_id TEXT NOT NULL REFERENCES plaza_users(user_id), sha TEXT NOT NULL,
                data BLOB NOT NULL, PRIMARY KEY(user_id, sha));
              CREATE TABLE IF NOT EXISTS workspace_snapshots (
                user_id TEXT PRIMARY KEY REFERENCES plaza_users(user_id), revision INTEGER NOT NULL,
                document TEXT NOT NULL, updated_at TEXT NOT NULL);
            """)

    def chunk(self, user, sha, encoded=None):
        if not HEX.fullmatch(sha):
            raise RewardError("INVALID_ARGUMENT", "无效资源摘要。")
        with self.db._connect() as conn:
            if encoded is None:
                row = conn.execute("SELECT data FROM workspace_chunks WHERE user_id=? AND sha=?", (user, sha)).fetchone()
                if row is None:
                    raise RewardError("NOT_FOUND", "资源不存在。", 404)
                return {"sha256": sha, "base64": base64.b64encode(row["data"]).decode()}
            try:
                if not isinstance(encoded, str) or len(encoded) > 700000:
                    raise ValueError()
                data = base64.b64decode(encoded, validate=True)
                if len(data) > CHUNK_LIMIT or hashlib.sha256(data).hexdigest() != sha:
                    raise ValueError()
            except (ValueError, TypeError):
                raise RewardError("INVALID_ARGUMENT", "资源字节与摘要不一致。")
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT 1 FROM workspace_chunks WHERE user_id=? AND sha=?", (user, sha)).fetchone()
            total = conn.execute("SELECT COALESCE(SUM(LENGTH(data)),0) FROM workspace_chunks WHERE user_id=?", (user,)).fetchone()[0]
            if not existing and total + len(data) > 1024 * 1024 * 1024:
                raise RewardError("QUOTA", "账号同步资源超过 1 GiB，请联系管理员。", 413)
            conn.execute("INSERT OR IGNORE INTO workspace_chunks VALUES (?,?,?)", (user, sha, data))
        return {"sha256": sha}

    def read(self, user):
        with self.db._connect() as conn:
            row = conn.execute("SELECT * FROM workspace_snapshots WHERE user_id=?", (user,)).fetchone()
        return {"revision": row["revision"], "document": json.loads(row["document"]), "updatedAt": row["updated_at"]} if row else {"revision": 0, "document": None}

    def put(self, user, revision, document):
        if type(revision) is not int or revision < 0 or not isinstance(document, dict) or document.get("userId") != user or document.get("schema") != "account-workspace/1":
            raise RewardError("INVALID_ARGUMENT", "同步身份或版本无效。")
        tables = document.get("tables")
        if not isinstance(document.get("recolor"), dict):
            raise RewardError("INVALID_ARGUMENT", "图层关联清单无效。")
        if not isinstance(tables, dict) or set(tables) != set(TABLES):
            raise RewardError("INVALID_ARGUMENT", "同步数据表不完整。")
        for name, records in tables.items():
            if not isinstance(records, list) or len(records) > 20000 or not all(isinstance(row, dict) for row in records):
                raise RewardError("INVALID_ARGUMENT", "同步记录无效。")
            for row in records:
                scene = row.get("scene")
                if name in ("drafts", "projects") and not isinstance(scene, dict):
                    raise RewardError("INVALID_ARGUMENT", "作品场景无效。")
                owner = scene.get("userId") if name in ("drafts", "projects") else row.get("userId")
                if name not in ("storyCards", "personalAssetVersions") and owner != user:
                    raise RewardError("FORBIDDEN", "不能同步其他用户的数据。", 403)
        for name, field in (("personalAssets", "personalAssetId"), ("personalAssetVersions", "personalAssetId"), ("projects", "projectId"), ("storyCards", "workId")):
            if any(not isinstance(row.get(field), str) or not row[field] for row in tables[name]):
                raise RewardError("INVALID_ARGUMENT", "记录身份无效。")
        assets = {row["personalAssetId"] for row in tables["personalAssets"]}
        works = {row["projectId"] for row in tables["projects"]}
        if any(row.get("personalAssetId") not in assets for row in tables["personalAssetVersions"]) or any(row.get("workId") not in works for row in tables["storyCards"]):
            raise RewardError("INVALID_ARGUMENT", "同步来源归属缺失。")
        files = document.get("files")
        if not isinstance(files, list) or len(files) > 20000:
            raise RewardError("INVALID_ARGUMENT", "同步文件清单无效。")
        chunks = set()
        keys = set()
        total = 0
        for file in files:
            if not isinstance(file, dict) or not isinstance(file.get("chunks"), list) or not HEX.fullmatch(str(file.get("sha256", ""))):
                raise RewardError("INVALID_ARGUMENT", "文件清单无效。")
            key, size = file.get("key"), file.get("size")
            if not isinstance(key, str) or not key or key in keys or type(size) is not int or not 0 <= size <= 30 * 1024 * 1024 or len(file["chunks"]) > 60:
                raise RewardError("INVALID_ARGUMENT", "文件身份或大小无效。")
            keys.add(key)
            total += size
            if total > 256 * 1024 * 1024:
                raise RewardError("QUOTA", "工作区恢复大小超过 256 MiB。", 413)
            for sha in file["chunks"]:
                if not isinstance(sha, str) or not HEX.fullmatch(sha):
                    raise RewardError("INVALID_ARGUMENT", "分块摘要无效。")
                chunks.add(sha)
        encoded = json.dumps(document, ensure_ascii=True, separators=(",", ":"))
        if len(encoded.encode()) > 2 * 1024 * 1024:
            raise RewardError("QUOTA", "同步清单超过 2 MiB。", 413)
        with self.db._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT revision FROM workspace_snapshots WHERE user_id=?", (user,)).fetchone()
            current = row[0] if row else 0
            if current != revision:
                raise RewardError("CONFLICT", "另一终端已有修改。已保留本机数据，未覆盖云端。", 409)
            if any(conn.execute("SELECT 1 FROM workspace_chunks WHERE user_id=? AND sha=?", (user, sha)).fetchone() is None for sha in chunks):
                raise RewardError("INCOMPLETE", "资源未完整上传，不发布此版本。", 409)
            for file in files:
                digest, size = hashlib.sha256(), 0
                for sha in file["chunks"]:
                    data = conn.execute("SELECT data FROM workspace_chunks WHERE user_id=? AND sha=?", (user, sha)).fetchone()[0]
                    digest.update(data)
                    size += len(data)
                if size != file["size"] or digest.hexdigest() != file["sha256"]:
                    raise RewardError("INVALID_ARGUMENT", "文件与分块内容不一致，不发布此版本。")
            conn.execute("INSERT INTO workspace_snapshots VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at", (user, current + 1, encoded, _utc_now_iso()))
        return {"revision": current + 1}
