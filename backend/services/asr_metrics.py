"""ASR 延迟/失败日志，并汇总 P50/P95、失败率、空文本率。"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "asr_metrics.jsonl"


def record_asr_event(event: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        **event,
    }
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


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
    if not LOG_PATH.exists():
        return {
            "sampleSize": 0,
            "message": "尚无日志。先调用 /api/asr/smoke-test 产生数据。",
            "targets": {"latencyP50Ms": 1500, "latencyP95Ms": 3000, "failureRateMax": 0.05},
        }

    rows: list[dict[str, Any]] = []
    with LOG_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue

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
