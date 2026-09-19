"""Run the isolated CPU background-removal comparison and write review artefacts."""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
import traceback
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

from PIL import Image

from benchmark_lib import (  # noqa: E402
    BENCHMARK_ROOT,
    ProcessRssSampler,
    calculate_metrics,
    canonical_environment_contract_sha256,
    classify_benchmark_status,
    create_adapter,
    final_verdict_for_review,
    installed_runtime_versions,
    load_config,
    load_acceptance_environment,
    load_manifest,
    model_run_status,
    model_artifact_record,
    performance_record,
    runtime_environment_validation,
    run_timed,
    sha256_file,
)


ACCEPTANCE_DATASET_PATH = BENCHMARK_ROOT / "acceptance-dataset.json"
SYNTHETIC_DEBUG = "SYNTHETIC_DEBUG"
PROJECT_REAL_ACCEPTANCE = "PROJECT_REAL_ACCEPTANCE"
VALID_DATASET_ROLES = {SYNTHETIC_DEBUG, PROJECT_REAL_ACCEPTANCE}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--case", help="run one case for plumbing/debugging")
    scope.add_argument("--all-cases", action="store_true", help="run the complete reviewed dataset")
    parser.add_argument("--models", nargs="+", default=["all"], help="model IDs or 'all'")
    parser.add_argument("--allow-model-download", action="store_true", help="debug-only: permit model preparation/download; rejected with --all-cases")
    return parser.parse_args()


def validate_run_mode(args: argparse.Namespace) -> None:
    if args.all_cases and args.allow_model_download:
        raise ValueError("--allow-model-download is prepare/debug-only and is forbidden for --all-cases acceptance runs")


def validate_formal_model_selection(args: argparse.Namespace, selected_models: list[str], config: dict[str, Any]) -> None:
    """Formal acceptance always evaluates the frozen configuration's complete model set."""
    if args.all_cases and selected_models != config.get("modelOrder"):
        raise ValueError("--all-cases acceptance requires the complete benchmark-config.json modelOrder")


def find_source(case_dir: Path) -> Path:
    candidates = [case_dir / "source.png", case_dir / "source.jpg", case_dir / "source.jpeg"]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"missing source image in {case_dir}")


def _verify_decodable(path: Path, *, label: str) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image.load()
            return image.size
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"{label} cannot be decoded: {path.name}") from exc


def validate_case(case_dir: Path) -> tuple[dict[str, Any], Path, Path, Path]:
    metadata_path = case_dir / "case.json"
    ground_truth = case_dir / "ground_truth.png"
    if not metadata_path.is_file():
        raise ValueError(f"{case_dir.name}: missing case.json")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{case_dir.name}: case.json is invalid JSON") from exc
    case_id = metadata.get("caseId")
    if not isinstance(case_id, str) or not case_id:
        raise ValueError(f"{case_dir.name}: caseId is required")
    if case_id != case_dir.name:
        raise ValueError(f"{case_dir.name}: caseId must match directory name (got {case_id})")
    for field in ("category", "description", "sourceLineageId"):
        if not isinstance(metadata.get(field), str) or not metadata[field].strip():
            raise ValueError(f"{case_id}: {field} is required")
    if metadata.get("datasetRole") not in VALID_DATASET_ROLES:
        raise ValueError(f"{case_id}: datasetRole must be one of {sorted(VALID_DATASET_ROLES)}")
    critical = metadata.get("criticalStructures")
    if not isinstance(critical, list) or not critical or not all(isinstance(item, str) and item.strip() for item in critical):
        raise ValueError(f"{case_id}: criticalStructures must be a non-empty string list")
    source = find_source(case_dir)
    if not ground_truth.is_file():
        raise ValueError(f"{case_id}: missing ground_truth.png")
    source_size = _verify_decodable(source, label=f"{case_id} source")
    ground_truth_size = _verify_decodable(ground_truth, label=f"{case_id} ground truth")
    if source_size != ground_truth_size:
        raise ValueError(f"{case_id}: source and ground truth dimensions differ: {source_size} != {ground_truth_size}")
    with Image.open(ground_truth) as gt_image:
        gt_image.load()
        values = set(gt_image.convert("L").get_flattened_data())
    if values - {0, 255}:
        raise ValueError(f"{case_id}: ground_truth.png must be strictly binary {{0,255}}")
    return metadata, source, ground_truth, case_dir


