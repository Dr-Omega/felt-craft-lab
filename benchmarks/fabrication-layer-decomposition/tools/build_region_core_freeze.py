#!/usr/bin/env python3
"""Build additive raw-only Region Core freeze sidecars from immutable CP-B outputs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
from typing import Any

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BENCHMARK_ROOT.parents[1]
REGION_CORE_ROOT = BENCHMARK_ROOT / "region-core"
sys.path.insert(0, str(REGION_CORE_ROOT / "src"))

from frozen_contract import (  # noqa: E402
    BALANCED_REGRESSION_PROFILE,
    CASE_IDS,
    PRIMARY_FROZEN_PROFILE,
    artifact_record,
    build_case_contract,
    write_case_contract,
)
from region_core import sha256, write_json  # noqa: E402


def aggregate_sha(records: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for record in sorted(records, key=lambda value: value["path"]):
        digest.update(record["path"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(record["sha256"].encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def build() -> dict[str, Any]:
    output_root = REGION_CORE_ROOT / "outputs" / "frozen" / PRIMARY_FROZEN_PROFILE
    primary_contracts: list[dict[str, Any]] = []
    primary_artifact_records: list[dict[str, Any]] = []
    primary_region_count = 0
    primary_component_count = 0
    for fixture_id in CASE_IDS:
        contract = build_case_contract(REPOSITORY_ROOT, BENCHMARK_ROOT, PRIMARY_FROZEN_PROFILE, fixture_id)
        contract_path = output_root / fixture_id / "region-core.json"
        write_case_contract(contract_path, contract)
        record = artifact_record(REPOSITORY_ROOT, contract_path)
        primary_contracts.append({"fixtureId": fixture_id, "profile": PRIMARY_FROZEN_PROFILE, "contract": record})
        primary_artifact_records.extend(contract["artifacts"].values())
        primary_region_count += len(contract["regions"])
        primary_component_count += sum(region["componentCount"] for region in contract["regions"])

    balanced_evidence: list[dict[str, Any]] = []
    balanced_artifact_records: list[dict[str, Any]] = []
    for fixture_id in CASE_IDS:
        audit = build_case_contract(
            REPOSITORY_ROOT,
            BENCHMARK_ROOT,
            BALANCED_REGRESSION_PROFILE,
            fixture_id,
            allow_regression_evidence=True,
        )
        artifacts = audit["artifacts"]
        balanced_artifact_records.extend(artifacts.values())
        balanced_evidence.append(
            {
                "fixtureId": fixture_id,
                "profile": BALANCED_REGRESSION_PROFILE,
                "status": "REGRESSION_EVIDENCE_ONLY",
                "regionCount": len(audit["regions"]),
                "componentCount4": sum(region["componentCount"] for region in audit["regions"]),
                "artifacts": artifacts,
            }
        )

    p0_04c_freeze = BENCHMARK_ROOT / "vector-edge-smoothing" / "freeze.v1.json"
    determinism = REGION_CORE_ROOT / "reports" / "representative-color" / "RC-A_FULL_DETERMINISM.json"
    freeze = {
        "schemaVersion": "1.0.0",
        "status": "REGION_CORE_FROZEN",
        "freezeTimestamp": "2026-08-28T00:00:00+08:00",
        "scope": "P0-04B_REGION_CORE_RAW_LABEL_FREEZE",
        "governance": {
            "primaryFrozenProfile": PRIMARY_FROZEN_PROFILE,
            "balancedStatus": "REGRESSION_EVIDENCE_ONLY",
            "representativeColor": {"RC-A": "FROZEN", "RC-B": "BENCHMARK_ONLY", "RC-C": "BENCHMARK_ONLY", "RC-D": "BENCHMARK_ONLY"},
            "productionIntegrationStatus": "NOT_INTEGRATED",
        },
        "connectivity": {
            "proposalConnectivity": 8,
            "componentConnectivity": 4,
            "adjacencyConnectivity": 4,
            "voidConnectivity": 4,
            "oneRegionMayContainMultipleFourConnectedComponents": True,
        },
        "artifactIdentityContract": {
            "trackedText": "GIT_BLOB_CANONICAL_LF",
            "binary": "EXACT_BYTES",
            "textSuffixes": [".json", ".md", ".py", ".txt"],
            "checkoutLineEndingsAffectIdentity": False,
        },
        "legacyMetadataDisposition": "LEGACY_COMPONENT_METADATA_SUPERSEDED",
        "regionRepairDisposition": {
            "status": "REJECTED_AS_PRODUCTION_APPROACH",
            "usage": "RESEARCH_EVIDENCE_ONLY",
            "productionStatus": "NOT_PRODUCTION",
            "freezeBlockerStatus": "NOT_FREEZE_BLOCKER",
            "g02Shadow": "G02_SHADOW remains part of the rejected Region Repair route and is not a Region Core Freeze blocker.",
            "frozenInput": False,
        },
        "upstreamBaselines": {
            "p0_04cUpstreamBaselineCommit": "4dc782343fbf02836d9cf36a8bd42975eec41d2f",
            "p0_04cFreezeManifest": artifact_record(REPOSITORY_ROOT, p0_04c_freeze),
            "b0FrozenCommit": "7ab146b",
        },
        "primaryFrozenContracts": primary_contracts,
        "balancedRegressionEvidence": balanced_evidence,
        "evidence": {
            "primaryContractCount": len(primary_contracts),
            "primaryFixtureIds": list(CASE_IDS),
            "primaryRegionCount": primary_region_count,
            "primaryComponentCount4": primary_component_count,
            "primaryInputArtifactCount": len(primary_artifact_records),
            "primaryInputArtifactAggregateSha256": aggregate_sha(primary_artifact_records),
            "balancedEvidenceCount": len(balanced_evidence),
            "balancedFixtureIds": list(CASE_IDS),
            "balancedInputArtifactCount": len(balanced_artifact_records),
            "balancedInputArtifactAggregateSha256": aggregate_sha(balanced_artifact_records),
            "rcADeterminism": artifact_record(REPOSITORY_ROOT, determinism),
        },
        "prohibitedFrozenSemantics": [
            "repairPolicy",
            "repairAudit",
            "SAFE_MERGE",
            "mergedRegionIds",
            "appearance_label_map from Repair Apply",
            "colorGroup*",
            "Material",
            "Piece",
            "Layer",
            "Vector",
        ],
        "futureRevalidationTriggers": [
            "CP_B_PROPOSAL_CHANGE",
            "PRIMARY_PROFILE_PARAMETER_CHANGE",
            "RC_A_CHANGE",
            "STRUCTURAL_ALPHA_POLICY_CHANGE",
            "REGION_ID_OR_CONNECTIVITY_CONTRACT_CHANGE",
            "NEW_OR_CHANGED_FIXTURE",
        ],
    }
    write_json(REGION_CORE_ROOT / "freeze.v1.json", freeze)
    report = (
        "# P0-04B Region Core Freeze\n\n"
        "Status: `REGION_CORE_FROZEN`\n\n"
        "## Frozen selection\n\n"
        f"- `PRIMARY_FROZEN_PROFILE={PRIMARY_FROZEN_PROFILE}`\n"
        f"- `{BALANCED_REGRESSION_PROFILE}=REGRESSION_EVIDENCE_ONLY`\n"
        "- `RC-A=FROZEN`; RC-B/RC-C/RC-D are Benchmark-only.\n"
        "- `PRODUCTION_INTEGRATION_STATUS=NOT_INTEGRATED`\n\n"
        "## Contract\n\n"
        "The frozen truth is the existing CP-B raw structural label map. Proposal connectivity is 8; component, adjacency, and void connectivity are 4. "
        "A single Region ID may contain multiple 4-connected components and must not be treated as one connected polygon. The pixel label map is optional fringe coverage evidence.\n\n"
        "Historical `regions.json.gz` files remain byte-identical. Their fixed `componentCount` is not frozen component truth. "
        "The new sidecars derive `components[]`, area, and bbox directly from each structural label map. `LEGACY_COMPONENT_METADATA_SUPERSEDED`.\n\n"
        "Tracked text artifact identity uses canonical Git-blob LF bytes; binary artifacts use exact bytes. CRLF/LF checkout representation does not change Frozen identity.\n\n"
        "## Representative color audit\n\n"
        "RC-A is recomputed as the median Lab color over the configured Core Sampling Area. Every stored Region RGB/Lab/core count and every assigned pixel in "
        "the purified raster must match the recomputation. Existing full determinism evidence remains pinned by SHA. No RC algorithm selection is reopened.\n\n"
        "## Frozen matrix\n\n"
        f"Exactly {len(primary_contracts)} primary contracts cover FLD-001 through FLD-008. Exactly {len(balanced_evidence)} balanced records cover the same fixture set as regression evidence only. "
        "The validator rejects zero, missing, extra, wrong-case, or wrong-profile entries.\n\n"
        "## Region Repair disposition\n\n"
        "Region Repair is `REJECTED_AS_PRODUCTION_APPROACH`, `RESEARCH_EVIDENCE_ONLY`, `NOT_PRODUCTION`, and `NOT_FREEZE_BLOCKER`. "
        "G02_SHADOW remains part of the rejected Region Repair route and is not a Region Core Freeze blocker. Repair results are not frozen inputs.\n\n"
        "## Exclusions\n\n"
        "Frozen contracts prohibit Repair Apply appearance maps, SAFE_MERGE, repair policy/audit, merged IDs, experimental color groups, Material, Piece, Layer, and Vector semantics. "
        "This freeze does not integrate Region Core into Production and does not start B2.\n\n"
        "## Evidence totals\n\n"
        f"- Primary Regions: {primary_region_count}\n"
        f"- Primary 4-connected components: {primary_component_count}\n"
        f"- Primary input artifact aggregate SHA-256: `{freeze['evidence']['primaryInputArtifactAggregateSha256']}`\n"
        f"- Balanced input artifact aggregate SHA-256: `{freeze['evidence']['balancedInputArtifactAggregateSha256']}`\n"
    )
    report_path = REGION_CORE_ROOT / "reports" / "REGION_CORE_FREEZE.md"
    report_path.write_text(report, encoding="utf-8")
    return freeze


def main() -> int:
    freeze = build()
    print(json.dumps({"status": freeze["status"], "primaryContractCount": len(freeze["primaryFrozenContracts"]), "balancedEvidenceCount": len(freeze["balancedRegressionEvidence"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
