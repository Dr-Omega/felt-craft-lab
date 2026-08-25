"""Read-only runner for the isolated P0-04B1 color-purification PoC."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from color_purification import (
    ColorPurificationError,
    apply_representatives,
    get_candidate,
    label_map_preview,
    metrics_for_run,
    validate_rgba,
)

BENCHMARK_ROOT = Path(__file__).resolve().parents[3]
CANDIDATE_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = CANDIDATE_ROOT / "configs" / "profiles.json"
OUTPUT_ROOT = BENCHMARK_ROOT / "outputs" / "color-purification"
REPORT_ROOT = BENCHMARK_ROOT / "reports" / "color-purification"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ColorPurificationError(f"{path.name} must contain an object")
    return value


def _load_rgba(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        if image.mode != "RGBA":
            raise ColorPurificationError(f"{path.name} must decode as RGBA")
        rgba = np.asarray(image, dtype=np.uint8).copy()
    validate_rgba(rgba)
    return rgba


def _save_rgba(path: Path, rgba: np.ndarray) -> None:
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)


def _environment_versions() -> dict[str, str]:
    return {
        "python": sys.version.split()[0],
        "numpy": importlib.metadata.version("numpy"),
        "opencv-python-headless": importlib.metadata.version("opencv-python-headless"),
        "Pillow": importlib.metadata.version("Pillow"),
        "scikit-image": importlib.metadata.version("scikit-image"),
        "vtracer": "DEPENDENCY_UNAVAILABLE",
    }


def _load_manifest() -> list[dict[str, Any]]:
    manifest = _load_json(BENCHMARK_ROOT / "benchmark_manifest.json")
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list):
        raise ColorPurificationError("benchmark manifest fixtures must be an array")
    return [fixture for fixture in fixtures if isinstance(fixture, dict)]


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _run_fixture(
    fixture: dict[str, Any],
    candidate_id: str,
    profile_name: str,
    representative_id: str,
    config: dict[str, Any],
    fixture_sha256: str,
) -> dict[str, Any]:
    fixture_id = str(fixture["fixtureId"])
    source_path = BENCHMARK_ROOT / str(fixture["sourceFile"])
    source = _load_rgba(source_path)
    started = time.perf_counter()
    proposal = get_candidate(candidate_id).propose(source, config)
    purified, regions = apply_representatives(source, proposal.label_map, representative_id, config)
    if not np.array_equal(source[..., 3], purified[..., 3]):
        raise AssertionError("alpha changed during purification")
    metrics = metrics_for_run(source, proposal.label_map, purified, config)
    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 3)
    run_id = f"{candidate_id.lower()}-{profile_name}_{representative_id.lower()}"
    case_dir = OUTPUT_ROOT / run_id / fixture_id
    case_dir.mkdir(parents=True, exist_ok=True)
    _save_rgba(case_dir / "purified.png", purified)
    np.savez_compressed(case_dir / "label_map.npz", labels=proposal.label_map)
    _save_rgba(case_dir / "label_map_preview.png", label_map_preview(proposal.label_map))
    _write_json(case_dir / "regions.json", regions)
    metrics.update({"candidateId": candidate_id, "configProfile": profile_name, "representativeColorMethod": representative_id, "elapsedMs": elapsed_ms})
    _write_json(case_dir / "metrics.json", metrics)
    _write_json(case_dir / "run_config.json", {
        "candidateId": candidate_id,
        "configProfile": profile_name,
        "representativeColorMethod": representative_id,
        "parameters": config,
        "fixtureId": fixture_id,
        "sourceFile": fixture["sourceFile"],
        "sourceSha256": fixture_sha256,
        "environment": _environment_versions(),
        "alphaPolicy": "input alpha must be bit-identical in purified output",
        "smallRegionStrategy": config["smallRegionStrategy"],
    })
    return {"fixtureId": fixture_id, "runId": run_id, "status": "SUCCESS", "metrics": metrics}


def _unavailable_record(candidate_id: str, profile_name: str, representative_id: str, fixture_id: str) -> dict[str, Any]:
    return {
        "fixtureId": fixture_id,
        "runId": f"{candidate_id.lower()}-{profile_name}_{representative_id.lower()}",
        "status": "DEPENDENCY_UNAVAILABLE",
        "error": "VTracer watershed baseline was not installed; CP-C was not substituted with another algorithm.",
    }


def _summarize(records: list[dict[str, Any]], fixture_count: int) -> dict[str, Any]:
    runs: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        runs.setdefault(record["runId"], []).append(record)
    summaries = []
    for run_id, entries in sorted(runs.items()):
        successful = [entry for entry in entries if entry["status"] == "SUCCESS"]
        aggregate = {"runId": run_id, "fixtureCount": fixture_count, "successCount": len(successful), "status": "SUCCESS" if len(successful) == fixture_count else entries[0]["status"]}
        if successful:
            metrics = [entry["metrics"] for entry in successful]
            aggregate.update({
                "meanElapsedMs": round(float(np.mean([metric["elapsedMs"] for metric in metrics])), 3),
                "meanRegionCountAfter": round(float(np.mean([metric["region_count_after"] for metric in metrics])), 3),
                "meanVarianceBefore": round(float(np.mean([metric["within_region_color_variance_before"] for metric in metrics])), 8),
                "meanVarianceAfter": round(float(np.mean([metric["within_region_color_variance_after"] for metric in metrics])), 8),
                "meanBoundaryShift": round(float(np.mean([metric["boundary_shift"] for metric in metrics])), 8),
                "manualQualityGrade": "PENDING_MANUAL_REVIEW",
            })
        summaries.append(aggregate)
    return {"status": "PROVISIONAL_PENDING_MANUAL_REVIEW", "fixtureCount": fixture_count, "runs": summaries, "records": records}


def _write_reports(summary: dict[str, Any], fixture_ids: list[str]) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    _write_json(REPORT_ROOT / "summary.json", summary)
    rows = []
    for run in summary["runs"]:
        rows.append(f"| {run['runId']} | {run['status']} | {run.get('meanElapsedMs', '—')} | {run.get('meanRegionCountAfter', '—')} | {run.get('meanVarianceBefore', '—')} → {run.get('meanVarianceAfter', '—')} | {run.get('meanBoundaryShift', '—')} |")
    (REPORT_ROOT / "summary.md").write_text(
        "# P0-04B1 Local Color Purification — PROVISIONAL\n\n"
        "All conclusions are provisional until human review. `false_merge_count`, `false_split_count`, and manual grades are intentionally not fabricated.\n\n"
        "| Run | Status | Mean ms | Mean regions after | Mean Lab variance | Mean boundary shift |\n|---|---:|---:|---:|---:|---:|\n"
        + "\n".join(rows)
        + "\n\n## Required interpretation\n\n"
        "- Candidate stability, false merge/split risk, small-structure protection, representative-color stability, and failures require the linked manual review evidence.\n"
        "- CP-C is unavailable, not substituted.\n"
        "- G02 AI color-drift remains absent from the frozen fixture set; this limits conclusions about true AI drift.\n",
        encoding="utf-8",
    )
    sections = []
    for run in summary["runs"]:
        if run["status"] != "SUCCESS":
            continue
        sections.append(f"## {run['runId']}\n")
        for fixture_id in fixture_ids:
            base = f"../../outputs/color-purification/{run['runId']}/{fixture_id}"
            sections.append(f"### {fixture_id}\n\n- Original: `fixtures/source/{fixture_id}.png`\n- Purified: [{fixture_id} purified]({base}/purified.png)\n- Label preview: [{fixture_id} labels]({base}/label_map_preview.png)\n\nManual grade: `PENDING_MANUAL_REVIEW`\n")
    (REPORT_ROOT / "MANUAL_REVIEW.md").write_text(
        "# P0-04B1 Manual Review\n\n"
        "Review Original / Purified / Label Preview together. Grade only after human inspection: A direct to Generic Decomposition; B minor issue; C small repair; D clearly wrong; F unusable. No grade is assigned by this PoC.\n\n"
        + "\n".join(sections),
        encoding="utf-8",
    )
    (REPORT_ROOT / "DEPENDENCY_GAP_REPORT.md").write_text(
        "# Dependency gap\n\nCP-C VTracer watershed baseline status: `DEPENDENCY_UNAVAILABLE`. It was not installed in this PoC environment and no other algorithm was used as a substitute. CP-A and CP-B remain independently runnable.\n",
        encoding="utf-8",
    )


def run(
    candidate_ids: list[str],
    profile_names: list[str],
    representative_ids: list[str],
) -> dict[str, Any]:
    profiles = _load_json(CONFIG_PATH)
    fixtures = _load_manifest()
    fixture_sha256 = {str(fixture["fixtureId"]): _sha256(BENCHMARK_ROOT / str(fixture["sourceFile"])) for fixture in fixtures}
    records: list[dict[str, Any]] = []
    for candidate_id in candidate_ids:
        for profile_name in profile_names:
            config = profiles.get(profile_name)
            if not isinstance(config, dict):
                raise ColorPurificationError(f"unknown config profile {profile_name}")
            for representative_id in representative_ids:
                for fixture in fixtures:
                    fixture_id = str(fixture["fixtureId"])
                    if candidate_id == "CP-C":
                        records.append(_unavailable_record(candidate_id, profile_name, representative_id, fixture_id))
                        continue
                    try:
                        records.append(_run_fixture(fixture, candidate_id, profile_name, representative_id, config, fixture_sha256[fixture_id]))
                    except Exception as exc:  # noqa: BLE001 - retain independent candidate execution
                        records.append({"fixtureId": fixture_id, "runId": f"{candidate_id.lower()}-{profile_name}_{representative_id.lower()}", "status": "ERROR", "error": f"{type(exc).__name__}: {exc}"})
    for fixture in fixtures:
        fixture_id = str(fixture["fixtureId"])
        if fixture_sha256[fixture_id] != _sha256(BENCHMARK_ROOT / str(fixture["sourceFile"])):
            raise AssertionError(f"frozen fixture PNG changed during run: {fixture_id}")
    summary = _summarize(records, len(fixtures))
    _write_reports(summary, [str(fixture["fixtureId"]) for fixture in fixtures])
    return summary


def finalize_existing_outputs() -> dict[str, Any]:
    """Rebuild reports from completed on-disk outputs without rerunning candidates."""
    fixtures = _load_manifest()
    fixture_ids = [str(fixture["fixtureId"]) for fixture in fixtures]
    records: list[dict[str, Any]] = []
    for run_dir in sorted(path for path in OUTPUT_ROOT.iterdir() if path.is_dir()):
        for fixture_id in fixture_ids:
            metrics_path = run_dir / fixture_id / "metrics.json"
            if not metrics_path.is_file():
                records.append({"fixtureId": fixture_id, "runId": run_dir.name, "status": "ERROR", "error": "missing metrics.json"})
                continue
            run_config_path = run_dir / fixture_id / "run_config.json"
            if run_config_path.is_file():
                run_config = _load_json(run_config_path)
                run_config["environment"] = _environment_versions()
                _write_json(run_config_path, run_config)
            records.append({"fixtureId": fixture_id, "runId": run_dir.name, "status": "SUCCESS", "metrics": _load_json(metrics_path)})
    for representative_id in ("RC-A", "RC-B", "RC-C"):
        records.extend(_unavailable_record("CP-C", "balanced", representative_id, fixture_id) for fixture_id in fixture_ids)
    summary = _summarize(records, len(fixtures))
    _write_reports(summary, fixture_ids)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run isolated P0-04B1 local color purification.")
    parser.add_argument("--candidates", default="CP-A,CP-B,CP-C")
    parser.add_argument("--profiles", default="balanced")
    parser.add_argument("--representatives", default="RC-A,RC-B,RC-C")
    parser.add_argument("--finalize-existing", action="store_true", help="Regenerate reports from existing case outputs without rerunning candidates.")
    args = parser.parse_args(argv)
    summary = finalize_existing_outputs() if args.finalize_existing else run(args.candidates.split(","), args.profiles.split(","), args.representatives.split(","))
    print(json.dumps({"status": summary["status"], "runs": summary["runs"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
