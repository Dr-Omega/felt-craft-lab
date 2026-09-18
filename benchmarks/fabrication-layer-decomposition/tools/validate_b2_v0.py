#!/usr/bin/env python3
"""Fail-closed validation of the B2-V0 observed-only contract and output matrix."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BENCHMARK_ROOT.parents[1]
B2_ROOT = BENCHMARK_ROOT / "fabrication-decomposition"
sys.path.insert(0, str(B2_ROOT / "src"))

from b2_contract import (  # noqa: E402
    B2ContractError,
    B2_UPSTREAM_BASELINE,
    CASE_IDS,
    PRIMARY_PROFILE,
    assert_no_forbidden_keys,
    build_v0_case,
    canonical_bytes,
    load_json,
    sha256,
    validate_overlap_relations,
)


def validate() -> list[str]:
    errors: list[str] = []
    try:
        manifest = load_json(B2_ROOT / "manifest.v0.json")
    except (OSError, json.JSONDecodeError, B2ContractError) as error:
        return [f"cannot read B2 manifest: {error}"]
    upstream = manifest.get("upstream", {})
    if upstream.get("b2FullUpstreamBaseline") != B2_UPSTREAM_BASELINE:
        errors.append("B2 full upstream baseline mismatch")
    if upstream.get("primaryFrozenProfile") != PRIMARY_PROFILE:
        errors.append("B2 must use only the primary Frozen profile")
    region_freeze = BENCHMARK_ROOT / "region-core" / "freeze.v1.json"
    vector_freeze = BENCHMARK_ROOT / "vector-edge-smoothing" / "freeze.v1.json"
    if sha256(region_freeze) != upstream.get("regionCoreFreezeSha256"):
        errors.append("Region Core Frozen manifest SHA mismatch")
    if sha256(vector_freeze) != upstream.get("p0_04cFreezeSha256"):
        errors.append("P0-04C Frozen manifest SHA mismatch")
    if upstream.get("p0_04cFallbackLadder") != ["V2_SMOOTH_BEZIER", "V1_SIMPLIFIED_POLYGON", "V0_EXACT_PIXEL_BOUNDARY"]:
        errors.append("P0-04C fallback ladder mismatch")
    identity = manifest.get("identityContract", {})
    if identity != {
        "regionIdEqualsFabricationPieceId": False,
        "fabricationPieceIdEqualsColorLayerId": False,
        "colorLayerGroupingImplemented": False,
    }:
        errors.append("Region/Piece/Color Layer identity separation is not explicit")
    applicability = manifest.get("fixtureApplicability", [])
    if len(applicability) != 8 or [row.get("fixtureId") for row in applicability] != list(CASE_IDS):
        errors.append("fixture applicability matrix must be exactly FLD-001..FLD-008")
    if any(row.get("classification") not in {"B2_HIGH_VALUE", "B2_LIMITED", "B2_NOT_APPLICABLE"} for row in applicability):
        errors.append("unknown B2 fixture applicability classification")
    if manifest.get("datasetGap", {}).get("status") != "DATASET_GAP":
        errors.append("project-real B2 GT gap must remain explicit")

    discovered = sorted((B2_ROOT / "outputs" / "v0").rglob("result.json"))
    expected_paths = [B2_ROOT / "outputs" / "v0" / fixture_id / "result.json" for fixture_id in CASE_IDS]
    if [path.resolve() for path in discovered] != [path.resolve() for path in expected_paths]:
        errors.append("B2-V0 output matrix must contain exactly one result for FLD-001..FLD-008")
        return errors
    for fixture_id, path in zip(CASE_IDS, expected_paths, strict=True):
        try:
            actual = load_json(path)
            rebuilt = build_v0_case(REPOSITORY_ROOT, BENCHMARK_ROOT, fixture_id)
            if canonical_bytes(actual) != canonical_bytes(rebuilt):
                raise B2ContractError(f"{fixture_id} result differs from deterministic Frozen-input derivation")
            assert_no_forbidden_keys(actual)
            if actual.get("status") != "B2_V0_REVALIDATED_ON_REPAIRED_BASELINE":
                raise B2ContractError(f"{fixture_id} status is not complete")
            if actual.get("caseId") != fixture_id or actual.get("profile") != PRIMARY_PROFILE:
                raise B2ContractError(f"{fixture_id} case/profile mismatch")
            if actual.get("mode") != "B2-V0_OBSERVED_ONLY" or actual.get("geometryTruth") != "structural_label_map":
                raise B2ContractError(f"{fixture_id} V0 mode/geometry truth mismatch")
            pieces = actual.get("pieces", [])
            piece_ids = [piece.get("pieceId") for piece in pieces]
            if len(piece_ids) != len(set(piece_ids)):
                raise B2ContractError(f"{fixture_id} Piece IDs are not unique")
            if any(not re.fullmatch(rf"FP-{fixture_id}-R\d{{5}}-C\d{{3}}", str(piece_id)) for piece_id in piece_ids):
                raise B2ContractError(f"{fixture_id} Piece ID contract mismatch")
            for piece in pieces:
                if len(piece.get("sourceRegionIds", [])) != 1 or len(piece.get("sourceComponentIds", [])) != 1:
                    raise B2ContractError(f"{fixture_id} V0 Piece must consume exactly one component")
                if piece.get("inferredGeometry") is not None or piece.get("inferenceType") != "OBSERVED_ONLY":
                    raise B2ContractError(f"{fixture_id} V0 must not contain hidden geometry")
                if piece.get("observedGeometry") != piece.get("finalCutGeometry"):
                    raise B2ContractError(f"{fixture_id} V0 changed an observed boundary")
                if piece.get("representativeColor", {}).get("method") != "RC-A":
                    raise B2ContractError(f"{fixture_id} Piece does not use Frozen RC-A")
            overlap = actual.get("overlapContract", {})
            if overlap.get("relations") != [] or overlap.get("unspecifiedRelation") != "NO_RELATION":
                raise B2ContractError(f"{fixture_id} V0 fabricated overlap ordering")
            validate_overlap_relations(set(piece_ids), overlap["relations"])
            gate = actual.get("hardGate", {})
            if gate.get("pass") is not True or gate.get("pieceCount") != gate.get("frozenComponentCount"):
                raise B2ContractError(f"{fixture_id} V0 Hard Gate failed")
            for zero_field in (
                "missingComponentCount",
                "duplicateComponentConsumptionCount",
                "extraComponentConsumptionCount",
                "hiddenGeometryCount",
                "observedBoundaryMutationCount",
                "openPathCount",
                "selfIntersectionCount",
                "illegalIntersectionCount",
            ):
                if gate.get(zero_field) != 0:
                    raise B2ContractError(f"{fixture_id} Hard Gate {zero_field} is nonzero")
            if gate.get("byteIdenticalDeterminism") is not True or gate.get("componentAndHoleSemanticsPreserved") is not True:
                raise B2ContractError(f"{fixture_id} determinism/topology gate failed")
            observed_holes = sum(len(piece["observedGeometry"]["innerRings"]) for piece in pieces)
            if gate.get("observedInnerRingCount") != observed_holes or gate.get("frozenInnerRingCount") != observed_holes:
                raise B2ContractError(f"{fixture_id} component/hole count provenance mismatch")
        except (OSError, json.JSONDecodeError, B2ContractError) as error:
            errors.append(str(error))
    summary_path = B2_ROOT / "reports" / "summary.json"
    report_path = B2_ROOT / "reports" / "B2_V0_BASELINE.md"
    if not summary_path.is_file() or not report_path.is_file():
        errors.append("missing B2-V0 summary/report")
    else:
        summary = load_json(summary_path)
        if summary.get("status") != "B2_V0_REVALIDATED_ON_REPAIRED_BASELINE" or summary.get("v0Status") != "VALIDATED_BASELINE" or summary.get("fixtureCount") != 8:
            errors.append("B2-V0 summary status/matrix mismatch")
        if summary.get("allHardGatesPass") is not True or summary.get("upstreamFrozenArtifactsUnchanged") is not True:
            errors.append("B2-V0 summary Hard Gate/upstream integrity failed")
        if summary.get("v1Readiness") != "BLOCKED_PROJECT_REAL_B2_GT":
            errors.append("B2-V1 must remain blocked on project-real GT")
    return errors


def main() -> int:
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("P0-04B2 V0 validates: B2_V0_REVALIDATED_ON_REPAIRED_BASELINE (8/8 fixtures)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
