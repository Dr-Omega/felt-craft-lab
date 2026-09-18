#!/usr/bin/env python3
"""Generate the bucketed project-real B2 GT review pack v2."""

from pathlib import Path
import json
import sys

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BENCHMARK_ROOT.parents[1]
B2_ROOT = BENCHMARK_ROOT / "fabrication-decomposition"
sys.path.insert(0, str(B2_ROOT / "src"))

from gt_review_pack_v2 import build_review_pack_v2  # noqa: E402


if __name__ == "__main__":
    result = build_review_pack_v2(REPOSITORY_ROOT, BENCHMARK_ROOT)
    print(
        json.dumps(
            {
                "status": result["status"],
                "fixtureCount": len(result["cases"]),
                "candidateCount": sum(row["candidateCount"] for row in result["cases"]),
            },
            indent=2,
        )
    )
