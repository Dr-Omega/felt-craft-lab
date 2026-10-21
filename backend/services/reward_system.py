"""Reward, feedback, store, and bear-room domain service for the MVP."""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from services.plaza_db import PlazaPostRow, PlazaUserRow

REWARDED_ROLES = frozenset({"child", "art_teacher", "chinese_teacher"})
TEACHER_ROLES = frozenset({"art_teacher", "chinese_teacher"})
LIKE_ROLES = frozenset({"child", "parent"})
ADMIN_ROLE = "admin"

PRODUCTS = (
    {"productId": "felt_24", "name": "24 色不织布片", "coinPrice": 1000, "diamondPrice": 100},
    {"productId": "tool_set", "name": "工具套装", "coinPrice": 1000, "diamondPrice": 100},
    {"productId": "ip_blind_box", "name": "IP 盲盒", "coinPrice": 6000, "diamondPrice": 600},
    {"productId": "theme_pack", "name": "完整主题素材包", "coinPrice": 100, "diamondPrice": 10},
)

FOODS = (
    {"foodId": "apple", "name": "苹果", "coinPrice": 10, "diamondPrice": 1},
    {"foodId": "honey", "name": "蜂蜜", "coinPrice": 20, "diamondPrice": 2},
    {"foodId": "fish", "name": "鱼", "coinPrice": 30, "diamondPrice": 3},
)

