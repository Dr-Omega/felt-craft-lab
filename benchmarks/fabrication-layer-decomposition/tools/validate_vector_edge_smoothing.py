#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
POC_ROOT = BENCHMARK_ROOT / "vector-edge-smoothing"
sys.path.insert(0, str(POC_ROOT / "src"))

from boundary_graph import build_boundary_graph, rasterize_paths
from tolerance_review import FOCUS_CASES, STATUS as TOLERANCE_REVIEW_STATUS, integrity_snapshot
from vector_contract import sha256


def validate() -> list[str]:
    errors: list[str] = []
    manifest = json.loads((POC_ROOT / "manifest.v1.json").read_text(encoding="utf-8"))
    config = json.loads((POC_ROOT / "configs" / "poc.v1.json").read_text(encoding="utf-8"))
    summary_path = POC_ROOT / "reports" / "summary.json"
    if not summary_path.is_file():
        return ["missing reports/summary.json"]
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if summary.get("status") != "POC_EVIDENCE_COMPLETE_PENDING_EXTERNAL_VECTOR_REVIEW":
        errors.append(f"unexpected status: {summary.get('status')}")
    if summary.get("caseProfileCount") != 16 or summary.get("v0ByteIdenticalCount") != 16:
        errors.append("V0 8 fixtures × 2 profiles is incomplete")
    artifact_records = {(item["profile"], item["caseId"]): item for item in manifest.get("inputArtifacts", [])}
    for profile in manifest["profiles"]:
        for case_id in manifest["fixtures"]:
            source = np.asarray(Image.open(BENCHMARK_ROOT / "fixtures" / "source" / f"{case_id}.png").convert("RGBA"))
            case_root = BENCHMARK_ROOT / "outputs" / "color-purification" / profile / case_id
            label_path = case_root / "structural_label_map.npz"
            artifact = artifact_records.get((profile, case_id))
            if artifact is None or artifact.get("sha256") != sha256(label_path):
                errors.append(f"frozen manifest input SHA mismatch: {profile}/{case_id}")
            labels = np.load(label_path)["labels"]
            graph = build_boundary_graph(labels, source[..., 3])
            if not np.array_equal(rasterize_paths(graph), labels):
                errors.append(f"V0 mismatch: {profile}/{case_id}")
            result_root = POC_ROOT / "outputs" / profile / case_id
            audit_path = result_root / "input-audit.json"
            if not audit_path.is_file():
                errors.append(f"missing input audit: {profile}/{case_id}")
                continue
            audit = json.loads(audit_path.read_text(encoding="utf-8"))
            if audit.get("structuralLabelMapSha256") != sha256(label_path):
                errors.append(f"input SHA mismatch: {profile}/{case_id}")
            if audit.get("alphaAudit", {}).get("status") != "MATCH":
                errors.append(f"alpha topology audit failed: {profile}/{case_id}")
            expected = [result_root / "V0" / "result.json"]
            for tolerance in config["evidenceTolerancesPx"]:
                suffix = str(float(tolerance)).replace(".", "p")
                expected.extend((result_root / "V1" / f"tol-{suffix}" / "result.json", result_root / "V2" / f"tol-{suffix}" / "result.json"))
            for result_path in expected:
                if not result_path.is_file():
                    errors.append(f"missing result: {result_path.relative_to(POC_ROOT)}")
                    continue
                result = json.loads(result_path.read_text(encoding="utf-8"))
                if not result.get("hardGate", {}).get("pass"):
                    errors.append(f"hard gate failed: {result_path.relative_to(POC_ROOT)}")
                complexity = result.get("metrics", {}).get("complexity", {})
                safety = result.get("metrics", {}).get("safety", {})
                if "outputVertexCount" not in complexity:
                    errors.append(f"missing output vertex metric: {result_path.relative_to(POC_ROOT)}")
                if "selfIntersectionCount" not in safety or "interEdgeIllegalIntersectionCount" not in safety:
                    errors.append(f"missing split intersection metrics: {result_path.relative_to(POC_ROOT)}")
            if case_id == "FLD-007":
                v0 = json.loads((result_root / "V0" / "result.json").read_text(encoding="utf-8"))
                if v0["metrics"]["topology"]["holeCount"] != 29:
                    errors.append(f"FLD-007 must retain 29 structural holes: {profile}")
    for case_id in ("FLD-001", "FLD-002", "FLD-004", "FLD-005", "FLD-006", "FLD-007", "FLD-008"):
        if not (POC_ROOT / "reports" / "contact-sheets" / f"{case_id}.png").is_file():
            errors.append(f"missing contact sheet: {case_id}")
    tolerance_metrics_path = POC_ROOT / "reports" / "V2_TOLERANCE_METRICS.json"
    tolerance_report_path = POC_ROOT / "reports" / "V2_TOLERANCE_REVIEW.md"
    if not tolerance_metrics_path.is_file() or not tolerance_report_path.is_file():
        errors.append("missing V2 tolerance review report")
    else:
        tolerance_metrics = json.loads(tolerance_metrics_path.read_text(encoding="utf-8"))
        if tolerance_metrics.get("status") != TOLERANCE_REVIEW_STATUS:
            errors.append("unexpected V2 tolerance review status")
        if tolerance_metrics.get("integrity", {}).get("unchanged") is not True:
            errors.append("V2 tolerance review integrity audit did not pass")
        if tolerance_metrics.get("integrity", {}).get("after") != integrity_snapshot(BENCHMARK_ROOT, POC_ROOT):
            errors.append("geometry/input artifacts changed after V2 tolerance review")
        hole = tolerance_metrics.get("holeReview", {})
        if hole.get("holeCount") != 29 or hole.get("allRetained") is not True or len(hole.get("correspondence", [])) != 29:
            errors.append("FLD-007 visual correspondence is not 29/29")
        for case_id in FOCUS_CASES:
            if not (POC_ROOT / "reports" / "tolerance-contact-sheets" / f"{case_id}.png").is_file():
                errors.append(f"missing V2 tolerance contact sheet: {case_id}")
        if not (POC_ROOT / "reports" / "FLD-007_HOLE_REVIEW.png").is_file():
            errors.append("missing FLD-007 dedicated hole review")
        report_text = tolerance_report_path.read_text(encoding="utf-8").upper()
        for forbidden in ("BEST", "WINNER", "PRODUCTION", "RECOMMENDED_TOLERANCE"):
            if forbidden in report_text:
                errors.append(f"decision language leaked into V2 evidence: {forbidden}")
    return errors


def main() -> int:
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("P0-04C vector edge smoothing evidence validates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
