"""Read-only runner for the isolated P0-04B1 color-purification PoC."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.metadata
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

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


def _write_compact_regions(path: Path, regions: list[dict[str, Any]]) -> None:
    """Avoid repeated multi-megabyte pretty JSON artifacts in iterative PoC commits."""
    with gzip.open(path, "wt", encoding="utf-8") as destination:
        json.dump(regions, destination, ensure_ascii=False, separators=(",", ":"))


def _ground_truth_approx_region_count(fixture: dict[str, Any]) -> int:
    path = BENCHMARK_ROOT / str(fixture["groundTruthFile"])
    ground_truth = _load_json(path)
    expected = ground_truth.get("expectedColorRegions")
    if not isinstance(expected, dict) or not isinstance(expected.get("approximateCount"), int):
        raise ColorPurificationError(f"{path.name} must provide expectedColorRegions.approximateCount")
    return int(expected["approximateCount"])


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
    purified, regions = apply_representatives(
        source, proposal.structural_label_map, representative_id, config, proposal.pixel_label_map,
    )
    if not np.array_equal(source[..., 3], purified[..., 3]):
        raise AssertionError("alpha changed during purification")
    metrics = metrics_for_run(
        source,
        proposal.structural_label_map,
        purified,
        config,
        _ground_truth_approx_region_count(fixture),
        "CIEDE2000" if candidate_id == "CP-B" else "LAB_EUCLIDEAN_APPROX",
        proposal.pixel_label_map,
        regions,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 3)
    run_id = f"{candidate_id.lower()}-{profile_name}_{representative_id.lower()}"
    case_dir = OUTPUT_ROOT / run_id / fixture_id
    case_dir.mkdir(parents=True, exist_ok=True)
    _save_rgba(case_dir / "purified.png", purified)
    np.savez_compressed(case_dir / "structural_label_map.npz", labels=proposal.structural_label_map)
    np.savez_compressed(case_dir / "pixel_label_map.npz", labels=proposal.pixel_label_map)
    _save_rgba(case_dir / "structural_label_preview.png", label_map_preview(proposal.structural_label_map))
    _write_compact_regions(case_dir / "regions.json.gz", regions)
    metrics.update({
        "candidateId": candidate_id,
        "configProfile": profile_name,
        "representativeColorMethod": representative_id,
        "elapsedMs": elapsed_ms,
        **proposal.fringe_metrics,
    })
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
        "structuralLabelPolicy": "structural_label_map uses only alpha >= structuralAlphaThreshold; pixel_label_map propagates fringe or records -1 ORPHAN_FRINGE",
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
                "meanLocalRegionCount": round(float(np.mean([metric.get("local_region_count_after", metric["region_count_after"]) for metric in metrics])), 3),
                "meanColorGroupCount": round(float(np.mean([metric.get("color_group_count_after", metric["region_count_after"]) for metric in metrics])), 3),
                "meanColorGroupGtRatio": round(float(np.mean([metric.get("color_group_ratio_to_gt", metric.get("region_count_ratio_to_gt")) for metric in metrics if metric.get("color_group_ratio_to_gt", metric.get("region_count_ratio_to_gt")) is not None])), 5),
                "maxColorGroupGtRatio": round(float(np.max([metric.get("color_group_ratio_to_gt", metric.get("region_count_ratio_to_gt")) for metric in metrics if metric.get("color_group_ratio_to_gt", metric.get("region_count_ratio_to_gt")) is not None])), 5),
                "meanSmallComponentCount": round(float(np.mean([metric["small_component_count_after"] for metric in metrics])), 3),
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
        rows.append(f"| {run['runId']} | {run['status']} | {run.get('meanElapsedMs', '—')} | {run.get('meanLocalRegionCount', '—')} | {run.get('meanColorGroupCount', '—')} | {run.get('meanColorGroupGtRatio', '—')} / {run.get('maxColorGroupGtRatio', '—')} | {run.get('meanSmallComponentCount', '—')} | {run.get('meanBoundaryShift', '—')} |")
    fixture_rows = []
    for record in summary["records"]:
        if record["status"] != "SUCCESS":
            continue
        metric = record["metrics"]
        fixture_rows.append(
            f"| {record['runId']} | {record['fixtureId']} | {metric.get('geometry_component_count', '—')} | {metric.get('local_region_count_after', '—')} | {metric.get('color_group_count_after', '—')} | {metric.get('ground_truth_approx_region_count', '—')} | {metric.get('color_group_ratio_to_gt', '—')} ({metric.get('region_count_order_gate', '—')}) | {metric.get('fringe_pixel_count', '—')}/{metric.get('orphan_fringe_count', '—')} | {metric.get('boundary_shift', '—')} ({metric.get('boundary_shift_state', '—')}) | {metric.get('elapsedMs', '—')} |"
        )
    (REPORT_ROOT / "summary.md").write_text(
        "# P0-04B1.2 Color Region Semantics + Alpha Topology — PROVISIONAL\n\n"
        "Previous HEAD: `2301aa59d7278f54874c219c5e2689ee6153d8ea`. Its generated output is superseded because of severe over-segmentation and a CP-B contract mismatch.\n\n"
        "All conclusions are provisional until human review. `false_merge_count`, `false_split_count`, and manual grades are intentionally not fabricated.\n\n"
        "`within_region_color_variance_after` verifies only that each chosen region was unified. It cannot establish that its region proposal was correct. `region_count_ratio_to_gt` is retained only as `SEMANTICALLY_APPROXIMATE`; B0 expectedColorRegions is compared diagnostically to experimental Color Groups, not directly to connected local labels.\n\n"
        "| Run | Status | Mean ms | Mean Local Regions | Mean Color Groups | Mean / max group:GT ratio | Mean small components | Mean boundary shift |\n|---|---:|---:|---:|---:|---:|---:|---:|\n"
        + "\n".join(rows)
        + "\n\n## Per-fixture diagnostics\n\n"
        + "| Run | Fixture | Geometry components | Local regions | Color groups | GT approx | Group:GT ratio (gate) | Fringe/orphan | Boundary shift | Elapsed ms |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n"
        + "\n".join(fixture_rows)
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
            sections.append(f"### {fixture_id}\n\n- Original: `fixtures/source/{fixture_id}.png`\n- Purified: [{fixture_id} purified]({base}/purified.png)\n- Structural labels: [{fixture_id} structural labels]({base}/structural_label_preview.png)\n\nManual grade: `PENDING_MANUAL_REVIEW`\n")
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


def _thumbnail(image: Image.Image, width: int = 220, height: int = 220) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (240, 240, 240, 255))
    candidate = image.convert("RGBA").copy()
    candidate.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas.alpha_composite(candidate, ((width - candidate.width) // 2, (height - candidate.height) // 2))
    return canvas


def _write_contact_sheets(summary: dict[str, Any], fixtures: list[dict[str, Any]]) -> None:
    """Single-fixture human-review views; never read by candidate algorithms."""
    sheet_root = REPORT_ROOT / "contact-sheets"
    sheet_root.mkdir(parents=True, exist_ok=True)
    metrics_by_key = {(record["runId"], record["fixtureId"]): record.get("metrics") for record in summary["records"] if record["status"] == "SUCCESS"}
    for fixture in fixtures:
        fixture_id = str(fixture["fixtureId"])
        cp_a = metrics_by_key.get(("cp-a-balanced_rc-a", fixture_id))
        cp_b = metrics_by_key.get(("cp-b-balanced_rc-a", fixture_id))
        if not cp_a or not cp_b:
            continue
        source = _load_rgba(BENCHMARK_ROOT / str(fixture["sourceFile"]))
        views = [
            ("Original", Image.fromarray(source, mode="RGBA")),
            ("CP-A purified", Image.open(OUTPUT_ROOT / "cp-a-balanced_rc-a" / fixture_id / "purified.png")),
            ("CP-A structural", Image.open(OUTPUT_ROOT / "cp-a-balanced_rc-a" / fixture_id / "structural_label_preview.png")),
            ("CP-B purified", Image.open(OUTPUT_ROOT / "cp-b-balanced_rc-a" / fixture_id / "purified.png")),
            ("CP-B structural", Image.open(OUTPUT_ROOT / "cp-b-balanced_rc-a" / fixture_id / "structural_label_preview.png")),
        ]
        width, image_height, text_height = 220, 220, 95
        sheet = Image.new("RGBA", (width * len(views), image_height + text_height), "white")
        draw = ImageDraw.Draw(sheet)
        for index, (caption, image) in enumerate(views):
            sheet.alpha_composite(_thumbnail(image, width, image_height), (index * width, 0))
            draw.text((index * width + 6, image_height + 5), caption, fill="black")
        alpha_counts = "/".join(str(cp_a["alpha_topology"][f"alpha_ge_{threshold}"]["component_count"]) for threshold in (1, 32, 64, 128, 192, 224))
        draw.text((6, image_height + 24), f"GT approx={cp_a['ground_truth_approx_region_count']}  alpha components >0/32/64/128/192/224={alpha_counts}", fill="black")
        draw.text((6, image_height + 43), f"CP-A local/groups={cp_a['local_region_count_after']}/{cp_a['color_group_count_after']} fringe/orphan={cp_a['fringe_pixel_count']}/{cp_a['orphan_fringe_count']}", fill="black")
        draw.text((6, image_height + 62), f"CP-B local/groups={cp_b['local_region_count_after']}/{cp_b['color_group_count_after']} fringe/orphan={cp_b['fringe_pixel_count']}/{cp_b['orphan_fringe_count']}", fill="black")
        sheet.convert("RGB").save(sheet_root / f"{fixture_id}.png", format="PNG", optimize=True)


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
    _write_contact_sheets(summary, fixtures)
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
    summary = _summarize(records, len(fixtures))
    _write_reports(summary, fixture_ids)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run isolated P0-04B1 local color purification.")
    parser.add_argument("--candidates", default="CP-A,CP-B")
    parser.add_argument("--profiles", default="conservative,balanced,aggressive")
    parser.add_argument("--representatives", default="RC-A")
    parser.add_argument("--finalize-existing", action="store_true", help="Regenerate reports from existing case outputs without rerunning candidates.")
    args = parser.parse_args(argv)
    summary = finalize_existing_outputs() if args.finalize_existing else run(args.candidates.split(","), args.profiles.split(","), args.representatives.split(","))
    print(json.dumps({"status": summary["status"], "runs": summary["runs"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