def _case_snapshot(metadata: dict[str, Any], source: Path, ground_truth: Path, case_dir: Path, manifest_case: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "caseId": metadata["caseId"],
        "sourceFile": source.name,
        "sourceSha256": sha256_file(source),
        "groundTruthSha256": sha256_file(ground_truth),
        "caseMetadataSha256": sha256_file(case_dir / "case.json"),
        "sourceLineageId": metadata["sourceLineageId"],
        "datasetRole": metadata["datasetRole"],
        "coverageTags": list((manifest_case or {}).get("coverageTags", [])),
        "groundTruthReview": (manifest_case or {}).get("groundTruthReview"),
    }


def _excluded_debug_case_ids() -> list[str]:
    excluded: list[str] = []
    for case_dir in sorted((BENCHMARK_ROOT / "cases").glob("BR-*")):
        try:
            metadata = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if metadata.get("datasetRole") == SYNTHETIC_DEBUG and isinstance(metadata.get("caseId"), str):
            excluded.append(metadata["caseId"])
    return excluded


def _load_acceptance_manifest() -> tuple[dict[str, Any], str]:
    if not ACCEPTANCE_DATASET_PATH.is_file():
        raise ValueError("formal acceptance requires acceptance-dataset.json")
    try:
        manifest = json.loads(ACCEPTANCE_DATASET_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("acceptance-dataset.json is invalid JSON") from exc
    if manifest.get("schemaVersion") != "background-removal.acceptance-dataset/1":
        raise ValueError("acceptance dataset manifest schemaVersion is invalid")
    if manifest.get("requiredProjectRealReviewedCaseCount") != 15:
        raise ValueError("acceptance dataset manifest must require exactly 15 project-real reviewed cases")
    if not isinstance(manifest.get("cases"), list):
        raise ValueError("acceptance dataset manifest cases must be an array")
    return manifest, sha256_file(ACCEPTANCE_DATASET_PATH)


def load_acceptance_cases() -> tuple[list[tuple[dict[str, Any], Path, Path, Path]], dict[str, Any], dict[str, Any]]:
    """Select only manifest-approved project-real cases; never scan directories as acceptance data."""
    manifest, manifest_sha256 = _load_acceptance_manifest()
    records: list[tuple[dict[str, Any], Path, Path, Path]] = []
    snapshots: list[dict[str, Any]] = []
    case_ids: set[str] = set()
    lineages: set[str] = set()
    for index, entry in enumerate(manifest["cases"]):
        if not isinstance(entry, dict):
            raise ValueError(f"acceptance manifest case {index} must be an object")
        required = ("caseId", "datasetRole", "sourceLineageId", "sourceFile", "sourceSha256", "groundTruthSha256", "caseMetadataSha256", "coverageTags", "groundTruthReview")
        if any(not entry.get(field) for field in required):
            raise ValueError(f"acceptance manifest case {index} is incomplete")
        case_id = entry["caseId"]
        lineage = entry["sourceLineageId"]
        if not isinstance(case_id, str) or not isinstance(lineage, str) or not case_id or not lineage:
            raise ValueError(f"acceptance manifest case {index} has invalid caseId or sourceLineageId")
        if case_id in case_ids:
            raise ValueError(f"duplicate acceptance manifest caseId: {case_id}")
        if lineage in lineages:
            raise ValueError(f"duplicate acceptance manifest sourceLineageId: {lineage}")
        case_ids.add(case_id); lineages.add(lineage)
        if entry["datasetRole"] != PROJECT_REAL_ACCEPTANCE:
            raise ValueError(f"{case_id}: formal manifest may contain only {PROJECT_REAL_ACCEPTANCE}")
        review = entry["groundTruthReview"]
        if not isinstance(review, dict) or review.get("state") != "APPROVED" or review.get("signoff") != "SIGNED_OFF" or review.get("reviewerRole") != "PROJECT_DATASET_REVIEWER":
            raise ValueError(f"{case_id}: ground truth review is not approved and signed off")
        tags = entry["coverageTags"]
        if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) and tag.strip() for tag in tags):
            raise ValueError(f"{case_id}: coverageTags must be a non-empty string array")
        case_dir = BENCHMARK_ROOT / "cases" / case_id
        metadata, source, ground_truth, validated_dir = validate_case(case_dir)
        if entry["sourceFile"] != source.name or Path(entry["sourceFile"]).name != entry["sourceFile"]:
            raise ValueError(f"{case_id}: manifest sourceFile does not match case source")
        if metadata["caseId"] != case_id or metadata["datasetRole"] != entry["datasetRole"] or metadata["sourceLineageId"] != lineage:
            raise ValueError(f"{case_id}: manifest and case.json identity fields differ")
        identity = _case_snapshot(metadata, source, ground_truth, validated_dir, entry)
        for field in ("sourceSha256", "groundTruthSha256", "caseMetadataSha256"):
            if identity[field].lower() != str(entry[field]).lower():
                raise ValueError(f"{case_id}: {field} does not match manifest")
        records.append((metadata, source, ground_truth, validated_dir))
        snapshots.append(identity)
    required_count = manifest["requiredProjectRealReviewedCaseCount"]
    validation = {
        "valid": len(records) >= required_count,
        "manifestSchemaVersion": manifest["schemaVersion"],
        "manifestSha256": manifest_sha256,
        "requiredProjectRealReviewedCaseCount": required_count,
        "projectRealReviewedCaseCount": len(records),
        "selectedCaseIds": [record[0]["caseId"] for record in records],
        "excludedDebugCaseIds": _excluded_debug_case_ids(),
        "sourceLineageCount": len(lineages),
        "completeCaseCount": len(records),
        "requiredCaseCount": required_count,
    }
    snapshot = {
        "acceptanceDatasetManifestSha256": manifest_sha256,
        "requiredProjectRealReviewedCaseCount": required_count,
        "selectedCaseIds": validation["selectedCaseIds"],
        "cases": snapshots,
    }
    return records, validation, snapshot


