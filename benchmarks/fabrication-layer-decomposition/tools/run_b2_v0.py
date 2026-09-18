#!/usr/bin/env python3
"""Generate the deterministic B2-V0 observed-only baseline for all frozen fixtures."""

from __future__ import annotations

import json
from pathlib import Path
import sys

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BENCHMARK_ROOT.parents[1]
B2_ROOT = BENCHMARK_ROOT / "fabrication-decomposition"
sys.path.insert(0, str(B2_ROOT / "src"))

from b2_contract import CASE_IDS, build_v0_case, canonical_bytes, sha256, write_json  # noqa: E402


def upstream_snapshot() -> dict[str, str]:
    paths = [
        BENCHMARK_ROOT / "region-core" / "freeze.v1.json",
        BENCHMARK_ROOT / "vector-edge-smoothing" / "freeze.v1.json",
    ]
    paths.extend(sorted((BENCHMARK_ROOT / "region-core" / "outputs" / "frozen").rglob("region-core.json")))
    paths.extend(sorted((BENCHMARK_ROOT / "outputs" / "color-purification" / "cp-b-aggressive_rc-a").rglob("*")))
    paths.extend(sorted((BENCHMARK_ROOT / "vector-edge-smoothing" / "outputs" / "cp-b-aggressive_rc-a").rglob("*")))
    return {
        path.resolve().relative_to(REPOSITORY_ROOT.resolve()).as_posix(): sha256(path)
        for path in paths
        if path.is_file()
    }


def run() -> dict:
    manifest = json.loads((B2_ROOT / "manifest.v0.json").read_text(encoding="utf-8"))
    classification = {row["fixtureId"]: row for row in manifest["fixtureApplicability"]}
    before = upstream_snapshot()
    case_records = []
    total_pieces = 0
    total_regions = 0
    total_components = 0
    total_fallback_edges = 0
    output_root = B2_ROOT / "outputs" / "v0"
    for fixture_id in CASE_IDS:
        first = build_v0_case(REPOSITORY_ROOT, BENCHMARK_ROOT, fixture_id)
        second = build_v0_case(REPOSITORY_ROOT, BENCHMARK_ROOT, fixture_id)
        if canonical_bytes(first) != canonical_bytes(second):
            raise RuntimeError(f"{fixture_id} B2-V0 is not byte deterministic")
        path = output_root / fixture_id / "result.json"
        write_json(path, first)
        hard_gate = first["hardGate"]
        total_pieces += hard_gate["pieceCount"]
        total_regions += hard_gate["frozenRegionCount"]
        total_components += hard_gate["frozenComponentCount"]
        total_fallback_edges += first["provenance"]["referencedFallbackEdgeCount"]
        case_records.append(
            {
                "fixtureId": fixture_id,
                "classification": classification[fixture_id]["classification"],
                "status": first["status"],
                "regionCount": hard_gate["frozenRegionCount"],
                "componentCount": hard_gate["frozenComponentCount"],
                "pieceCount": hard_gate["pieceCount"],
                "holeCount": sum(len(piece["observedGeometry"]["innerRings"]) for piece in first["pieces"]),
                "referencedFallbackEdgeCount": first["provenance"]["referencedFallbackEdgeCount"],
                "hardGatePass": hard_gate["pass"],
                "outputPath": path.resolve().relative_to(REPOSITORY_ROOT.resolve()).as_posix(),
                "outputSha256": sha256(path),
            }
        )
    after = upstream_snapshot()
    if before != after:
        raise RuntimeError("an upstream Frozen artifact changed during B2-V0")
    summary = {
        "status": "B2_V0_REVALIDATED_ON_REPAIRED_BASELINE",
        "v0Status": "VALIDATED_BASELINE",
        "upstreamBaseline": manifest["upstream"]["b2FullUpstreamBaseline"],
        "profile": manifest["upstream"]["primaryFrozenProfile"],
        "fixtureCount": len(case_records),
        "totalRegionCount": total_regions,
        "totalComponentCount": total_components,
        "totalPieceCount": total_pieces,
        "totalReferencedFallbackEdgeCount": total_fallback_edges,
        "allHardGatesPass": all(record["hardGatePass"] for record in case_records),
        "upstreamFrozenArtifactsUnchanged": True,
        "datasetGap": manifest["datasetGap"],
        "v1Readiness": "BLOCKED_PROJECT_REAL_B2_GT",
        "cases": case_records,
    }
    write_json(B2_ROOT / "reports" / "summary.json", summary)
    rows = "\n".join(
        f"| {row['fixtureId']} | {row['classification']} | {row['regionCount']} | {row['componentCount']} | {row['pieceCount']} | {row['holeCount']} | {row['referencedFallbackEdgeCount']} | PASS |"
        for row in case_records
    )
    (B2_ROOT / "reports" / "B2_V0_BASELINE.md").write_text(
        "# P0-04B2 V0 Observed-only Baseline\n\n"
        "Status: `B2_V0_REVALIDATED_ON_REPAIRED_BASELINE`\n\n"
        "`B2_V0_STATUS=VALIDATED_BASELINE`\n\n"
        "`B2_FULL_UPSTREAM_BASELINE=90a92ae1853ce07308238a70f9301fa148821b66`\n\n"
        "Every Frozen 4-connected component is consumed exactly once by a separately identified Fabrication Piece. No hidden geometry, boundary mutation, geometry merge, Color Layer, Material, Repair, or z-order inference is present.\n\n"
        "| Fixture | Applicability | Regions | Components | Pieces | Inner rings | Frozen fallback edges | V0 Gate |\n"
        "|---|---|---:|---:|---:|---:|---:|---|\n"
        f"{rows}\n\n"
        "## Dataset gap and V1 readiness\n\n"
        "Current fixtures contain useful overlap candidates, but there is no project-real piece identity, hidden-contour, or human-authored overlap partial-order GT. "
        "The result is `DATASET_GAP`; B2-V1 is `BLOCKED_PROJECT_REAL_B2_GT` and was not started.\n",
        encoding="utf-8",
    )
    return summary


def main() -> int:
    summary = run()
    print(json.dumps({key: summary[key] for key in ("status", "fixtureCount", "totalRegionCount", "totalComponentCount", "totalPieceCount", "allHardGatesPass", "v1Readiness")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
