"""单 installationId 宽松限流 + Gateway 全局调用保险丝（进程内计数）。"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Optional

# 单实例：宽松，主要拦异常刷量
_INSTALL_WINDOW_SEC = float(os.getenv("AI_INSTALL_RATE_WINDOW_SEC", "60"))
_INSTALL_RATE_MAX = int(os.getenv("AI_INSTALL_RATE_MAX", "120"))
_INSTALL_DAY_MAX = int(os.getenv("AI_INSTALL_DAY_MAX", "3000"))

# 全局保险丝（调用次数近似费用）
_GLOBAL_HOUR_MAX = int(os.getenv("AI_GLOBAL_MAX_CALLS_PER_HOUR", "5000"))
_GLOBAL_DAY_MAX = int(os.getenv("AI_GLOBAL_MAX_CALLS_PER_DAY", "20000"))

# 签发 Token 防刷（IP + installation）
_TOKEN_ISSUE_WINDOW_SEC = float(os.getenv("AI_TOKEN_ISSUE_WINDOW_SEC", "60"))
_TOKEN_ISSUE_MAX = int(os.getenv("AI_TOKEN_ISSUE_MAX", "30"))

_DAY_SEC = 86400.0
_HOUR_SEC = 3600.0

_lock = threading.Lock()
_install_hits: dict[str, deque[float]] = defaultdict(deque)
_install_day: dict[str, deque[float]] = defaultdict(deque)
_global_hour: deque[float] = deque()
_global_day: deque[float] = deque()
_token_hits: dict[str, deque[float]] = defaultdict(deque)


def _prune(q: deque[float], now: float, window: float) -> None:
    while q and now - q[0] > window:
        q.popleft()


def reset_abuse_limits_for_tests() -> None:
    with _lock:
        _install_hits.clear()
        _install_day.clear()
        _global_hour.clear()
        _global_day.clear()
        _token_hits.clear()


def token_issue_ok(bucket: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _token_hits[bucket]
        _prune(q, now, _TOKEN_ISSUE_WINDOW_SEC)
        if len(q) >= _TOKEN_ISSUE_MAX:
            return False
        q.append(now)
        return True


def check_paid_call_allowed(installation_id: str) -> Optional[str]:
    """
    付费接口调用前检查并记账。
    返回内部错误码 RATE_LIMITED / GLOBAL_FUSE；None 表示允许。
    """
    key = (installation_id or "").strip().lower()
    if not key:
        return "SESSION_INVALID"

    now = time.monotonic()
    with _lock:
        _prune(_global_hour, now, _HOUR_SEC)
        _prune(_global_day, now, _DAY_SEC)
        if len(_global_hour) >= _GLOBAL_HOUR_MAX or len(_global_day) >= _GLOBAL_DAY_MAX:
            return "GLOBAL_FUSE"

        win = _install_hits[key]
        day = _install_day[key]
        _prune(win, now, _INSTALL_WINDOW_SEC)
        _prune(day, now, _DAY_SEC)
        if len(win) >= _INSTALL_RATE_MAX or len(day) >= _INSTALL_DAY_MAX:
            return "RATE_LIMITED"

        win.append(now)
        day.append(now)
        _global_hour.append(now)
        _global_day.append(now)
        return None