def load_cases(args: argparse.Namespace, config: dict[str, Any]) -> tuple[list[tuple[dict[str, Any], Path, Path, Path]], dict[str, Any], dict[str, Any]]:
    if args.all_cases:
        records, validation, snapshot = load_acceptance_cases()
        if not validation["valid"]:
            raise ValueError(f"acceptance benchmark requires {validation['requiredProjectRealReviewedCaseCount']} approved project-real reviewed cases; found {validation['projectRealReviewedCaseCount']}. Use --case only for plumbing/debugging, not acceptance.")
        return records, validation, snapshot
    case_dir = BENCHMARK_ROOT / "cases" / str(args.case)
    if not case_dir.is_dir():
        raise ValueError(f"case {args.case} does not have source.png/source.jpg/source.jpeg, ground_truth.png and case.json")
    record = validate_case(case_dir)
    metadata, source, ground_truth, validated_dir = record
    snapshot_case = _case_snapshot(metadata, source, ground_truth, validated_dir)
    validation = {
        "valid": False,
        "manifestSchemaVersion": None,
        "manifestSha256": None,
        "requiredProjectRealReviewedCaseCount": 15,
        "projectRealReviewedCaseCount": 0,
        "selectedCaseIds": [metadata["caseId"]],
        "excludedDebugCaseIds": [],
        "sourceLineageCount": 1,
        "completeCaseCount": 1,
        "requiredCaseCount": int(config["requiredCaseCount"]),
    }
    return [record], validation, {
        "acceptanceDatasetManifestSha256": None,
        "requiredProjectRealReviewedCaseCount": 15,
        "selectedCaseIds": [metadata["caseId"]],
        "cases": [snapshot_case],
    }


def host_info() -> dict[str, Any]:
    return {
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "processor": platform.processor() or None,
        "cpuOnly": True,
        "cudaVisibleDevices": os.environ.get("CUDA_VISIBLE_DEVICES", ""),
    }


