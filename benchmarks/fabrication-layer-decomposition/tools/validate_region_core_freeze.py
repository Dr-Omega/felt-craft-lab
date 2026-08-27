#!/usr/bin/env python3
"""Fail-closed validation for the P0-04B raw Region Core freeze."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
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
    assert_no_forbidden_keys,
    build_case_contract,
)
from region_core import RegionCoreError, sha256  # noqa: E402


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RegionCoreError(f"{path.name} must contain an object")
    return value


def _schema_errors(instance: dict[str, Any], schema_path: Path) -> list[str]:
    """Validate the fail-closed top-level contract without adding a PoC dependency."""
    schema = _load_json(schema_path)
    errors: list[str] = []
    required = set(schema.get("required", []))
    allowed = set(schema.get("properties", {}))
    missing = sorted(required - set(instance))
    extra = sorted(set(instance) - allowed) if schema.get("additionalProperties") is False else []
    if missing:
        errors.append(f"schema {schema_path.name}: missing fields {missing}")
    if extra:
        errors.append(f"schema {schema_path.name}: additional fields {extra}")
    for key, definition in schema.get("properties", {}).items():
        if key in instance and "const" in definition and instance[key] != definition["const"]:
            errors.append(f"schema {schema_path.name}: {key} must equal {definition['const']!r}")
    if schema_path.name == "freeze.schema.json":
        try:
            datetime.fromisoformat(str(instance.get("freezeTimestamp", "")))
        except ValueError:
            errors.append("schema freeze.schema.json: freezeTimestamp must be ISO-8601")
    if schema_path.name == "region_core_frozen_contract.schema.json":
        if instance.get("fixtureId") not in CASE_IDS:
            errors.append("schema region_core_frozen_contract.schema.json: invalid fixtureId")
        if instance.get("profile") != PRIMARY_FROZEN_PROFILE:
            errors.append("schema region_core_frozen_contract.schema.json: invalid profile")
    return errors


def matrix_errors(rows: Any, expected_profile: str, *, contract_key: str | None) -> list[str]:
    label = "primary frozen contracts" if contract_key else "balanced regression evidence"
    if not isinstance(rows, list):
        return [f"{label} must be an array"]
    errors: list[str] = []
    if len(rows) != 8:
        errors.append(f"{label} must contain exactly 8 rows, found {len(rows)}")
    fixture_ids = [row.get("fixtureId") for row in rows if isinstance(row, dict)]
    if len(fixture_ids) != len(rows):
        errors.append(f"{label} contains a non-object row")
    if sorted(fixture_ids) != sorted(CASE_IDS):
        errors.append(f"{label} fixture matrix must be exactly FLD-001..FLD-008")
    if len(fixture_ids) != len(set(fixture_ids)):
        errors.append(f"{label} fixture IDs must be unique")
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("profile") != expected_profile:
            errors.append(f"{label} {row.get('fixtureId')} has wrong profile")
        if contract_key and not isinstance(row.get(contract_key), dict):
            errors.append(f"{label} {row.get('fixtureId')} is missing its contract record")
        if contract_key is None and row.get("status") != "REGRESSION_EVIDENCE_ONLY":
            errors.append(f"{label} {row.get('fixtureId')} has wrong status")
    return errors


def _safe_repo_artifact(record: dict[str, Any]) -> Path:
    path = (REPOSITORY_ROOT / str(record.get("path", ""))).resolve()
    try:
        path.relative_to(REPOSITORY_ROOT.resolve())
    except ValueError as error:
        raise RegionCoreError("artifact path escapes repository") from error
    if not path.is_file():
        raise RegionCoreError(f"missing artifact: {record.get('path')}")
    if path.stat().st_size != record.get("sizeBytes"):
        raise RegionCoreError(f"artifact size mismatch: {record.get('path')}")
    if sha256(path) != record.get("sha256"):
        raise RegionCoreError(f"artifact SHA mismatch: {record.get('path')}")
    return path


def _aggregate_sha(records: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for record in sorted(records, key=lambda value: value["path"]):
        digest.update(record["path"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(record["sha256"].encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def validate_freeze() -> list[str]:
    errors: list[str] = []
    freeze_path = REGION_CORE_ROOT / "freeze.v1.json"
    try:
        freeze = _load_json(freeze_path)
    except (OSError, json.JSONDecodeError, RegionCoreError) as error:
        return [f"cannot read freeze manifest: {error}"]
    errors.extend(_schema_errors(freeze, REGION_CORE_ROOT / "schemas" / "freeze.schema.json"))
    governance = freeze.get("governance", {})
    if governance.get("primaryFrozenProfile") != PRIMARY_FROZEN_PROFILE:
        errors.append("PRIMARY_FROZEN_PROFILE must be cp-b-aggressive_rc-a")
    if governance.get("balancedStatus") != "REGRESSION_EVIDENCE_ONLY":
        errors.append("balanced profile must be REGRESSION_EVIDENCE_ONLY")
    if governance.get("productionIntegrationStatus") != "NOT_INTEGRATED":
        errors.append("Production integration must remain NOT_INTEGRATED")
    rc = governance.get("representativeColor", {})
    if rc != {"RC-A": "FROZEN", "RC-B": "BENCHMARK_ONLY", "RC-C": "BENCHMARK_ONLY", "RC-D": "BENCHMARK_ONLY"}:
        errors.append("representative-color disposition mismatch")
    repair = freeze.get("regionRepairDisposition", {})
    required_repair = {
        "status": "REJECTED_AS_PRODUCTION_APPROACH",
        "usage": "RESEARCH_EVIDENCE_ONLY",
        "productionStatus": "NOT_PRODUCTION",
        "freezeBlockerStatus": "NOT_FREEZE_BLOCKER",
        "frozenInput": False,
    }
    if any(repair.get(key) != value for key, value in required_repair.items()):
        errors.append("Region Repair disposition mismatch")
    if "not a Region Core Freeze blocker" not in repair.get("g02Shadow", ""):
        errors.append("G02_SHADOW disposition is missing or incorrect")
    connectivity = freeze.get("connectivity", {})
    required_connectivity = {"proposalConnectivity": 8, "componentConnectivity": 4, "adjacencyConnectivity": 4, "voidConnectivity": 4}
    if any(connectivity.get(key) != value for key, value in required_connectivity.items()):
        errors.append("frozen connectivity contract mismatch")
    if connectivity.get("oneRegionMayContainMultipleFourConnectedComponents") is not True:
        errors.append("contract must permit multiple 4-connected components per Region ID")
    if freeze.get("legacyMetadataDisposition") != "LEGACY_COMPONENT_METADATA_SUPERSEDED":
        errors.append("legacy component metadata disposition mismatch")

    primary = freeze.get("primaryFrozenContracts")
    balanced = freeze.get("balancedRegressionEvidence")
    errors.extend(matrix_errors(primary, PRIMARY_FROZEN_PROFILE, contract_key="contract"))
    errors.extend(matrix_errors(balanced, BALANCED_REGRESSION_PROFILE, contract_key=None))
    if errors:
        return errors

    discovered = sorted((REGION_CORE_ROOT / "outputs" / "frozen").rglob("region-core.json"))
    if len(discovered) != 8:
        errors.append(f"frozen output tree must contain exactly 8 contracts, found {len(discovered)}")
    primary_input_records: list[dict[str, Any]] = []
    balanced_input_records: list[dict[str, Any]] = []
    for row in primary:
        fixture_id = row["fixtureId"]
        try:
            contract_path = _safe_repo_artifact(row["contract"])
            expected_path = REGION_CORE_ROOT / "outputs" / "frozen" / PRIMARY_FROZEN_PROFILE / fixture_id / "region-core.json"
            if contract_path != expected_path.resolve():
                raise RegionCoreError(f"{fixture_id} contract path is outside the exact primary matrix")
            contract = _load_json(contract_path)
            errors.extend(_schema_errors(contract, REGION_CORE_ROOT / "schemas" / "region_core_frozen_contract.schema.json"))
            assert_no_forbidden_keys(contract)
            rebuilt = build_case_contract(REPOSITORY_ROOT, BENCHMARK_ROOT, PRIMARY_FROZEN_PROFILE, fixture_id)
            if contract != rebuilt:
                raise RegionCoreError(f"{fixture_id} contract differs from immutable-artifact derivation")
            for record in contract["artifacts"].values():
                _safe_repo_artifact(record)
                primary_input_records.append(record)
        except (OSError, json.JSONDecodeError, RegionCoreError) as error:
            errors.append(str(error))
    for row in balanced:
        fixture_id = row["fixtureId"]
        try:
            audit = build_case_contract(
                REPOSITORY_ROOT,
                BENCHMARK_ROOT,
                BALANCED_REGRESSION_PROFILE,
                fixture_id,
                allow_regression_evidence=True,
            )
            if row.get("regionCount") != len(audit["regions"]):
                raise RegionCoreError(f"{fixture_id} balanced Region count mismatch")
            if row.get("componentCount4") != sum(region["componentCount"] for region in audit["regions"]):
                raise RegionCoreError(f"{fixture_id} balanced component count mismatch")
            if row.get("artifacts") != audit["artifacts"]:
                raise RegionCoreError(f"{fixture_id} balanced artifact matrix mismatch")
            for record in row["artifacts"].values():
                _safe_repo_artifact(record)
                balanced_input_records.append(record)
        except (OSError, json.JSONDecodeError, RegionCoreError) as error:
            errors.append(str(error))

    evidence = freeze.get("evidence", {})
    if evidence.get("primaryContractCount") != 8 or evidence.get("balancedEvidenceCount") != 8:
        errors.append("freeze evidence matrix counts must be 8/8")
    if evidence.get("primaryFixtureIds") != list(CASE_IDS) or evidence.get("balancedFixtureIds") != list(CASE_IDS):
        errors.append("freeze evidence fixture IDs must be ordered FLD-001..FLD-008")
    if evidence.get("primaryInputArtifactCount") != len(primary_input_records):
        errors.append("primary input artifact count mismatch")
    if evidence.get("balancedInputArtifactCount") != len(balanced_input_records):
        errors.append("balanced input artifact count mismatch")
    if evidence.get("primaryInputArtifactAggregateSha256") != _aggregate_sha(primary_input_records):
        errors.append("primary input artifact aggregate SHA mismatch")
    if evidence.get("balancedInputArtifactAggregateSha256") != _aggregate_sha(balanced_input_records):
        errors.append("balanced input artifact aggregate SHA mismatch")
    try:
        determinism_path = _safe_repo_artifact(evidence.get("rcADeterminism", {}))
        determinism = _load_json(determinism_path)
        if determinism.get("status") != "PASS" or determinism.get("representativeMethod") != "RC-A" or determinism.get("evaluatedRegionCount", 0) <= 0:
            errors.append("RC-A full determinism evidence is not PASS")
    except (OSError, json.JSONDecodeError, RegionCoreError) as error:
        errors.append(str(error))
    try:
        _safe_repo_artifact(freeze["upstreamBaselines"]["p0_04cFreezeManifest"])
    except (KeyError, RegionCoreError) as error:
        errors.append(f"P0-04C upstream freeze evidence invalid: {error}")
    if not (REGION_CORE_ROOT / "reports" / "REGION_CORE_FREEZE.md").is_file():
        errors.append("missing Region Core freeze report")
    return errors


def main() -> int:
    errors = validate_freeze()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("P0-04B Region Core freeze validates: REGION_CORE_FROZEN (8 primary + 8 regression evidence)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
