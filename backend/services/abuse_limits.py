"""单 installationId 宽松防刷限流 + Gateway 全局付费调用保险丝（进程内）。

说明（正式部署前）：
- 计数为 process-local；进程重启清零；多 worker 不共享。
- 本 PR 不引入 Redis/数据库；跨进程 fuse 留待部署阶段。
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Optional

# 单实例：宽松，主要拦异常刷量（鉴权后即可计；与付费 fuse 分离）
_INSTALL_WINDOW_SEC = float(os.getenv("AI_INSTALL_RATE_WINDOW_SEC", "60"))
_INSTALL_RATE_MAX = int(os.getenv("AI_INSTALL_RATE_MAX", "120"))
_INSTALL_DAY_MAX = int(os.getenv("AI_INSTALL_DAY_MAX", "3000"))

# 全局付费保险丝（仅真实 Provider 调用记账；调用次数近似费用）
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


def global_fuse_counts_for_tests() -> tuple[int, int]:
    """Test helper: (hour_count, day_count)."""
    now = time.monotonic()
    with _lock:
        _prune(_global_hour, now, _HOUR_SEC)
        _prune(_global_day, now, _DAY_SEC)
        return len(_global_hour), len(_global_day)


def token_issue_ok(bucket: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _token_hits[bucket]
        _prune(q, now, _TOKEN_ISSUE_WINDOW_SEC)
        if len(q) >= _TOKEN_ISSUE_MAX:
            return False
        q.append(now)
        return True


def check_install_rate_limit(installation_id: str) -> Optional[str]:
    """
    鉴权后的普通防刷限流（可覆盖非法参数 / mock）。
    不消费全局付费保险丝。
    """
    key = (installation_id or "").strip().lower()
    if not key:
        return "SESSION_INVALID"

    now = time.monotonic()
    with _lock:
        win = _install_hits[key]
        day = _install_day[key]
        _prune(win, now, _INSTALL_WINDOW_SEC)
        _prune(day, now, _DAY_SEC)
        if len(win) >= _INSTALL_RATE_MAX or len(day) >= _INSTALL_DAY_MAX:
            return "RATE_LIMITED"
        win.append(now)
        day.append(now)
        return None


def consume_paid_provider_call(installation_id: str) -> Optional[str]:
    """
    仅在参数/MIME/provider 校验通过，且即将调用真实付费 Provider 时记账。
    mock / 非法请求不得调用本函数。
    返回 GLOBAL_FUSE 或 None。
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
        _global_hour.append(now)
        _global_day.append(now)
        return None


# Back-compat alias used by older call sites during transition
def check_paid_call_allowed(installation_id: str) -> Optional[str]:
    """Deprecated combined check — prefer split helpers."""
    limited = check_install_rate_limit(installation_id)
    if limited:
        return limited
    return consume_paid_provider_call(installation_id)