def initial_result(config: dict[str, Any], selected_models: list[str], args: argparse.Namespace, cases: list[tuple[dict[str, Any], Path, Path, Path]], manifest: dict[str, dict[str, Any]], dataset_validation: dict[str, Any] | None = None, dataset_snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime_versions = installed_runtime_versions()
    environment_contract = load_acceptance_environment()
    environment_contract_sha256 = canonical_environment_contract_sha256(environment_contract)
    if dataset_validation is None:
        dataset_validation = {
            "valid": False, "manifestSchemaVersion": None, "manifestSha256": None,
            "requiredProjectRealReviewedCaseCount": 15, "projectRealReviewedCaseCount": 0,
            "selectedCaseIds": [metadata["caseId"] for metadata, _source, _ground_truth, _case_dir in cases],
            "excludedDebugCaseIds": [], "sourceLineageCount": len(cases),
            "completeCaseCount": len(cases), "requiredCaseCount": int(config["requiredCaseCount"]),
        }
    if dataset_snapshot is None:
        dataset_snapshot = {
            "acceptanceDatasetManifestSha256": None,
            "requiredProjectRealReviewedCaseCount": 15,
            "selectedCaseIds": dataset_validation["selectedCaseIds"],
            "cases": [_case_snapshot(metadata, source, ground_truth, case_dir) for metadata, source, ground_truth, case_dir in cases],
        }
    return {
        "schemaVersion": 1,
        "runId": uuid.uuid4().hex,
        "status": "RUNNING",
        "generatedAt": datetime.now(UTC).isoformat(),
        "configuration": config,
        "scope": "all-cases" if args.all_cases else f"case:{args.case}",
        "host": host_info(),
        "selectedModels": selected_models,
        "caseIds": [metadata["caseId"] for metadata, _source, _ground_truth, _case_dir in cases],
        "caseSources": {metadata["caseId"]: source.name for metadata, source, _ground_truth, _case_dir in cases},
        "datasetValidation": dataset_validation,
        "datasetSnapshot": dataset_snapshot,
        "reproducibility": {
            "runtimeVersions": runtime_versions,
            "environmentContract": environment_contract,
            "environmentContractSha256": environment_contract_sha256,
            "environmentValidation": runtime_environment_validation(runtime_versions, environment_contract),
            "modelArtifacts": {
                model_id: {"source": manifest[model_id].get("source"), **model_artifact_record(model_id, manifest[model_id])}
                for model_id in selected_models
            },
        },
        "models": {model_id: {"status": "NOT_RUN", "initializeStatus": "NOT_RUN"} for model_id in selected_models},
        "caseResults": [],
        "notes": [
            "Model comparison results are valid only after human review fields are completed.",
            "processPeakRssMb is sampled at high frequency for this process during initialization and inference; it is not system-wide RAM.",
            "ACCEPTANCE_COMPLETE requires frozen dataset/environment identities, exact Python/package versions, reviewed results, exact model revisions, model SHA-256 values, and verified weight licences.",
        ],
    }


def write_results(result: dict[str, Any]) -> None:
    for row in result["caseResults"]:
        review = row.get("manualReview")
        if review is not None:
            review["finalVerdict"] = final_verdict_for_review(review)
    result["status"] = classify_benchmark_status(result)
    results_dir = BENCHMARK_ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "benchmark-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_summary(result)
    write_comparison_html(result)


def write_run_result(result: dict[str, Any]) -> None:
    """Persist raw execution only. Reviews and final reports are finalized separately."""
    result["status"] = classify_benchmark_status(result)
    results_dir = BENCHMARK_ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "benchmark-run.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def mean_or_none(values: list[float | None]) -> float | None:
    observed = [value for value in values if value is not None]
    return sum(observed) / len(observed) if observed else None


def markdown_value(value: float | int | None) -> str:
    if value is None:
        return "—"
    return f"{value:.4f}" if isinstance(value, float) else str(value)


def write_summary(result: dict[str, Any]) -> None:
    lines = ["# Background-removal benchmark summary", "", f"Status: **{result['status']}**", ""]
    if result["status"] != "ACCEPTANCE_COMPLETE":
        lines.extend(["No model selection conclusion is available from this file.", ""])
    lines.extend([
        "## Per-model aggregate", "",
        "| Model | Cases | subjectRetention mean | backgroundClearRate mean | internalHoleRate mean | IoU mean | Hard fails | Initialize ms | First inference ms | Warm median ms | P95 ms | Process peak RSS MB | Model bytes |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for model_id, model in result["models"].items():
        rows = [row for row in result["caseResults"] if row["modelId"] == model_id and row["status"] == "SUCCESS"]
        metric = lambda key: mean_or_none([row["metrics"].get(key) for row in rows])
        perf = lambda key: mean_or_none([row["performance"].get(key) for row in rows])
        hard_fails = sum((row.get("manualReview") or {}).get("finalVerdict") == "FAIL" for row in rows)
        model_bytes = model.get("modelSizeBytes")
        lines.append("| " + " | ".join([
            model_id, str(len(rows)), markdown_value(metric("subjectRetention")), markdown_value(metric("backgroundClearRate")),
            markdown_value(metric("internalHoleRate")), markdown_value(metric("foregroundIoU")), str(hard_fails),
            markdown_value(perf("initializeMs")), markdown_value(perf("firstInferenceMs")), markdown_value(perf("warmInferenceMedianMs")),
            markdown_value(perf("warmInferenceP95Ms")), markdown_value(model.get("processPeakRssMb")), markdown_value(model_bytes),
        ]) + " |")
    lines.extend(["", "## Per-case matrix", "", "| Case | Model | Status | Retention | Clear rate | Internal hole | IoU | Boundary | Critical structure |", "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |"])
    for row in result["caseResults"]:
        review = row.get("manualReview") or {}
        metrics = row.get("metrics", {})
        lines.append("| " + " | ".join([
            row["caseId"], row["modelId"], row["status"], markdown_value(metrics.get("subjectRetention")),
            markdown_value(metrics.get("backgroundClearRate")), markdown_value(metrics.get("internalHoleRate")),
            markdown_value(metrics.get("foregroundIoU")), str(review.get("boundaryQuality") or "UNREVIEWED"),
            str(review.get("criticalStructure") or "UNREVIEWED"),
        ]) + " |")
    lines.extend(["", "## Notes", ""] + [f"- {note}" for note in result["notes"]])
    (BENCHMARK_ROOT / "results" / "benchmark-summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_comparison_html(result: dict[str, Any]) -> None:
    manifest = load_manifest()
    model_order = result["configuration"]["modelOrder"]
    all_cases = sorted({row["caseId"] for row in result["caseResults"]})
    rows: list[str] = []
    for case_id in all_cases:
        source_filename = source_filename_for_case(result, case_id)
        cells = [
            f'<figure><img src="../cases/{case_id}/{source_filename}"><figcaption>Source</figcaption></figure>',
            f'<figure><img src="../cases/{case_id}/ground_truth.png"><figcaption>Ground Truth</figcaption></figure>',
        ]
        for model_id in model_order:
            label = manifest[model_id]["displayName"]
            row = next((item for item in result["caseResults"] if item.get("caseId") == case_id and item.get("modelId") == model_id), None)
            output = verified_output_path(row)
            if output is not None:
                cells.append(f'<figure><img src="../{output.as_posix()}"><figcaption>{label}</figcaption></figure>')
            else:
                status = row.get("status", "NOT RUN") if row else "NOT RUN"
                cells.append(f'<figure class="missing"><figcaption>{label}<br>{status}</figcaption></figure>')
        rows.append(f"<h2>{case_id}</h2><section>{''.join(cells)}</section>")
    html = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Background-removal comparison</title>
<style>body{font-family:system-ui;margin:24px;background:#f6f7f8;color:#18212b}section{display:grid;grid-template-columns:repeat(6,minmax(145px,1fr));gap:12px}figure{margin:0;background:white;padding:8px;border:1px solid #d6dbe0}img{width:100%;aspect-ratio:1;object-fit:contain;background-color:#fff;background-image:conic-gradient(#e5e7eb 25%,#fff 0 50%,#e5e7eb 0 75%,#fff 0);background-size:16px 16px}figcaption{font-size:13px;margin-top:6px}.missing{display:grid;place-items:center;min-height:150px;color:#6c7885;text-align:center}@media(max-width:900px){section{grid-template-columns:repeat(2,minmax(145px,1fr))}}</style>
</head><body><h1>Background-removal visual comparison</h1><p>Inspect deleted subject areas, interior holes, retained background, edges and critical structures. Panels without a generated PNG are explicitly NOT RUN.</p>""" + "".join(rows) + "</body></html>"
    (BENCHMARK_ROOT / "results" / "comparison.html").write_text(html, encoding="utf-8")


def source_filename_for_case(result: dict[str, Any], case_id: str) -> str:
    configured = result.get("caseSources", {}).get(case_id)
    if configured:
        return configured
    return find_source(BENCHMARK_ROOT / "cases" / case_id).name


def verified_output_path(row: dict[str, Any] | None) -> Path | None:
    if not row or row.get("status") != "SUCCESS":
        return None
    stored_path = row.get("outputPath")
    stored_sha256 = row.get("outputSha256")
    if not isinstance(stored_path, str) or not stored_sha256:
        return None
    candidate = (BENCHMARK_ROOT / stored_path).resolve()
    try:
        relative_path = candidate.relative_to(BENCHMARK_ROOT.resolve())
    except ValueError:
        return None
    if not candidate.is_file() or sha256_file(candidate).lower() != str(stored_sha256).lower():
        return None
    return relative_path


def main() -> int:
    args = parse_args()
    config = load_config()
    manifest = load_manifest()
    validate_run_mode(args)
    selected_models = config["modelOrder"] if args.models == ["all"] else args.models
    validate_formal_model_selection(args, selected_models, config)
    unknown = [model for model in selected_models if model not in manifest]
    if unknown:
        raise ValueError(f"unknown models: {', '.join(unknown)}")
    cases, dataset_validation, dataset_snapshot = load_cases(args, config)
    result = initial_result(config, selected_models, args, cases, manifest, dataset_validation, dataset_snapshot)
    adapters = {model_id: create_adapter(model_id, allow_model_download=args.allow_model_download) for model_id in selected_models}
    availability = {model_id: adapter.availability() for model_id, adapter in adapters.items()}

    # Formal acceptance must prove every artifact is locally present and
    # verified before *any* timed model initialization or inference begins.
    if args.all_cases and not all(check.available for check in availability.values()):
        for model_id in selected_models:
            check = availability[model_id]
            reason = check.reason or "formal acceptance preflight failed"
            result["models"][model_id] = {"status": "NOT_RUN", "initializeStatus": "NOT_RUN", "reason": reason, "metadata": manifest[model_id], "artifact": model_artifact_record(model_id, manifest[model_id])}
            for metadata, _source_path, _gt_path, _case_dir in cases:
                result["caseResults"].append({"caseId": metadata["caseId"], "modelId": model_id, "status": "NOT_RUN", "reason": reason})
        write_run_result(result)
        return 0

    for model_id in selected_models:
        adapter = adapters[model_id]
        check = availability[model_id]
        if not check.available:
            result["models"][model_id] = {"status": "NOT_RUN", "initializeStatus": "NOT_RUN", "reason": check.reason, "metadata": manifest[model_id], "artifact": model_artifact_record(model_id, manifest[model_id])}
            for metadata, _source_path, _gt_path, _case_dir in cases:
                result["caseResults"].append({"caseId": metadata["caseId"], "modelId": model_id, "status": "NOT_RUN", "reason": check.reason})
            continue
        rss_sampler = ProcessRssSampler(int(config.get("rssSampleIntervalMs", 10)))
        rss_sampler.start()
        try:
            initialize_started = time.perf_counter()
            adapter.initialize()
            initialize_ms = (time.perf_counter() - initialize_started) * 1000
            result["models"][model_id] = {"status": "INITIALIZED", "initializeStatus": "SUCCESS", "metadata": manifest[model_id], "modelSizeBytes": adapter.model_size_bytes, "initializeMs": initialize_ms, "artifact": model_artifact_record(model_id, manifest[model_id])}
        except Exception as exc:  # noqa: BLE001
            rss_sampler.stop()
            reason = f"adapter initialization failed: {type(exc).__name__}: {exc}"
            result["models"][model_id] = {"status": "FAILED", "initializeStatus": "ERROR", "reason": reason, "metadata": manifest[model_id], "artifact": model_artifact_record(model_id, manifest[model_id])}
            for metadata, _source_path, _gt_path, _case_dir in cases:
                result["caseResults"].append({"caseId": metadata["caseId"], "modelId": model_id, "status": "ERROR", "reason": reason})
            continue
        for metadata, source_path, gt_path, _case_dir in cases:
            try:
                with Image.open(source_path) as source_file, Image.open(gt_path) as gt_file:
                    source = source_file.convert("RGBA")
                    ground_truth = gt_file.convert("L")
                    output, first_inference_ms, warm_ms = run_timed(adapter, source, int(config["warmRuns"]))
                output_dir = BENCHMARK_ROOT / "outputs" / model_id
                output_dir.mkdir(parents=True, exist_ok=True)
                output_path = output_dir / f"{metadata['caseId']}.png"
                output.save(output_path)
                result["caseResults"].append({
                    "caseId": metadata["caseId"],
                    "modelId": model_id,
                    "status": "SUCCESS",
                    "metrics": calculate_metrics(output, ground_truth, config),
                    "performance": performance_record(initialize_ms, first_inference_ms, warm_ms, model_size_bytes=adapter.model_size_bytes, output=output),
                    "outputPath": str(output_path.relative_to(BENCHMARK_ROOT)),
                    "outputSha256": sha256_file(output_path),
                })
            except Exception as exc:  # noqa: BLE001
                result["caseResults"].append({"caseId": metadata["caseId"], "modelId": model_id, "status": "ERROR", "reason": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc(limit=3)})
        rss_sampler.stop()
        model_rows = [row for row in result["caseResults"] if row["modelId"] == model_id]
        result["models"][model_id]["status"] = model_run_status(model_rows, len(cases))
        result["models"][model_id]["processPeakRssMb"] = rss_sampler.peak_rss_mb
        result["models"][model_id]["artifact"] = model_artifact_record(model_id, manifest[model_id])
    write_run_result(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
