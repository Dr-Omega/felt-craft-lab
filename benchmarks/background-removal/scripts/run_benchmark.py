"""Run the isolated CPU background-removal comparison and write review artefacts."""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

from PIL import Image

from benchmark_lib import (  # noqa: E402
    BENCHMARK_ROOT,
    ProcessRssSampler,
    calculate_metrics,
    classify_benchmark_status,
    create_adapter,
    final_verdict_for_review,
    installed_runtime_versions,
    load_config,
    load_manifest,
    model_run_status,
    performance_record,
    run_timed,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--case", help="run one case for plumbing/debugging")
    scope.add_argument("--all-cases", action="store_true", help="run the complete reviewed dataset")
    parser.add_argument("--models", nargs="+", default=["all"], help="model IDs or 'all'")
    parser.add_argument("--allow-model-download", action="store_true", help="allow optional rembg adapter to fetch weights into benchmark-only cache")
    return parser.parse_args()


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


def load_cases(args: argparse.Namespace, config: dict[str, Any]) -> list[tuple[dict[str, Any], Path, Path, Path]]:
    cases_root = BENCHMARK_ROOT / "cases"
    dirs = sorted(path for path in cases_root.glob("BR-*") if path.is_dir())
    records: list[tuple[dict[str, Any], Path, Path, Path]] = []
    seen_case_ids: set[str] = set()
    for case_dir in dirs:
        record = validate_case(case_dir)
        metadata = record[0]
        if metadata["caseId"] in seen_case_ids:
            raise ValueError(f"duplicate caseId: {metadata['caseId']}")
        seen_case_ids.add(metadata["caseId"])
        if args.case and metadata.get("caseId") != args.case:
            continue
        records.append(record)
    if args.case and not records:
        raise ValueError(f"case {args.case} does not have source.png/source.jpg/source.jpeg, ground_truth.png and case.json")
    if args.all_cases and len(records) < int(config["requiredCaseCount"]):
        raise ValueError(
            f"acceptance benchmark requires {config['requiredCaseCount']} complete cases; found {len(records)}. "
            "Use --case only for plumbing/debugging, not acceptance."
        )
    return records


def host_info() -> dict[str, Any]:
    return {
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "processor": platform.processor() or None,
        "cpuOnly": True,
        "cudaVisibleDevices": os.environ.get("CUDA_VISIBLE_DEVICES", ""),
    }


def initial_result(config: dict[str, Any], selected_models: list[str], args: argparse.Namespace, cases: list[tuple[dict[str, Any], Path, Path, Path]], manifest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "status": "RUNNING",
        "generatedAt": datetime.now(UTC).isoformat(),
        "configuration": config,
        "scope": "all-cases" if args.all_cases else f"case:{args.case}",
        "host": host_info(),
        "selectedModels": selected_models,
        "caseIds": [metadata["caseId"] for metadata, _source, _ground_truth, _case_dir in cases],
        "caseSources": {metadata["caseId"]: source.name for metadata, source, _ground_truth, _case_dir in cases},
        "datasetValidation": {
            "valid": args.all_cases and len(cases) >= int(config["requiredCaseCount"]),
            "completeCaseCount": len(cases),
            "requiredCaseCount": int(config["requiredCaseCount"]),
        },
        "reproducibility": {
            "runtimeVersions": installed_runtime_versions(),
            "modelArtifacts": {
                model_id: {
                    "source": manifest[model_id].get("source"),
                    "exactModelRevision": manifest[model_id].get("exactModelRevision"),
                    "modelSha256": manifest[model_id].get("modelSha256"),
                    "weightLicenseVerificationStatus": manifest[model_id].get("weightLicenseVerificationStatus"),
                }
                for model_id in selected_models
            },
        },
        "models": {model_id: {"status": "NOT_RUN", "initializeStatus": "NOT_RUN"} for model_id in selected_models},
        "caseResults": [],
        "notes": [
            "Model comparison results are valid only after human review fields are completed.",
            "processPeakRssMb is sampled at high frequency for this process during initialization and inference; it is not system-wide RAM.",
            "ACCEPTANCE_COMPLETE requires reviewed results plus installed runtime versions, exact model revisions, model SHA-256 values, and verified weight licences.",
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
        hard_fails = sum(row.get("manualReview", {}).get("finalVerdict") == "FAIL" for row in rows)
        model_bytes = model.get("modelSizeBytes")
        lines.append("| " + " | ".join([
            model_id, str(len(rows)), markdown_value(metric("subjectRetention")), markdown_value(metric("backgroundClearRate")),
            markdown_value(metric("internalHoleRate")), markdown_value(metric("foregroundIoU")), str(hard_fails),
            markdown_value(perf("initializeMs")), markdown_value(perf("firstInferenceMs")), markdown_value(perf("warmInferenceMedianMs")),
            markdown_value(perf("warmInferenceP95Ms")), markdown_value(perf("processPeakRssMb")), markdown_value(model_bytes),
        ]) + " |")
    lines.extend(["", "## Per-case matrix", "", "| Case | Model | Status | Retention | Clear rate | Internal hole | IoU | Boundary | Critical structure |", "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |"])
    for row in result["caseResults"]:
        review = row.get("manualReview", {})
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
            output = BENCHMARK_ROOT / "outputs" / model_id / f"{case_id}.png"
            label = manifest[model_id]["displayName"]
            if output.is_file():
                cells.append(f'<figure><img src="../outputs/{model_id}/{case_id}.png"><figcaption>{label}</figcaption></figure>')
            else:
                cells.append(f'<figure class="missing"><figcaption>{label}<br>NOT RUN</figcaption></figure>')
        rows.append(f"<h2>{case_id}</h2><section>{''.join(cells)}</section>")
    html = """<!doctype html><html><head><meta charset=\"utf-8\"><title>Background-removal comparison</title>
<style>body{font-family:system-ui;margin:24px;background:#f6f7f8;color:#18212b}section{display:grid;grid-template-columns:repeat(6,minmax(145px,1fr));gap:12px}figure{margin:0;background:white;padding:8px;border:1px solid #d6dbe0}img{width:100%;aspect-ratio:1;object-fit:contain;background:checkerboard}figcaption{font-size:13px;margin-top:6px}.missing{display:grid;place-items:center;min-height:150px;color:#6c7885;text-align:center}@media(max-width:900px){section{grid-template-columns:repeat(2,minmax(145px,1fr))}}</style>
</head><body><h1>Background-removal visual comparison</h1><p>Inspect deleted subject areas, interior holes, retained background, edges and critical structures. Panels without a generated PNG are explicitly NOT RUN.</p>""" + "".join(rows) + "</body></html>"
    (BENCHMARK_ROOT / "results" / "comparison.html").write_text(html, encoding="utf-8")


def source_filename_for_case(result: dict[str, Any], case_id: str) -> str:
    configured = result.get("caseSources", {}).get(case_id)
    if configured:
        return configured
    return find_source(BENCHMARK_ROOT / "cases" / case_id).name


def main() -> int:
    args = parse_args()
    config = load_config()
    manifest = load_manifest()
    selected_models = config["modelOrder"] if args.models == ["all"] else args.models
    unknown = [model for model in selected_models if model not in manifest]
    if unknown:
        raise ValueError(f"unknown models: {', '.join(unknown)}")
    cases = load_cases(args, config)
    result = initial_result(config, selected_models, args, cases, manifest)

    for model_id in selected_models:
        adapter = create_adapter(model_id, allow_model_download=args.allow_model_download)
        availability = adapter.availability()
        if not availability.available:
            result["models"][model_id] = {"status": "NOT_RUN", "initializeStatus": "NOT_RUN", "reason": availability.reason, "metadata": manifest[model_id]}
            for metadata, _source_path, _gt_path, _case_dir in cases:
                result["caseResults"].append({"caseId": metadata["caseId"], "modelId": model_id, "status": "NOT_RUN", "reason": availability.reason})
            continue
        rss_sampler = ProcessRssSampler(int(config.get("rssSampleIntervalMs", 10)))
        rss_sampler.start()
        try:
            initialize_started = time.perf_counter()
            adapter.initialize()
            initialize_ms = (time.perf_counter() - initialize_started) * 1000
            result["models"][model_id] = {"status": "INITIALIZED", "initializeStatus": "SUCCESS", "metadata": manifest[model_id], "modelSizeBytes": adapter.model_size_bytes, "initializeMs": initialize_ms}
        except Exception as exc:  # noqa: BLE001
            rss_sampler.stop()
            reason = f"adapter initialization failed: {type(exc).__name__}: {exc}"
            result["models"][model_id] = {"status": "FAILED", "initializeStatus": "ERROR", "reason": reason, "metadata": manifest[model_id]}
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
                output.save(output_dir / f"{metadata['caseId']}.png")
                result["caseResults"].append({
                    "caseId": metadata["caseId"],
                    "modelId": model_id,
                    "status": "SUCCESS",
                    "metrics": calculate_metrics(output, ground_truth, config),
                    "performance": performance_record(initialize_ms, first_inference_ms, warm_ms, model_size_bytes=adapter.model_size_bytes, output=output, process_peak_rss_mb=rss_sampler.peak_rss_mb),
                    "manualReview": {
                        "boundaryQuality": None,
                        "criticalStructure": None,
                        "visibleInternalHole": None,
                        "hardFailReasons": [],
                        "finalVerdict": "UNREVIEWED",
                    },
                })
            except Exception as exc:  # noqa: BLE001
                result["caseResults"].append({"caseId": metadata["caseId"], "modelId": model_id, "status": "ERROR", "reason": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc(limit=3)})
        rss_sampler.stop()
        model_rows = [row for row in result["caseResults"] if row["modelId"] == model_id]
        result["models"][model_id]["status"] = model_run_status(model_rows, len(cases))
    write_results(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
