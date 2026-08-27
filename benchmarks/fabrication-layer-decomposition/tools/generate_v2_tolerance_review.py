#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
POC_ROOT = BENCHMARK_ROOT / "vector-edge-smoothing"
sys.path.insert(0, str(POC_ROOT / "src"))

from tolerance_review import generate_tolerance_review


def main() -> int:
    result = generate_tolerance_review(BENCHMARK_ROOT, POC_ROOT)
    print(result["status"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
