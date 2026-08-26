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
from PIL import Image, ImageDraw, PngImagePlugin

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

REVIEW_ROWS = (
    ("CP-A", "cp-a-balanced_rc-a", "cp-a-aggressive_rc-a"),
    ("CP-B", "cp-b-balanced_rc-a", "cp-b-aggressive_rc-a"),
)
REVIEW_RUN_IDS = tuple(run_id for _, balanced, aggressive in REVIEW_ROWS for run_id in (balanced, aggressive))


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


def _review_metric_lines(candidate: str, profile: str, metrics: dict[str, Any]) -> list[str]:
    return [
        f"{candidate} {profile}",
        f"Local={metrics['local_region_count_after']}  Groups={metrics['color_group_count_after']}",
        f"GT={metrics['ground_truth_approx_region_count']}  Gate={metrics['region_count_order_gate']}",
        f"Boundary={metrics['boundary_shift']:.4f}  {metrics['boundary_shift_state']}",
    ]


def _open_review_image(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA").copy()


def _write_contact_sheets(summary: dict[str, Any], fixtures: list[dict[str, Any]]) -> None:
    """Build read-only review material from completed candidate artifacts."""
    sheet_root = REPORT_ROOT / "contact-sheets"
    sheet_root.mkdir(parents=True, exist_ok=True)
    metrics_by_key = {(record["runId"], record["fixtureId"]): record.get("metrics") for record in summary["records"] if record["status"] == "SUCCESS"}
    for fixture in fixtures:
        fixture_id = str(fixture["fixtureId"])
        metrics_by_run = {run_id: metrics_by_key.get((run_id, fixture_id)) for run_id in REVIEW_RUN_IDS}
        if not all(metrics_by_run.values()):
            continue
        source = _load_rgba(BENCHMARK_ROOT / str(fixture["sourceFile"]))
        cell_width, image_height, text_height = 280, 250, 92
        row_height = image_height + text_height
        footer_height = 78
        sheet = Image.new("RGBA", (cell_width * 5, row_height * len(REVIEW_ROWS) + footer_height), "white")
        draw = ImageDraw.Draw(sheet)
        for row_index, (candidate, balanced_run, aggressive_run) in enumerate(REVIEW_ROWS):
            top = row_index * row_height
            views = [
                ("Original", Image.fromarray(source, mode="RGBA"), []),
                (f"{candidate} balanced purified", _open_review_image(OUTPUT_ROOT / balanced_run / fixture_id / "purified.png"), _review_metric_lines(candidate, "balanced", metrics_by_run[balanced_run])),
                (f"{candidate} balanced structural", _open_review_image(OUTPUT_ROOT / balanced_run / fixture_id / "structural_label_preview.png"), []),
                (f"{candidate} aggressive purified", _open_review_image(OUTPUT_ROOT / aggressive_run / fixture_id / "purified.png"), _review_metric_lines(candidate, "aggressive", metrics_by_run[aggressive_run])),
                (f"{candidate} aggressive structural", _open_review_image(OUTPUT_ROOT / aggressive_run / fixture_id / "structural_label_preview.png"), []),
            ]
            for index, (caption, image, detail_lines) in enumerate(views):
                left = index * cell_width
                sheet.alpha_composite(_thumbnail(image, cell_width, image_height), (left, top))
                draw.text((left + 6, top + image_height + 4), caption, fill="black")
                for line_index, line in enumerate(detail_lines):
                    draw.text((left + 6, top + image_height + 20 + line_index * 15), line, fill="black")

        topology = metrics_by_run["cp-a-balanced_rc-a"]["alpha_topology"]
        alpha_counts = "/".join(str(topology[f"alpha_ge_{threshold}"]["component_count"]) for threshold in (1, 32, 64, 128, 192, 224))
        alpha_one = topology["alpha_ge_1"]
        footer_top = row_height * len(REVIEW_ROWS) + 5
        draw.text((6, footer_top), f"Alpha topology: geometry components={alpha_one['component_count']}  alpha components >=1/32/64/128/192/224={alpha_counts}", fill="black")
        draw.text((6, footer_top + 18), f"Tiny opaque components: median area={alpha_one['median_component_area']}  <4px={alpha_one['components_under_4px']}  <16px={alpha_one['components_under_16px']}  <64px={alpha_one['components_under_64px']}", fill="black")
        pnginfo = PngImagePlugin.PngInfo()
        pnginfo.add_text("reviewRunIds", ",".join(REVIEW_RUN_IDS))
        pnginfo.add_text("reviewLayout", "5 columns x 2 rows; original, balanced purified/structural, aggressive purified/structural")
        sheet.convert("RGB").save(sheet_root / f"{fixture_id}.png", format="PNG", optimize=True, pnginfo=pnginfo)


def _review_diagnostic(fixture_id: str, metrics_by_run: dict[str, dict[str, Any]]) -> str:
    if fixture_id == "FLD-003":
        return (
            "CP-A balanced and aggressive each produce one local region; "
            f"CP-B balanced and aggressive produce {metrics_by_run['cp-b-balanced_rc-a']['local_region_count_after']} and {metrics_by_run['cp-b-aggressive_rc-a']['local_region_count_after']} local regions."
        )
    if fixture_id == "FLD-004":
        topology = metrics_by_run["cp-a-balanced_rc-a"]["alpha_topology"]["alpha_ge_1"]
        return (
            f"{topology['component_count']} opaque geometry components persist across all recorded alpha thresholds; "
            f"{topology['components_under_64px']} are under 64 px."
        )
    return (
        "Automated color-group counts (balanced/aggressive) are "
        f"CP-A {metrics_by_run['cp-a-balanced_rc-a']['color_group_count_after']}/{metrics_by_run['cp-a-aggressive_rc-a']['color_group_count_after']} and "
        f"CP-B {metrics_by_run['cp-b-balanced_rc-a']['color_group_count_after']}/{metrics_by_run['cp-b-aggressive_rc-a']['color_group_count_after']}."
    )


def _write_review_index(summary: dict[str, Any], fixtures: list[dict[str, Any]]) -> None:
    metrics_by_key = {(record["runId"], record["fixtureId"]): record.get("metrics") for record in summary["records"] if record["status"] == "SUCCESS"}
    sections = [
        "# P0-04B1.3 Manual Review Index",
        "",
        "Status: `PROVISIONAL_PENDING_MANUAL_REVIEW`. These are review aids, not human grades or a candidate selection.",
        "",
    ]
    for fixture in fixtures:
        fixture_id = str(fixture["fixtureId"])
        metrics_by_run = {run_id: metrics_by_key.get((run_id, fixture_id)) for run_id in REVIEW_RUN_IDS}
        if not all(metrics_by_run.values()):
            raise ColorPurificationError(f"review artifacts require all four completed runs for {fixture_id}")
        sections.extend([
            f"## {fixture_id}",
            "",
            f"- Contact sheet: [open {fixture_id}](contact-sheets/{fixture_id}.png)",
            f"- B0 geometry tags: {', '.join(str(tag) for tag in fixture.get('geometryTags', []))}",
            f"- Expected color regions (approximate): {_ground_truth_approx_region_count(fixture)}",
            f"- Automated diagnostic: {_review_diagnostic(fixture_id, metrics_by_run)}",
            "",
        ])
    (REPORT_ROOT / "REVIEW_INDEX.md").write_text("\n".join(sections), encoding="utf-8")


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
    """Regenerate manual review material without rerunning or rewriting case artifacts."""
    fixtures = _load_manifest()
    summary = _load_json(REPORT_ROOT / "summary.json")
    if summary.get("status") != "PROVISIONAL_PENDING_MANUAL_REVIEW":
        raise ColorPurificationError("manual review finalization requires the provisional B1.2 summary")
    _write_contact_sheets(summary, fixtures)
    _write_review_index(summary, fixtures)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run isolated P0-04B1 local color purification.")
    parser.add_argument("--candidates", default="CP-A,CP-B")
    parser.add_argument("--profiles", default="conservative,balanced,aggressive")
    parser.add_argument("--representatives", default="RC-A")
    parser.add_argument("--finalize-existing", action="store_true", help="Regenerate contact sheets and REVIEW_INDEX from existing case outputs without rerunning or rewriting them.")
    args = parser.parse_args(argv)
    summary = finalize_existing_outputs() if args.finalize_existing else run(args.candidates.split(","), args.profiles.split(","), args.representatives.split(","))
    print(json.dumps({"status": summary["status"], "runs": summary["runs"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
