#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
POC_ROOT = BENCHMARK_ROOT / "vector-edge-smoothing"
sys.path.insert(0, str(POC_ROOT / "src"))

from tolerance_review import integrity_snapshot
from vector_contract import sha256

PRIMARY_ROUTE = "V2_SMOOTH_BEZIER"
FALLBACK_LADDER = ["V2_SMOOTH_BEZIER", "V1_SIMPLIFIED_POLYGON", "V0_EXACT_PIXEL_BOUNDARY"]
KNOWN_ROUTE_SHA = "5054ae02b65c65eb81f6cef50501056459c9f0fecbbc9b553aeb67c14e5399e4"
KNOWN_INPUT_SHA = "1f131b7911276a268a6ad22f069778679bf800aa16b8c13dc1a848dfe6a8d43b"
KNOWN_CASE_METRICS_SHA = "ce90e7db5433761536ab75055fead5157600713548ed781010687fe82b6bd1c4"


def _safe_evidence_path(poc_root: Path, relative: str) -> Path | None:
    candidate = (poc_root / relative).resolve()
    try:
        candidate.relative_to(poc_root.resolve())
    except ValueError:
        return None
    return candidate


def validate_freeze(
    freeze_path: Path | None = None,
    poc_root: Path = POC_ROOT,
    benchmark_root: Path = BENCHMARK_ROOT,
) -> list[str]:
    errors: list[str] = []
    path = freeze_path or poc_root / "freeze.v1.json"
    try:
        freeze = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read freeze manifest: {error}"]

    if freeze.get("schemaVersion") != "1.0.0" or freeze.get("status") != "TOLERANCE_FREEZE_APPROVED":
        errors.append("freeze schema/status mismatch")
    try:
        datetime.fromisoformat(freeze.get("freezeTimestamp", ""))
    except ValueError:
        errors.append("freezeTimestamp is not ISO-8601")
    if freeze.get("primaryRoute") != PRIMARY_ROUTE:
        errors.append("primaryRoute must be V2_SMOOTH_BEZIER")
    tolerance = freeze.get("defaultTolerance", {})
    if tolerance.get("value") != 0.5:
        errors.append("default tolerance must be 0.5")
    if tolerance.get("unit") != "source_pixel":
        errors.append("default tolerance unit must be source_pixel")
    if tolerance.get("coordinateSystem") != "structural_label_map":
        errors.append("default tolerance coordinate system must be structural_label_map")
    if tolerance.get("display") != "0.5 source pixel":
        errors.append("default tolerance display must state 0.5 source pixel")
    if tolerance.get("resolutionNormalization") != "NOT_DEFINED_REQUIRES_REVALIDATION":
        errors.append("resolution normalization must remain undefined and require revalidation")
    if freeze.get("fallbackLadder") != FALLBACK_LADDER:
        errors.append("fallback ladder must be exactly V2 -> V1 -> V0")
    disposition = freeze.get("routeDisposition", {})
    if disposition.get("V2_1_SOURCE_PIXEL") != "BENCHMARK_ONLY" or disposition.get("V2_2_SOURCE_PIXELS") != "BENCHMARK_FUTURE_EXPERIMENT_ONLY":
        errors.append("1.0/2.0 source-pixel dispositions are not frozen as benchmark-only")
    if freeze.get("productionIntegration") is not False:
        errors.append("freeze baseline cannot claim production integration")

    geometry = freeze.get("geometryContract", {})
    required_geometry = {
        "geometryTruth": "structural_label_map",
        "labelMapMutationByVectorization": "FORBIDDEN",
        "sharedBoundaryFitCount": 1,
        "adjacentRegionReference": "SHARED_BOUNDARY_WITH_DIRECTION",
        "junctionMovement": "FORBIDDEN",
        "multipleFourConnectedPathComponents": "ALLOWED",
        "diagonalPointTouchSharedEdge": "FORBIDDEN",
    }
    if any(geometry.get(key) != value for key, value in required_geometry.items()):
        errors.append("geometry safety contract mismatch")
    safety = freeze.get("safetyContract", {})
    if not all(safety.get(key) is True for key in ("preserveTopology", "preserveRegionAdjacency", "preserveHoles")):
        errors.append("topology/adjacency/hole preservation must be true")
    if not all(safety.get(key) is False for key in ("allowNewSelfIntersection", "allowNewIllegalInterEdgeCrossing", "allowNewRegionAdjacency")):
        errors.append("new intersection/crossing/adjacency must be forbidden")
    if safety.get("unprovenLocalGeometry") != "FAIL_CLOSED" or safety.get("tinyHoleDeletion") != "FORBIDDEN":
        errors.append("fail-closed/tiny-hole contract mismatch")

    evidence = freeze.get("evidence", {})
    snapshot = integrity_snapshot(benchmark_root, poc_root)
    expected_snapshot = {
        "routeArtifactCount": 112,
        "routeArtifactAggregateSha256": KNOWN_ROUTE_SHA,
        "inputArtifactCount": 32,
        "inputArtifactAggregateSha256": KNOWN_INPUT_SHA,
        "caseMetricsSha256": KNOWN_CASE_METRICS_SHA,
    }
    if snapshot != expected_snapshot:
        errors.append(f"known frozen artifact SHA mismatch: {snapshot}")
    for key, value in expected_snapshot.items():
        if evidence.get(key) != value:
            errors.append(f"freeze evidence mismatch: {key}")

    for name in ("config", "pocManifest", "summary", "caseMetrics", "toleranceMetrics", "toleranceReview", "holeReview"):
        record = evidence.get(name, {})
        artifact = _safe_evidence_path(poc_root, record.get("path", ""))
        if artifact is None or not artifact.is_file():
            errors.append(f"missing or escaping evidence artifact: {name}")
        elif sha256(artifact) != record.get("sha256"):
            errors.append(f"evidence artifact SHA mismatch: {name}")

    summary = json.loads((poc_root / "reports" / "summary.json").read_text(encoding="utf-8"))
    if summary.get("v0ByteIdenticalCount") != 16 or summary.get("caseProfileCount") != 16:
        errors.append("V0 byte-identical evidence must remain 16/16")
    if summary.get("allHardGatesPass") is not True:
        errors.append("summary Hard Gate status is not PASS")

    case_metrics = json.loads((poc_root / "reports" / "case-metrics.json").read_text(encoding="utf-8"))["cases"]
    results = [result for case in case_metrics for result in case]
    if len(results) != 112 or sum(result.get("hardGate", {}).get("pass") is True for result in results) != 112:
        errors.append("all 112 route results must pass Hard Gate")
    v0_results = [result for result in results if result.get("route") == "V0_EXACT_PIXEL_BOUNDARY"]
    if len(v0_results) != 16 or not all(result.get("hardGate", {}).get("byteIdenticalLabelRoundTrip") is True for result in v0_results):
        errors.append("V0 exact byte-identical results are incomplete")

    tolerance_metrics = json.loads((poc_root / "reports" / "V2_TOLERANCE_METRICS.json").read_text(encoding="utf-8"))
    hole = tolerance_metrics.get("holeReview", {})
    if hole.get("holeCount") != 29 or hole.get("allRetained") is not True or len(hole.get("correspondence", [])) != 29:
        errors.append("FLD-007 must retain 29/29 holes")
    if not all(route.get("retained") is True for row in hole.get("correspondence", []) for route in row.get("routes", {}).values()):
        errors.append("one or more FLD-007 hole/tolerance correspondences are not retained")
    default_aggregate = tolerance_metrics.get("overall", {}).get("0.5", {})
    frozen_aggregate = evidence.get("v2DefaultToleranceAggregate", {})
    mapping = {
        "caseProfileCount": "caseProfileCount",
        "medianSymmetricMax": "medianSymmetricMaxDeviationSourcePixels",
        "maxSymmetricMax": "maxSymmetricMaxDeviationSourcePixels",
        "medianAreaError": "medianAreaErrorRatio",
        "maxAreaError": "maxAreaErrorRatio",
        "totalLineCount": "totalLineCount",
        "totalCubicCount": "totalCubicCount",
        "totalSegmentCount": "totalSegmentCount",
        "medianFallbackRatio": "medianFallbackRatio",
    }
    if any(default_aggregate.get(source) != frozen_aggregate.get(target) for source, target in mapping.items()):
        errors.append("default-tolerance exact aggregate metrics mismatch")

    freeze_doc = poc_root / "reports" / "P0-04C_VECTOR_EDGE_SMOOTHING_FREEZE.md"
    if not freeze_doc.is_file():
        errors.append("missing freeze document")
    else:
        text = freeze_doc.read_text(encoding="utf-8")
        for index, heading in enumerate(("Scope", "Frozen Inputs", "Frozen Route", "Frozen Default Tolerance", "Fallback Ladder", "Geometry Contract", "Topology Contract", "Hole Contract", "Determinism Contract", "External Review Decision", "Evidence Summary", "Benchmark-only Alternatives", "Known Non-goals", "Future Revalidation Triggers"), start=1):
            if f"## {index}. {heading}" not in text:
                errors.append(f"missing freeze document section: {heading}")
        if "0.5 source pixel" not in text or "P0-04C_VECTOR_EDGE_SMOOTHING_FROZEN" not in text:
            errors.append("freeze document omits frozen status/tolerance semantics")
    return errors


def main() -> int:
    errors = validate_freeze()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("P0-04C vector edge smoothing freeze validates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
