"""Channel-neutral order boundary. No live merchant adapter is configured yet.

Adapters must verify the provider's raw callback (signature, merchant, app,
timestamp and trade status) BEFORE returning VerifiedPayment. Renderer input
can never be used as a payment confirmation.
"""
from dataclasses import dataclass
from typing import Protocol
import sqlite3
import uuid
from services.reward_system import RewardSystem, RewardError, _utc_now_iso

PACKAGES = {"diamonds_10": (100, 10), "diamonds_60": (600, 60), "diamonds_100": (1000, 100)}


@dataclass(frozen=True)
class VerifiedPayment:
    order_id: str
    trade_id: str
    amount_minor: int
    currency: str


class PaymentProvider(Protocol):
    name: str
    def create(self, order: dict) -> dict: ...
    def query(self, order: dict) -> VerifiedPayment | None: ...
    def cancel(self, order: dict) -> bool: ...
    def verify_callback(self, raw: bytes, headers: dict) -> VerifiedPayment: ...


class Payments:
    def __init__(self, rewards: RewardSystem, provider: PaymentProvider | None = None):
        self.rewards, self.provider = rewards, provider
        with rewards._connect() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS payment_orders (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES plaza_users(user_id),
                request_id TEXT NOT NULL, package_id TEXT NOT NULL, amount INTEGER NOT NULL,
                diamonds INTEGER NOT NULL, currency TEXT NOT NULL, provider TEXT NOT NULL,
                status TEXT NOT NULL, trade_id TEXT, created_at TEXT NOT NULL,
                UNIQUE(user_id, request_id), UNIQUE(provider, trade_id))""")

    def capabilities(self):
        return {"available": self.provider is not None, "provider": self.provider.name if self.provider else None,
                "message": "支付渠道尚未配置，不会扣款或发放钻石。" if not self.provider else "以服务端确认的支付结果为准。",
                "packages": [{"packageId": key, "amountMinor": value[0], "diamonds": value[1], "currency": "CNY"} for key, value in PACKAGES.items()]}

    def _provider(self):
        if self.provider is None:
            raise RewardError("PAYMENT_UNAVAILABLE", "支付渠道尚未配置，不会扣款或发放钻石。", 503)
        return self.provider

    @staticmethod
    def public(row):
        return {"orderId": row["id"], "packageId": row["package_id"], "amountMinor": row["amount"],
                "currency": row["currency"], "diamonds": row["diamonds"], "status": row["status"], "createdAt": row["created_at"]}

    def get(self, user_id, order_id):
        with self.rewards._connect() as conn:
            row = conn.execute("SELECT * FROM payment_orders WHERE id=? AND user_id=?", (order_id, user_id)).fetchone()
        if row is None:
            raise RewardError("NOT_FOUND", "支付订单不存在。", 404)
        return dict(row)

    def create(self, user_id, package_id, request_id):
        provider = self._provider()
        if not isinstance(package_id, str) or package_id not in PACKAGES or not isinstance(request_id, str) or not 8 <= len(request_id) <= 100:
            raise RewardError("INVALID_ARGUMENT", "无效套餐或请求身份。")
        amount, diamonds = PACKAGES[package_id]
        with self.rewards._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM payment_orders WHERE user_id=? AND request_id=?", (user_id, request_id)).fetchone()
            if row is not None and row["package_id"] != package_id:
                raise RewardError("CONFLICT", "相同请求不能更换支付套餐。", 409)
            if row is None:
                order_id = "pay_" + uuid.uuid4().hex
                conn.execute("INSERT INTO payment_orders VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                             (order_id, user_id, request_id, package_id, amount, diamonds, "CNY", provider.name, "PENDING", None, _utc_now_iso()))
                row = conn.execute("SELECT * FROM payment_orders WHERE id=?", (order_id,)).fetchone()
        # Provider MUST use order id as its idempotency key. A timeout leaves PENDING,
        # never FAILED/PAID: a retry recovers the same merchant order.
        checkout = provider.create(dict(row)) if row["status"] == "PENDING" else None
        return {"order": self.public(row), "checkout": checkout}

    def settle(self, payment: VerifiedPayment):
        provider = self._provider()
        if not isinstance(payment, VerifiedPayment) or not payment.trade_id:
            raise RewardError("INVALID_PAYMENT", "支付确认无效。")
        with self.rewards._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM payment_orders WHERE id=?", (payment.order_id,)).fetchone()
            if row is None or row["provider"] != provider.name or type(payment.amount_minor) is not int or payment.amount_minor != row["amount"] or payment.currency != row["currency"]:
                raise RewardError("INVALID_PAYMENT", "订单金额、币种或渠道不匹配。", 409)
            if row["status"] == "PAID":
                if row["trade_id"] != payment.trade_id:
                    raise RewardError("CONFLICT", "重复订单的交易身份不一致。", 409)
                return self.public(row)
            if row["status"] != "PENDING":
                raise RewardError("RECONCILIATION_REQUIRED", "已关闭订单收到支付，请人工核对，不重复入账。", 409)
            try:
                conn.execute("UPDATE payment_orders SET status='PAID', trade_id=? WHERE id=?", (payment.trade_id, payment.order_id))
            except sqlite3.IntegrityError:
                raise RewardError("CONFLICT", "支付交易已绑定另一订单。", 409)
            self.rewards._ensure_wallet(conn, row["user_id"])
            self.rewards._credit(conn, user_id=row["user_id"], currency="diamonds", amount=row["diamonds"], reason="recharge", reference_id=payment.order_id)
            return self.public(conn.execute("SELECT * FROM payment_orders WHERE id=?", (payment.order_id,)).fetchone())

    def query(self, user_id, order_id):
        row = self.get(user_id, order_id)
        if row["status"] == "PENDING":
            paid = self._provider().query(row)
            if paid is not None:
                if paid.order_id != order_id:
                    raise RewardError("INVALID_PAYMENT", "查询响应订单不匹配。", 409)
                return self.settle(paid)
        return self.public(row)

    def cancel(self, user_id, order_id):
        row = self.get(user_id, order_id)
        if row["status"] != "PENDING":
            return self.public(row)
        if not self._provider().cancel(row):
            return self.query(user_id, order_id)
        with self.rewards._connect() as conn:
            conn.execute("UPDATE payment_orders SET status='CANCELLED' WHERE id=? AND status='PENDING'", (order_id,))
        return self.public(self.get(user_id, order_id))

    def callback(self, raw, headers):
        return self.settle(self._provider().verify_callback(raw, headers))
