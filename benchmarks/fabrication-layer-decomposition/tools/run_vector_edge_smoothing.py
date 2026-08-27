#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
POC_ROOT = BENCHMARK_ROOT / "vector-edge-smoothing"
sys.path.insert(0, str(POC_ROOT / "src"))

from review import generate_reviews, write_summary_markdown
from runner import run_all, summarize_existing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-only", action="store_true", help="rebuild reports from a complete existing result matrix")
    args = parser.parse_args()
    summary = summarize_existing(POC_ROOT) if args.report_only else run_all(BENCHMARK_ROOT, POC_ROOT)
    if not summary["allHardGatesPass"]:
        print("HARD_GATE_FAILED")
        return 1
    generate_reviews(BENCHMARK_ROOT, POC_ROOT)
    write_summary_markdown(POC_ROOT)
    print(summary["status"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