DEFAULT_CONFIG: dict[str, Any] = {
    "dailyLoginDiamonds": 1,
    "likeRewardCoins": 10,
    "teacherThresholds": [20, 40, 80],
    "teacherRewards": {"ordinary": 20, "intermediate": 30, "advanced": 40, "expert": 50},
    "childScoreRewards": {
        "ordinary": [10, 20, 30],
        "intermediate": [15, 25, 35],
        "advanced": [20, 30, 40],
        "expert": [25, 35, 45],
    },
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


@dataclass(frozen=True)
class RewardError(Exception):
    code: str
    message: str
    status: int = 400

    def __str__(self) -> str:
        return self.message


class RewardSystem:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
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
                CREATE TABLE IF NOT EXISTS reward_wallets (
                  user_id TEXT PRIMARY KEY,
                  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
                  diamonds INTEGER NOT NULL DEFAULT 0 CHECK(diamonds >= 0),
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS reward_ledger (
                  ledger_id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  currency TEXT NOT NULL CHECK(currency IN ('coins', 'diamonds')),
                  amount INTEGER NOT NULL,
                  balance_after INTEGER NOT NULL,
                  reason TEXT NOT NULL,
                  reference_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_reward_ledger_user_created
                  ON reward_ledger(user_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS reward_daily_signins (
                  user_id TEXT NOT NULL,
                  sign_date TEXT NOT NULL,
                  diamonds INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(user_id, sign_date),
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS plaza_likes (
                  post_id TEXT NOT NULL,
                  user_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(post_id, user_id),
                  FOREIGN KEY(post_id) REFERENCES plaza_posts(post_id) ON DELETE CASCADE,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS reward_inbox (
                  message_id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  message_type TEXT NOT NULL,
                  title TEXT NOT NULL,
                  body TEXT NOT NULL,
                  reward_coins INTEGER NOT NULL DEFAULT 0,
                  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread', 'unclaimed', 'claimed')),
                  source_user_id TEXT,
                  source_name TEXT,
                  post_id TEXT,
                  review_score INTEGER,
                  review_comment TEXT,
                  created_at TEXT NOT NULL,
                  claimed_at TEXT,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id),
                  FOREIGN KEY(post_id) REFERENCES plaza_posts(post_id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_reward_inbox_user_created
                  ON reward_inbox(user_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS teacher_profiles (
                  user_id TEXT PRIMARY KEY,
                  direction TEXT NOT NULL CHECK(direction IN ('art', 'chinese')),
                  review_count INTEGER NOT NULL DEFAULT 0,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS teacher_reviews (
                  review_id TEXT PRIMARY KEY,
                  post_id TEXT NOT NULL,
                  teacher_id TEXT NOT NULL,
                  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),
                  comment TEXT NOT NULL,
                  teacher_level TEXT NOT NULL,
                  teacher_reward INTEGER NOT NULL,
                  child_reward INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(post_id, teacher_id),
                  FOREIGN KEY(post_id) REFERENCES plaza_posts(post_id) ON DELETE CASCADE,
                  FOREIGN KEY(teacher_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS reward_conversions (
                  request_id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  diamonds INTEGER NOT NULL,
                  coins INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS reward_recharges (
                  request_id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  yuan INTEGER NOT NULL,
                  diamonds INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS reward_redemptions (
                  redemption_id TEXT PRIMARY KEY,
                  request_id TEXT NOT NULL UNIQUE,
                  user_id TEXT NOT NULL,
                  product_id TEXT NOT NULL,
                  product_name TEXT NOT NULL,
                  currency TEXT NOT NULL,
                  amount INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS bear_feedings (
                  feeding_id TEXT PRIMARY KEY,
                  request_id TEXT NOT NULL UNIQUE,
                  user_id TEXT NOT NULL,
                  food_id TEXT NOT NULL,
                  food_name TEXT NOT NULL,
                  currency TEXT NOT NULL,
                  amount INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(user_id) REFERENCES plaza_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS reward_config (
                  config_key TEXT PRIMARY KEY,
                  config_json TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS bear_room_settings (
                  user_id TEXT PRIMARY KEY REFERENCES plaza_users(user_id),
                  character TEXT NOT NULL,
                  furniture TEXT NOT NULL,
                  revision INTEGER NOT NULL
                );
                """
            )
            now = _utc_now_iso()
            for key, value in DEFAULT_CONFIG.items():
                conn.execute(
                    "INSERT OR IGNORE INTO reward_config (config_key, config_json, updated_at) VALUES (?, ?, ?)",
                    (key, json.dumps(value, ensure_ascii=False), now),
                )

    @staticmethod
    def _ensure_wallet(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
        now = _utc_now_iso()
        conn.execute(
            "INSERT OR IGNORE INTO reward_wallets (user_id, coins, diamonds, updated_at) VALUES (?, 0, 0, ?)",
            (user_id, now),
        )
        row = conn.execute(
            "SELECT user_id, coins, diamonds, updated_at FROM reward_wallets WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            raise RewardError("ACCOUNT_NOT_FOUND", "账户创建失败。", 500)
        return row

    @staticmethod
    def _wallet_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "coins": int(row["coins"]),
            "diamonds": int(row["diamonds"]),
            "updatedAt": row["updated_at"],
        }

    def _config(self, conn: sqlite3.Connection) -> dict[str, Any]:
        rows = conn.execute("SELECT config_key, config_json FROM reward_config").fetchall()
        config = dict(DEFAULT_CONFIG)
        for row in rows:
            try:
                config[row["config_key"]] = json.loads(row["config_json"])
            except (TypeError, ValueError):
                continue
        return config

    @staticmethod
    def _credit(
        conn: sqlite3.Connection,
        *,
        user_id: str,
        currency: str,
        amount: int,
        reason: str,
        reference_id: str,
    ) -> None:
        if amount == 0:
            return
        field = "coins" if currency == "coins" else "diamonds"
        now = _utc_now_iso()
        conn.execute(
            f"UPDATE reward_wallets SET {field} = {field} + ?, updated_at = ? WHERE user_id = ?",
            (amount, now, user_id),
        )
        balance = conn.execute(
            f"SELECT {field} FROM reward_wallets WHERE user_id = ?", (user_id,)
        ).fetchone()[field]
        conn.execute(
            """
            INSERT INTO reward_ledger
              (ledger_id, user_id, currency, amount, balance_after, reason, reference_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (_new_id("ledger"), user_id, currency, amount, balance, reason, reference_id, now),
        )

    @staticmethod
    def _user_role(conn: sqlite3.Connection, user_id: str) -> str:
        row = conn.execute("SELECT role FROM plaza_users WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            raise RewardError("USER_NOT_FOUND", "账号不存在。", 404)
        return str(row["role"])

    def on_login(self, user: PlazaUserRow) -> bool:
        if user.role not in REWARDED_ROLES:
            return False
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self._ensure_wallet(conn, user.user_id)
            config = self._config(conn)
            reward = max(0, int(config["dailyLoginDiamonds"]))
            today = date.today().isoformat()
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO reward_daily_signins (user_id, sign_date, diamonds, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (user.user_id, today, reward, _utc_now_iso()),
            )
            if cursor.rowcount:
                self._credit(
                    conn,
                    user_id=user.user_id,
                    currency="diamonds",
                    amount=reward,
                    reason="daily_login",
                    reference_id=f"daily:{today}",
                )
                return True
        return False

    def dashboard(self, user: PlazaUserRow) -> dict[str, Any]:
        with self._connect() as conn:
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
            ledger_rows = conn.execute(
                """
                SELECT ledger_id, currency, amount, balance_after, reason, reference_id, created_at
                FROM reward_ledger WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 30
                """,
                (user.user_id,),
            ).fetchall()
            inbox_count = 0
            if user.role == "child":
                inbox_count = int(
                    conn.execute(
                        "SELECT COUNT(*) AS count FROM reward_inbox WHERE user_id = ? AND status != 'claimed'",
                        (user.user_id,),
                    ).fetchone()["count"]
                )
            teacher = None
            if user.role in TEACHER_ROLES:
                direction = "art" if user.role == "art_teacher" else "chinese"
                now = _utc_now_iso()
                conn.execute(
                    """
                    INSERT OR IGNORE INTO teacher_profiles (user_id, direction, review_count, updated_at)
                    VALUES (?, ?, 0, ?)
                    """,
                    (user.user_id, direction, now),
                )
                profile = conn.execute(
                    "SELECT direction, review_count FROM teacher_profiles WHERE user_id = ?",
                    (user.user_id,),
                ).fetchone()
                config = self._config(conn)
                teacher = self._teacher_snapshot(profile["direction"], int(profile["review_count"]), config)
            return {
                "user": {"userId": user.user_id, "username": user.username, "role": user.role},
                "wallet": wallet,
                "ledger": [
                    {
                        "ledgerId": row["ledger_id"],
                        "currency": row["currency"],
                        "amount": int(row["amount"]),
                        "balanceAfter": int(row["balance_after"]),
                        "reason": row["reason"],
                        "referenceId": row["reference_id"],
                        "createdAt": row["created_at"],
                    }
                    for row in ledger_rows
                ],
                "inboxPendingCount": inbox_count,
                "teacher": teacher,
                "products": list(PRODUCTS),
                "foods": list(FOODS),
                "room": self._room_settings(conn, user.user_id),
            }

    @staticmethod
    def _room_settings(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
        row = conn.execute("SELECT character, furniture, revision FROM bear_room_settings WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else {"character": "小熊", "furniture": "原木色", "revision": 0}

    def save_room(self, user: PlazaUserRow, body: Any) -> dict[str, Any]:
        if user.role != "child":
            raise RewardError("FORBIDDEN", "仅儿童账号可设置房间", 403)
        if (not isinstance(body, dict) or set(body) != {"character", "furniture", "revision"}
                or body.get("character") not in ("小熊", "小兔", "小猫")
                or body.get("furniture") not in ("原木色", "薄荷绿", "樱花粉", "沙发款")
                or type(body.get("revision")) is not int or body["revision"] < 0):
            raise RewardError("INVALID_ARGUMENT", "房间设置无效")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = self._room_settings(conn, user.user_id)
            if current["revision"] != body["revision"]:
                raise RewardError("CONFLICT", "房间已在其他终端更改，请重新载入后再选择", 409)
            conn.execute("INSERT INTO bear_room_settings VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET character=excluded.character, furniture=excluded.furniture, revision=excluded.revision",
                         (user.user_id, body["character"], body["furniture"], body["revision"] + 1))
            return self._room_settings(conn, user.user_id)

    @staticmethod
    def _teacher_level(review_count: int, thresholds: list[int]) -> str:
        if review_count >= thresholds[2]:
            return "expert"
        if review_count >= thresholds[1]:
            return "advanced"
        if review_count >= thresholds[0]:
            return "intermediate"
        return "ordinary"

    def _teacher_snapshot(self, direction: str, count: int, config: dict[str, Any]) -> dict[str, Any]:
        thresholds = [int(value) for value in config["teacherThresholds"]]
        level = self._teacher_level(count, thresholds)
        next_threshold = next((value for value in thresholds if count < value), None)
        return {
            "direction": direction,
            "reviewCount": count,
            "level": level,
            "nextThreshold": next_threshold,
            "rewardPerReview": int(config["teacherRewards"][level]),
        }

    def post_stats(self, user_id: str, post_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            like_count = int(
                conn.execute("SELECT COUNT(*) AS count FROM plaza_likes WHERE post_id = ?", (post_id,)).fetchone()[
                    "count"
                ]
            )
            liked = bool(
                conn.execute(
                    "SELECT 1 FROM plaza_likes WHERE post_id = ? AND user_id = ?", (post_id, user_id)
                ).fetchone()
            )
            review_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS count FROM teacher_reviews WHERE post_id = ?", (post_id,)
                ).fetchone()["count"]
            )
            return {"likeCount": like_count, "likedByMe": liked, "reviewCount": review_count}

    def like_post(self, user: PlazaUserRow, post: PlazaPostRow) -> dict[str, Any]:
        if user.role not in LIKE_ROLES:
            raise RewardError("FORBIDDEN", "只有儿童或家长可以点赞。", 403)
        if user.user_id == post.user_id:
            raise RewardError("SELF_LIKE_FORBIDDEN", "不能给自己的作品点赞。")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    "INSERT INTO plaza_likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
                    (post.post_id, user.user_id, _utc_now_iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise RewardError("ALREADY_LIKED", "已经点过赞了。", 409) from exc
            config = self._config(conn)
            reward = int(config["likeRewardCoins"])
            # Unlike/re-like must never create a second reward for the same pair.
            conn.execute(
                """
                INSERT INTO reward_inbox
                  (message_id, user_id, message_type, title, body, reward_coins, status,
                   source_user_id, source_name, post_id, created_at)
                SELECT ?, ?, 'like', ?, ?, ?, 'unclaimed', ?, ?, ?, ?
                WHERE NOT EXISTS (
                  SELECT 1 FROM reward_inbox WHERE post_id = ? AND source_user_id = ? AND message_type = 'like'
                )
                """,
                (
                    _new_id("msg"),
                    post.user_id,
                    "作品收到新点赞",
                    f"{user.username} 给《{post.title}》点了赞。",
                    reward,
                    user.user_id,
                    user.username,
                    post.post_id,
                    _utc_now_iso(),
                    post.post_id,
                    user.user_id,
                ),
            )
        return self.post_stats(user.user_id, post.post_id)

    def unlike_post(self, user: PlazaUserRow, post: PlazaPostRow) -> dict[str, Any]:
        if user.role not in LIKE_ROLES:
            raise RewardError("FORBIDDEN", "只有儿童或家长可以点赞。", 403)
        with self._connect() as conn:
            conn.execute("DELETE FROM plaza_likes WHERE post_id = ? AND user_id = ?", (post.post_id, user.user_id))
        return self.post_stats(user.user_id, post.post_id)

    def list_post_reviews(self, post_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT r.review_id, u.username, r.score, r.comment, r.created_at
                   FROM teacher_reviews r JOIN plaza_users u ON u.user_id = r.teacher_id
                   WHERE r.post_id = ? ORDER BY r.created_at DESC, r.review_id DESC""", (post_id,)
            ).fetchall()
        return [{"reviewId": row["review_id"], "authorName": row["username"], "score": row["score"],
                 "comment": row["comment"], "createdAt": row["created_at"]} for row in rows]

    def list_inbox(self, user: PlazaUserRow) -> list[dict[str, Any]]:
        if user.role != "child":
            raise RewardError("FORBIDDEN", "反馈邮箱仅儿童账号可查看。", 403)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT message_id, message_type, title, body, reward_coins, status, source_name,
                       post_id, review_score, review_comment, created_at, claimed_at
                FROM reward_inbox WHERE user_id = ? ORDER BY datetime(created_at) DESC
                """,
                (user.user_id,),
            ).fetchall()
        return [
            {
                "messageId": row["message_id"],
                "messageType": row["message_type"],
                "title": row["title"],
                "body": row["body"],
                "rewardCoins": int(row["reward_coins"]),
                "status": row["status"],
                "sourceName": row["source_name"],
                "postId": row["post_id"],
                "reviewScore": row["review_score"],
                "reviewComment": row["review_comment"],
                "createdAt": row["created_at"],
                "claimedAt": row["claimed_at"],
            }
            for row in rows
        ]

    def claim_message(self, user: PlazaUserRow, message_id: str) -> dict[str, Any]:
        if user.role != "child":
            raise RewardError("FORBIDDEN", "反馈奖励仅儿童账号可领取。", 403)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM reward_inbox WHERE message_id = ? AND user_id = ?",
                (message_id, user.user_id),
            ).fetchone()
            if not row:
                raise RewardError("MESSAGE_NOT_FOUND", "消息不存在。", 404)
            self._ensure_wallet(conn, user.user_id)
            if row["status"] != "claimed":
                now = _utc_now_iso()
                updated = conn.execute(
                    """
                    UPDATE reward_inbox SET status = 'claimed', claimed_at = ?
                    WHERE message_id = ? AND status != 'claimed'
                    """,
                    (now, message_id),
                )
                if updated.rowcount:
                    self._credit(
                        conn,
                        user_id=user.user_id,
                        currency="coins",
                        amount=int(row["reward_coins"]),
                        reason=f"{row['message_type']}_reward",
                        reference_id=message_id,
                    )
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
        return {"messageId": message_id, "status": "claimed", "wallet": wallet}

    def submit_review(
        self,
        user: PlazaUserRow,
        post: PlazaPostRow,
        *,
        score: int,
        comment: str,
    ) -> dict[str, Any]:
        if user.role not in TEACHER_ROLES:
            raise RewardError("FORBIDDEN", "只有教师账号可以提交点评。", 403)
        direction = "art" if user.role == "art_teacher" else "chinese"
        expected_output = "collage" if direction == "art" else "story"
        if post.output_type != expected_output:
            label = "拼贴作品" if direction == "art" else "故事卡"
            raise RewardError("WRONG_REVIEW_DIRECTION", f"当前教师只能点评{label}。")
        clean_comment = comment.strip()
        if not clean_comment or not 1 <= score <= 10:
            raise RewardError("INVALID_REVIEW", "请填写评语并给出 1-10 分评分。")
        if user.user_id == post.user_id:
            raise RewardError("SELF_REVIEW_FORBIDDEN", "不能点评自己的作品。")

        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute(
                "SELECT 1 FROM teacher_reviews WHERE post_id = ? AND teacher_id = ?",
                (post.post_id, user.user_id),
            ).fetchone():
                raise RewardError("ALREADY_REVIEWED", "已经点评过这个作品。", 409)
            now = _utc_now_iso()
            conn.execute(
                """
                INSERT OR IGNORE INTO teacher_profiles (user_id, direction, review_count, updated_at)
                VALUES (?, ?, 0, ?)
                """,
                (user.user_id, direction, now),
            )
            profile = conn.execute(
                "SELECT review_count FROM teacher_profiles WHERE user_id = ?", (user.user_id,)
            ).fetchone()
            next_count = int(profile["review_count"]) + 1
            config = self._config(conn)
            thresholds = [int(value) for value in config["teacherThresholds"]]
            level = self._teacher_level(next_count, thresholds)
            teacher_reward = int(config["teacherRewards"][level])
            score_band = 0 if score <= 6 else 1 if score <= 8 else 2
            child_reward = int(config["childScoreRewards"][level][score_band])
            review_id = _new_id("review")

            conn.execute(
                """
                INSERT INTO teacher_reviews
                  (review_id, post_id, teacher_id, score, comment, teacher_level,
                   teacher_reward, child_reward, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    review_id,
                    post.post_id,
                    user.user_id,
                    score,
                    clean_comment,
                    level,
                    teacher_reward,
                    child_reward,
                    now,
                ),
            )
            conn.execute(
                "UPDATE teacher_profiles SET review_count = ?, updated_at = ? WHERE user_id = ?",
                (next_count, now, user.user_id),
            )
            self._ensure_wallet(conn, user.user_id)
            self._credit(
                conn,
                user_id=user.user_id,
                currency="coins",
                amount=teacher_reward,
                reason="teacher_review",
                reference_id=review_id,
            )
            conn.execute(
                """
                INSERT INTO reward_inbox
                  (message_id, user_id, message_type, title, body, reward_coins, status,
                   source_user_id, source_name, post_id, review_score, review_comment, created_at)
                VALUES (?, ?, 'review', ?, ?, ?, 'unclaimed', ?, ?, ?, ?, ?, ?)
                """,
                (
                    _new_id("msg"),
                    post.user_id,
                    "收到教师点评",
                    f"{user.username} 为《{post.title}》打了 {score} 分。",
                    child_reward,
                    user.user_id,
                    user.username,
                    post.post_id,
                    score,
                    clean_comment,
                    now,
                ),
            )
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
            teacher = self._teacher_snapshot(direction, next_count, config)
        return {
            "reviewId": review_id,
            "teacherRewardCoins": teacher_reward,
            "childRewardCoins": child_reward,
            "teacher": teacher,
            "wallet": wallet,
        }

    def convert_diamonds(self, user: PlazaUserRow, diamonds: int, request_id: str) -> dict[str, Any]:
        if user.role not in REWARDED_ROLES:
            raise RewardError("FORBIDDEN", "当前账号不能进行货币转换。", 403)
        if diamonds < 1 or not request_id.strip():
            raise RewardError("INVALID_ARGUMENT", "转换数量无效。")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            wallet = self._ensure_wallet(conn, user.user_id)
            existing = conn.execute(
                "SELECT user_id, diamonds, coins FROM reward_conversions WHERE request_id = ?", (request_id,)
            ).fetchone()
            if existing:
                if existing["user_id"] != user.user_id:
                    raise RewardError("REQUEST_CONFLICT", "请求编号已被使用。", 409)
                return {
                    "wallet": self._wallet_dict(wallet),
                    "convertedDiamonds": int(existing["diamonds"]),
                    "receivedCoins": int(existing["coins"]),
                }
            if int(wallet["diamonds"]) < diamonds:
                raise RewardError("INSUFFICIENT_DIAMONDS", "钻石余额不足。")
            coins = diamonds * 10
            self._credit(
                conn,
                user_id=user.user_id,
                currency="diamonds",
                amount=-diamonds,
                reason="diamond_to_coin",
                reference_id=request_id,
            )
            self._credit(
                conn,
                user_id=user.user_id,
                currency="coins",
                amount=coins,
                reason="diamond_to_coin",
                reference_id=request_id,
            )
            conn.execute(
                "INSERT INTO reward_conversions (request_id, user_id, diamonds, coins, created_at) VALUES (?, ?, ?, ?, ?)",
                (request_id, user.user_id, diamonds, coins, _utc_now_iso()),
            )
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
        return {"wallet": wallet, "convertedDiamonds": diamonds, "receivedCoins": coins}

    def recharge_diamonds(self, user: PlazaUserRow, yuan: int, request_id: str) -> dict[str, Any]:
        if user.role not in REWARDED_ROLES:
            raise RewardError("FORBIDDEN", "当前账号不能充值。", 403)
        if yuan < 1 or yuan > 10000 or not request_id.strip():
            raise RewardError("INVALID_ARGUMENT", "充值金额无效。")
        diamonds = yuan * 10
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT user_id, yuan, diamonds FROM reward_recharges WHERE request_id = ?", (request_id,)
            ).fetchone()
            if existing:
                if existing["user_id"] != user.user_id:
                    raise RewardError("REQUEST_CONFLICT", "请求编号已被使用。", 409)
                return {
                    "wallet": self._wallet_dict(self._ensure_wallet(conn, user.user_id)),
                    "yuan": int(existing["yuan"]),
                    "diamonds": int(existing["diamonds"]),
                }
            self._ensure_wallet(conn, user.user_id)
            self._credit(
                conn,
                user_id=user.user_id,
                currency="diamonds",
                amount=diamonds,
                reason="recharge",
                reference_id=request_id,
            )
            conn.execute(
                "INSERT INTO reward_recharges (request_id, user_id, yuan, diamonds, created_at) VALUES (?, ?, ?, ?, ?)",
                (request_id, user.user_id, yuan, diamonds, _utc_now_iso()),
            )
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
        return {"wallet": wallet, "yuan": yuan, "diamonds": diamonds}

    @staticmethod
    def _priced_item(items: tuple[dict[str, Any], ...], id_key: str, item_id: str) -> dict[str, Any]:
        item = next((candidate for candidate in items if candidate[id_key] == item_id), None)
        if not item:
            raise RewardError("ITEM_NOT_FOUND", "商品不存在。", 404)
        return item

    def _spend(
        self,
        conn: sqlite3.Connection,
        *,
        user_id: str,
        currency: str,
        amount: int,
        reason: str,
        reference_id: str,
    ) -> None:
        if currency not in {"coins", "diamonds"}:
            raise RewardError("INVALID_CURRENCY", "请选择金币或钻石支付。")
        wallet = self._ensure_wallet(conn, user_id)
        if int(wallet[currency]) < amount:
            label = "金币" if currency == "coins" else "钻石"
            raise RewardError("INSUFFICIENT_BALANCE", f"{label}余额不足。")
        self._credit(
            conn,
            user_id=user_id,
            currency=currency,
            amount=-amount,
            reason=reason,
            reference_id=reference_id,
        )

    def redeem(self, user: PlazaUserRow, product_id: str, currency: str, request_id: str) -> dict[str, Any]:
        if user.role not in REWARDED_ROLES:
            raise RewardError("FORBIDDEN", "当前账号不能兑换商品。", 403)
        if currency not in {"coins", "diamonds"} or not request_id.strip():
            raise RewardError("INVALID_ARGUMENT", "兑换参数无效。")
        product = self._priced_item(PRODUCTS, "productId", product_id)
        price = int(product["coinPrice"] if currency == "coins" else product["diamondPrice"])
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT * FROM reward_redemptions WHERE request_id = ?", (request_id,)
            ).fetchone()
            if existing:
                if existing["user_id"] != user.user_id:
                    raise RewardError("REQUEST_CONFLICT", "请求编号已被使用。", 409)
                return {"redemptionId": existing["redemption_id"], "wallet": self._wallet_dict(self._ensure_wallet(conn, user.user_id))}
            redemption_id = _new_id("redeem")
            self._spend(
                conn,
                user_id=user.user_id,
                currency=currency,
                amount=price,
                reason="store_redemption",
                reference_id=redemption_id,
            )
            conn.execute(
                """
                INSERT INTO reward_redemptions
                  (redemption_id, request_id, user_id, product_id, product_name, currency, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (redemption_id, request_id, user.user_id, product_id, product["name"], currency, price, _utc_now_iso()),
            )
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
        return {"redemptionId": redemption_id, "product": product, "wallet": wallet}

    def feed_bear(self, user: PlazaUserRow, food_id: str, currency: str, request_id: str) -> dict[str, Any]:
        if user.role != "child":
            raise RewardError("FORBIDDEN", "只有儿童账号可以喂养小熊。", 403)
        if currency not in {"coins", "diamonds"} or not request_id.strip():
            raise RewardError("INVALID_ARGUMENT", "喂养参数无效。")
        food = self._priced_item(FOODS, "foodId", food_id)
        price = int(food["coinPrice"] if currency == "coins" else food["diamondPrice"])
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT * FROM bear_feedings WHERE request_id = ?", (request_id,)).fetchone()
            if existing:
                if existing["user_id"] != user.user_id:
                    raise RewardError("REQUEST_CONFLICT", "请求编号已被使用。", 409)
                return {"feedingId": existing["feeding_id"], "wallet": self._wallet_dict(self._ensure_wallet(conn, user.user_id))}
            feeding_id = _new_id("feeding")
            self._spend(
                conn,
                user_id=user.user_id,
                currency=currency,
                amount=price,
                reason="bear_feeding",
                reference_id=feeding_id,
            )
            conn.execute(
                """
                INSERT INTO bear_feedings
                  (feeding_id, request_id, user_id, food_id, food_name, currency, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (feeding_id, request_id, user.user_id, food_id, food["name"], currency, price, _utc_now_iso()),
            )
            wallet = self._wallet_dict(self._ensure_wallet(conn, user.user_id))
        return {"feedingId": feeding_id, "food": food, "wallet": wallet}

    def get_admin_config(self, user: PlazaUserRow) -> dict[str, Any]:
        if user.role != ADMIN_ROLE:
            raise RewardError("FORBIDDEN", "只有管理员可以查看奖励规则。", 403)
        with self._connect() as conn:
            return self._config(conn)

    def update_admin_config(self, user: PlazaUserRow, updates: dict[str, Any]) -> dict[str, Any]:
        if user.role != ADMIN_ROLE:
            raise RewardError("FORBIDDEN", "只有管理员可以修改奖励规则。", 403)
        allowed = set(DEFAULT_CONFIG)
        if not updates or any(key not in allowed for key in updates):
            raise RewardError("INVALID_ARGUMENT", "奖励规则字段无效。")
        merged = dict(DEFAULT_CONFIG)
        with self._connect() as conn:
            merged.update(self._config(conn))
        merged.update(updates)
        try:
            if int(merged["dailyLoginDiamonds"]) < 0 or int(merged["likeRewardCoins"]) < 0:
                raise ValueError
            thresholds = [int(value) for value in merged["teacherThresholds"]]
            if len(thresholds) != 3 or thresholds != sorted(set(thresholds)) or thresholds[0] < 1:
                raise ValueError
            for level in ("ordinary", "intermediate", "advanced", "expert"):
                if int(merged["teacherRewards"][level]) < 0:
                    raise ValueError
                score_rewards = [int(value) for value in merged["childScoreRewards"][level]]
                if len(score_rewards) != 3 or any(value < 0 for value in score_rewards):
                    raise ValueError
        except (KeyError, TypeError, ValueError):
            raise RewardError("INVALID_ARGUMENT", "奖励数值或教师升级阈值无效。")
        now = _utc_now_iso()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            for key, value in updates.items():
                conn.execute(
                    """
                    INSERT INTO reward_config (config_key, config_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(config_key) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
                    """,
                    (key, json.dumps(value, ensure_ascii=False), now),
                )
            return self._config(conn)
