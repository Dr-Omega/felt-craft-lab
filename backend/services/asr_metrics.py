"""ASR 延迟/失败聚合：无原始 session 标识，可写运行目录 + 有界轮转。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_MAX_LOG_BYTES = int(os.getenv("AI_METRICS_MAX_BYTES", str(2 * 1024 * 1024)))
_MAX_LINES_KEEP = int(os.getenv("AI_METRICS_KEEP_LINES", "2000"))


def metrics_log_path() -> Path:
    env = (os.getenv("AI_METRICS_DIR") or "").strip()
    if env:
        base = Path(env)
    else:
        base = Path(tempfile.gettempdir()) / "felt-craft-lab" / "metrics"
    return base / "asr_metrics.jsonl"


def session_bucket(session_id: Optional[str]) -> Optional[str]:
    """Irreversible short bucket; never persist raw session identifiers."""
    raw = (session_id or "").strip()
    if not raw:
        return None
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _rotate_if_needed(path: Path) -> None:
    if not path.exists():
        return
    try:
        if path.stat().st_size <= _MAX_LOG_BYTES:
            return
    except OSError:
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        kept = lines[-_MAX_LINES_KEEP:]
        path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    except OSError:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def record_asr_event(event: dict[str, Any]) -> None:
    path = metrics_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        _rotate_if_needed(path)
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            **event,
        }
        # Hard ban raw session identifiers if a caller slips them in
        payload.pop("sessionId", None)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        # Metrics must never break the request path
        return


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(sorted_vals[int(k)])
    d0 = sorted_vals[f] * (c - k)
    d1 = sorted_vals[c] * (k - f)
    return float(d0 + d1)


def summarize_asr_metrics(limit: int = 500) -> dict[str, Any]:
    """读取最近 limit 条日志，计算验收指标。"""
    path = metrics_log_path()
    if not path.exists():
        return {
            "sampleSize": 0,
            "message": "尚无日志。先调用受保护的 smoke-test 产生数据。",
            "logDirConfigured": bool((os.getenv("AI_METRICS_DIR") or "").strip()),
            "targets": {"latencyP50Ms": 1500, "latencyP95Ms": 3000, "failureRateMax": 0.05},
        }

    rows: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return {
            "sampleSize": 0,
            "message": "指标日志暂时不可读。",
            "targets": {"latencyP50Ms": 1500, "latencyP95Ms": 3000, "failureRateMax": 0.05},
        }

    rows = rows[-limit:]
    total = len(rows)
    ok_rows = [r for r in rows if r.get("ok") is True]
    fail_rows = [r for r in rows if r.get("ok") is not True]
    empty_rows = [r for r in ok_rows if r.get("empty") is True]
    latencies = sorted(
        float(r["latencyMs"])
        for r in ok_rows
        if isinstance(r.get("latencyMs"), (int, float))
    )

    failure_rate = (len(fail_rows) / total) if total else 0.0
    empty_rate = (len(empty_rows) / len(ok_rows)) if ok_rows else 0.0
    p50 = _percentile(latencies, 50)
    p95 = _percentile(latencies, 95)

    return {
        "sampleSize": total,
        "successCount": len(ok_rows),
        "failureCount": len(fail_rows),
        "emptyTranscriptCount": len(empty_rows),
        "failureRate": round(failure_rate, 4),
        "emptyTranscriptRate": round(empty_rate, 4),
        "latencyMs": {
            "p50": None if p50 is None else round(p50, 1),
            "p95": None if p95 is None else round(p95, 1),
            "count": len(latencies),
        },
        "targets": {
            "latencyP50Ms": 1500,
            "latencyP95Ms": 3000,
            "failureRateMax": 0.05,
        },
        "meetsTargets": {
            "p50": (p50 is not None and p50 <= 1500),
            "p95": (p95 is not None and p95 <= 3000),
            "failureRate": failure_rate <= 0.05,
        },
    }
