"""Read-only V2 tolerance and FLD-007 hole review artifact generation."""
from __future__ import annotations

import hashlib
import json
import statistics
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.optimize import linear_sum_assignment

from boundary_graph import build_boundary_graph, rasterize_paths
from review import _composite_source, _fit_panel, _geometry_map, _load_colors, render_vector
from vector_contract import sha256, write_json

STATUS = "V2_TOLERANCE_REVIEW_EVIDENCE_COMPLETE_PENDING_EXTERNAL_DECISION"
PRIMARY_PROFILE = "cp-b-aggressive_rc-a"
PROFILES = (PRIMARY_PROFILE, "cp-b-balanced_rc-a")
TOLERANCES = (0.5, 1.0, 2.0)
FOCUS_CASES = ("FLD-001", "FLD-002", "FLD-004", "FLD-005", "FLD-006", "FLD-007", "FLD-008")
CROP_SPECS: dict[str, list[tuple[str, tuple[float, float, float, float]]]] = {
    "FLD-001": [("moon-tips", (0.20, 0.20, 0.82, 0.72))],
    "FLD-004": [("upper-petals-and-flame", (0.18, 0.00, 0.82, 0.48)), ("front-petal-tips", (0.10, 0.28, 0.90, 0.76))],
    "FLD-005": [("fuse-body-connection", (0.00, 0.00, 0.62, 0.40))],
    "FLD-006": [("ear-tips", (0.25, 0.12, 0.75, 0.40)), ("ear-roots", (0.24, 0.28, 0.76, 0.52)), ("feet", (0.24, 0.65, 0.76, 0.91))],
    "FLD-008": [("arc-line-transitions", (0.08, 0.08, 0.92, 0.72))],
}


def _aggregate_sha(paths: list[Path], base: Path) -> str:
    payload = "".join(f"{path.relative_to(base).as_posix()}:{sha256(path)}\n" for path in sorted(paths))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def integrity_snapshot(benchmark_root: Path, poc_root: Path) -> dict[str, Any]:
    routes = sorted(poc_root.glob("outputs/*/FLD-*/V*/**/result.json"))
    inputs = sorted(benchmark_root.glob("outputs/color-purification/cp-b-*_rc-a/FLD-*/structural_label_map.npz"))
    inputs += sorted(benchmark_root.glob("outputs/color-purification/cp-b-*_rc-a/FLD-*/pixel_label_map.npz"))
    case_metrics = poc_root / "reports" / "case-metrics.json"
    return {
        "routeArtifactCount": len(routes),
        "routeArtifactAggregateSha256": _aggregate_sha(routes, poc_root),
        "inputArtifactCount": len(inputs),
        "inputArtifactAggregateSha256": _aggregate_sha(inputs, benchmark_root),
        "caseMetricsSha256": sha256(case_metrics),
    }


def _load_case(benchmark_root: Path, poc_root: Path, profile: str, case_id: str) -> dict[str, Any]:
    source = np.asarray(Image.open(benchmark_root / "fixtures" / "source" / f"{case_id}.png").convert("RGBA"))
    case_root = benchmark_root / "outputs" / "color-purification" / profile / case_id
    with np.load(case_root / "structural_label_map.npz") as data:
        labels = data["labels"]
    graph = build_boundary_graph(labels, source[..., 3])
    result_root = poc_root / "outputs" / profile / case_id
    results: dict[str, dict[str, Any]] = {}
    for tolerance in TOLERANCES:
        suffix = str(tolerance).replace(".", "p")
        path = result_root / "V2" / f"tol-{suffix}" / "result.json"
        result = json.loads(path.read_text(encoding="utf-8"))
        if not result["hardGate"]["pass"]:
            raise ValueError(f"saved V2 result failed hard gate: {profile}/{case_id}/{tolerance}")
        results[str(tolerance)] = result
    v0 = json.loads((result_root / "V0" / "result.json").read_text(encoding="utf-8"))
    return {"source": source, "labels": labels, "graph": graph, "colors": _load_colors(case_root), "results": results, "v0": v0}


def _panel_metrics(result: dict[str, Any]) -> list[str]:
    geometry = result["metrics"]["geometry"]
    complexity = result["metrics"]["complexity"]
    return [
        f"Tol={result['tolerancePx']:.1f}px  Gate={'PASS' if result['hardGate']['pass'] else 'FAIL'}",
        f"SymMax={geometry['symmetricMaxBoundaryDeviation']:.4f}  Mean={geometry['meanBoundaryDeviation']:.4f}  Area={geometry['areaErrorRatio']:.6f}",
        f"Line={complexity['outputLineCount']}  Cubic={complexity['outputCubicSegmentCount']}  Fallback={complexity['fallbackCount']} ({complexity['fallbackRatio']:.3f})",
    ]


def _write_four_column_sheet(path: Path, case_id: str, images: list[tuple[str, np.ndarray]], results: dict[str, dict[str, Any]]) -> None:
    panel_size, header_height, footer_height = (420, 420), 58, 76
    sheet = Image.new("RGB", (panel_size[0] * 4, header_height + panel_size[1] + footer_height), "white")
    draw, font = ImageDraw.Draw(sheet), ImageFont.load_default()
    for index, (title, image) in enumerate(images):
        x = index * panel_size[0]
        draw.text((x + 10, 8), title, fill="black", font=font)
        draw.text((x + 10, 28), f"{case_id} | identical canvas / scale / render", fill=(70, 70, 70), font=font)
        sheet.paste(_fit_panel(image, panel_size), (x, header_height))
        lines = ["Frozen source"] if index == 0 else _panel_metrics(results[title.split()[-2]])
        for line_index, line in enumerate(lines):
            draw.text((x + 10, header_height + panel_size[1] + 8 + 18 * line_index), line, fill="black", font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, format="PNG", optimize=False)


def _crop_box(size: tuple[int, int], fractions: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    width, height = size
    left, top, right, bottom = fractions
    return (round(left * width), round(top * height), round(right * width), round(bottom * height))


def _write_crop_sheet(path: Path, case_id: str, crop_name: str, images: list[tuple[str, np.ndarray]], box: tuple[int, int, int, int]) -> None:
    zoom = 4
    cropped = []
    for title, image in images:
        crop = Image.fromarray(image, mode="RGB").crop(box)
        crop = crop.resize((crop.width * zoom, crop.height * zoom), Image.Resampling.NEAREST)
        cropped.append((title, crop))
    max_width = 480
    panel_height = 480
    sheet = Image.new("RGB", (max_width * 4, panel_height + 58), "white")
    draw, font = ImageDraw.Draw(sheet), ImageFont.load_default()
    for index, (title, crop) in enumerate(cropped):
        fitted = _fit_panel(np.asarray(crop), (max_width, panel_height))
        sheet.paste(fitted, (index * max_width, 58))
        draw.text((index * max_width + 10, 8), title, fill="black", font=font)
        draw.text((index * max_width + 10, 28), f"{case_id}/{crop_name} | box={box} | 4x nearest", fill=(70, 70, 70), font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, format="PNG", optimize=False)


def _internal_zero_components(labels: np.ndarray) -> list[dict[str, Any]]:
    count, components, stats, centroids = cv2.connectedComponentsWithStats((labels == 0).astype(np.uint8), connectivity=4)
    records = []
    for component_id in range(1, count):
        mask = components == component_id
        touches = bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())
        if touches:
            continue
        x, y, width, height, area = map(int, stats[component_id])
        records.append({"componentId": component_id, "area": area, "bbox": [x, y, width, height], "centroid": [float(centroids[component_id][0]), float(centroids[component_id][1])], "mask": mask})
    return sorted(records, key=lambda item: item["componentId"])


def _hole_correspondence(source_holes: list[dict[str, Any]], candidate_labels: np.ndarray) -> list[dict[str, Any]]:
    candidates = _internal_zero_components(candidate_labels)
    if len(candidates) != len(source_holes):
        return [{"retained": False, "candidate": None} for _ in source_holes]
    costs = np.zeros((len(source_holes), len(candidates)), dtype=np.float64)
    for row, source in enumerate(source_holes):
        for column, candidate in enumerate(candidates):
            overlap = int(np.count_nonzero(source["mask"] & candidate["mask"]))
            dx = source["centroid"][0] - candidate["centroid"][0]
            dy = source["centroid"][1] - candidate["centroid"][1]
            costs[row, column] = (dx * dx + dy * dy) ** 0.5 - min(overlap, 1000) * 1000.0
    rows, columns = linear_sum_assignment(costs)
    assignment = {int(row): candidates[int(column)] for row, column in zip(rows, columns)}
    return [{"retained": index in assignment, "candidate": assignment.get(index)} for index in range(len(source_holes))]


def _annotate_holes(image: np.ndarray, holes: list[dict[str, Any]]) -> Image.Image:
    output = Image.fromarray(image, mode="RGB")
    draw, font = ImageDraw.Draw(output), ImageFont.load_default()
    for index, hole in enumerate(holes, start=1):
        x, y, width, height = hole["bbox"]
        margin = 4
        draw.rectangle((x - margin, y - margin, x + width + margin, y + height + margin), outline=(0, 210, 255), width=2)
        label = f"H{index:03d}"
        tx, ty = min(output.width - 34, x + width + 6), max(0, y - 8)
        draw.rectangle((tx - 1, ty - 1, tx + 32, ty + 10), fill=(255, 255, 0))
        draw.text((tx, ty), label, fill=(0, 0, 0), font=font)
    return output


def _metric_record(result: dict[str, Any]) -> dict[str, Any]:
    geometry, complexity = result["metrics"]["geometry"], result["metrics"]["complexity"]
    return {
        "hardGate": "PASS" if result["hardGate"]["pass"] else "FAIL",
        "symmetricMaxDeviation": geometry["symmetricMaxBoundaryDeviation"],
        "meanDeviation": geometry["meanBoundaryDeviation"],
        "areaErrorRatio": geometry["areaErrorRatio"],
        "lineCount": complexity["outputLineCount"],
        "cubicCount": complexity["outputCubicSegmentCount"],
        "totalSegmentCount": complexity["outputLineCount"] + complexity["outputCubicSegmentCount"],
        "fallbackCount": complexity["fallbackCount"],
        "fallbackRatio": complexity["fallbackRatio"],
    }


def _aggregate(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "caseProfileCount": len(records),
        "medianSymmetricMax": statistics.median(item["symmetricMaxDeviation"] for item in records),
        "maxSymmetricMax": max(item["symmetricMaxDeviation"] for item in records),
        "medianAreaError": statistics.median(item["areaErrorRatio"] for item in records),
        "maxAreaError": max(item["areaErrorRatio"] for item in records),
        "totalLineCount": sum(item["lineCount"] for item in records),
        "totalCubicCount": sum(item["cubicCount"] for item in records),
        "totalSegmentCount": sum(item["totalSegmentCount"] for item in records),
        "medianFallbackRatio": statistics.median(item["fallbackRatio"] for item in records),
        "maxFallbackRatio": max(item["fallbackRatio"] for item in records),
    }


def _write_hole_review(benchmark_root: Path, poc_root: Path, case: dict[str, Any], rendered: dict[str, np.ndarray]) -> dict[str, Any]:
    graph, labels = case["graph"], case["labels"]
    source_holes = _internal_zero_components(labels)
    if len(source_holes) != 29:
        raise ValueError(f"FLD-007 structural hole contract changed: {len(source_holes)}")
    voids = sorted((item for item in graph["voids"] if item["kind"] == "HOLE"), key=lambda item: item["componentId"])
    if len(voids) != 29:
        raise ValueError("boundary graph hole correspondence is incomplete")
    versions: list[tuple[str, dict[str, Any], dict[str, Any], np.ndarray]] = []
    v0_geometry = _geometry_map(case["v0"])
    v0_labels = rasterize_paths(graph, v0_geometry, 0.0625)
    versions.append(("V0", case["v0"], {"matches": _hole_correspondence(source_holes, v0_labels)}, render_vector(graph, v0_geometry, case["colors"], scale=1)))
    for tolerance in TOLERANCES:
        result = case["results"][str(tolerance)]
        geometry = _geometry_map(result)
        candidate_labels = rasterize_paths(graph, geometry, 0.0625)
        versions.append((f"V2 {tolerance:.1f}", result, {"matches": _hole_correspondence(source_holes, candidate_labels)}, rendered[str(tolerance)]))

    original_matches = [{"retained": True, "candidate": item} for item in source_holes]
    panels = [("Original", _annotate_holes(rendered["original"], source_holes), original_matches)]
    for title, _, match_record, image in versions:
        candidate_holes = [item["candidate"] for item in match_record["matches"] if item["retained"]]
        panels.append((title, _annotate_holes(image, candidate_holes), match_record["matches"]))
    width, height = graph["width"], graph["height"]
    header, footer = 66, 62
    sheet = Image.new("RGB", (width * 5, header + height + footer), "white")
    draw, font = ImageDraw.Draw(sheet), ImageFont.load_default()
    gt = json.loads((benchmark_root / "fixtures" / "ground-truth" / "FLD-007.json").read_text(encoding="utf-8"))
    principal_count = int(gt["voidPolicy"]["globalVoidsExpected"])
    structural_zero_count = int(cv2.connectedComponents((labels == 0).astype(np.uint8), connectivity=4)[0] - 1)
    for index, (title, panel, _) in enumerate(panels):
        x = index * width
        sheet.paste(panel, (x, header))
        fallback = 0 if index == 0 else versions[index - 1][1]["metrics"]["complexity"]["fallbackCount"]
        draw.text((x + 8, 8), title, fill="black", font=font)
        draw.text((x + 8, 27), f"holeCount=29 | structuralZeroComponents={structural_zero_count}", fill="black", font=font)
        draw.text((x + 8, 45), f"principalVoidCount={principal_count} | fallback={fallback}", fill="black", font=font)
        draw.text((x + 8, header + height + 10), "Checkerboard inside numbered boxes is retained transparent/void geometry.", fill="black", font=font)
    path = poc_root / "reports" / "FLD-007_HOLE_REVIEW.png"
    sheet.save(path, format="PNG", optimize=False)

    result_geometry = {str(tolerance): {item["edgeId"]: item for item in case["results"][str(tolerance)]["geometry"]} for tolerance in TOLERANCES}
    rows = []
    for index, (source_hole, void) in enumerate(zip(source_holes, voids), start=1):
        edge_ids = [edge["edgeId"] for edge in graph["edges"] if edge.get("voidId") == void["voidId"]]
        row: dict[str, Any] = {"holeId": f"H{index:03d}", "voidId": void["voidId"], "originalArea": source_hole["area"], "bbox": source_hole["bbox"], "routes": {}}
        for version_index, tolerance in enumerate(TOLERANCES, start=1):
            matches = panels[version_index + 1][2]
            fallbacks = sorted({result_geometry[str(tolerance)][edge_id]["fallback"] for edge_id in edge_ids if result_geometry[str(tolerance)].get(edge_id, {}).get("fallback")})
            row["routes"][str(tolerance)] = {"retained": bool(matches[index - 1]["retained"]), "fallback": fallbacks or ["NONE"]}
        rows.append(row)

    # Dedicated same-box crops: largest principal hole and two smallest raster holes.
    selected = [("principal-hole", max(source_holes, key=lambda item: item["area"]))]
    selected.extend((f"small-hole-{idx + 1}", hole) for idx, hole in enumerate(sorted(source_holes, key=lambda item: (item["area"], item["componentId"]))[:2]))
    crop_images = [("Original", rendered["original"])] + [(f"V2 {tol:.1f} px", rendered[str(tol)]) for tol in TOLERANCES]
    crop_records = []
    for name, hole in selected:
        x, y, box_width, box_height = hole["bbox"]
        radius = max(24, min(80, max(box_width, box_height) + 16))
        box = (max(0, x - radius), max(0, y - radius), min(width, x + box_width + radius), min(height, y + box_height + radius))
        crop_path = poc_root / "reports" / "tolerance-crops" / "FLD-007" / f"{name}.png"
        _write_crop_sheet(crop_path, "FLD-007", name, crop_images, box)
        crop_records.append({"name": name, "path": str(crop_path.relative_to(poc_root)).replace("\\", "/"), "sha256": sha256(crop_path), "box": list(box)})
    return {"path": str(path.relative_to(poc_root)).replace("\\", "/"), "sha256": sha256(path), "holeCount": 29, "structuralZeroComponentCount": structural_zero_count, "principalVoidCount": principal_count, "allRetained": all(route["retained"] for row in rows for route in row["routes"].values()), "correspondence": rows, "crops": crop_records}


def generate_tolerance_review(benchmark_root: Path, poc_root: Path) -> dict[str, Any]:
    before = integrity_snapshot(benchmark_root, poc_root)
    if before["routeArtifactCount"] != 112 or before["inputArtifactCount"] != 32:
        raise ValueError(f"incomplete frozen evidence matrix: {before}")
    artifact_records = []
    metrics: dict[str, Any] = {"status": STATUS, "byCase": {}, "byProfile": {}, "overall": {}, "integrity": {"before": before}}
    loaded: dict[tuple[str, str], dict[str, Any]] = {}
    for profile in PROFILES:
        metrics["byCase"][profile] = {}
        for case_id in (f"FLD-{index:03d}" for index in range(1, 9)):
            case = _load_case(benchmark_root, poc_root, profile, case_id)
            loaded[(profile, case_id)] = case
            metrics["byCase"][profile][case_id] = {str(tolerance): _metric_record(case["results"][str(tolerance)]) for tolerance in TOLERANCES}
        metrics["byProfile"][profile] = {
            str(tolerance): _aggregate([metrics["byCase"][profile][case_id][str(tolerance)] for case_id in metrics["byCase"][profile]])
            for tolerance in TOLERANCES
        }
    metrics["overall"] = {
        str(tolerance): _aggregate([metrics["byCase"][profile][case_id][str(tolerance)] for profile in PROFILES for case_id in metrics["byCase"][profile]])
        for tolerance in TOLERANCES
    }

    rendered_by_case: dict[str, dict[str, np.ndarray]] = {}
    for case_id in FOCUS_CASES:
        case = loaded[(PRIMARY_PROFILE, case_id)]
        rendered = {"original": _composite_source(case["source"])}
        for tolerance in TOLERANCES:
            rendered[str(tolerance)] = render_vector(case["graph"], _geometry_map(case["results"][str(tolerance)]), case["colors"], scale=1)
        rendered_by_case[case_id] = rendered
        images = [("Original", rendered["original"])] + [(f"V2 {tolerance:.1f} px", rendered[str(tolerance)]) for tolerance in TOLERANCES]
        sheet_path = poc_root / "reports" / "tolerance-contact-sheets" / f"{case_id}.png"
        _write_four_column_sheet(sheet_path, case_id, images, case["results"])
        artifact_records.append({"kind": "FULL_CONTACT_SHEET", "caseId": case_id, "path": str(sheet_path.relative_to(poc_root)).replace("\\", "/"), "sha256": sha256(sheet_path)})
        for crop_name, fractions in CROP_SPECS.get(case_id, []):
            box = _crop_box((case["graph"]["width"], case["graph"]["height"]), fractions)
            crop_path = poc_root / "reports" / "tolerance-crops" / case_id / f"{crop_name}.png"
            _write_crop_sheet(crop_path, case_id, crop_name, images, box)
            artifact_records.append({"kind": "FOCUS_CROP", "caseId": case_id, "name": crop_name, "box": list(box), "path": str(crop_path.relative_to(poc_root)).replace("\\", "/"), "sha256": sha256(crop_path)})

    hole_review = _write_hole_review(benchmark_root, poc_root, loaded[(PRIMARY_PROFILE, "FLD-007")], rendered_by_case["FLD-007"])
    metrics["holeReview"] = hole_review
    artifact_records.append({"kind": "HOLE_REVIEW", "caseId": "FLD-007", "path": hole_review["path"], "sha256": hole_review["sha256"]})
    artifact_records.extend({"kind": "HOLE_FOCUS_CROP", "caseId": "FLD-007", **record} for record in hole_review["crops"])

    after = integrity_snapshot(benchmark_root, poc_root)
    metrics["integrity"]["after"] = after
    metrics["integrity"]["unchanged"] = before == after
    if before != after:
        raise RuntimeError(f"review generation modified frozen inputs or route artifacts: before={before}, after={after}")
    metrics["artifacts"] = artifact_records
    write_json(poc_root / "reports" / "V2_TOLERANCE_METRICS.json", metrics)
    _write_markdown(poc_root, metrics)
    return metrics


def _write_markdown(poc_root: Path, metrics: dict[str, Any]) -> None:
    lines = [
        "# P0-04C V2 Tolerance Review Evidence",
        "",
        f"Status: `{STATUS}`",
        "",
        "Visual evidence uses saved V2 geometry only. No fit, simplification, threshold, or hard-gate computation was rerun.",
        "",
        "## Full-scale review",
        "",
    ]
    for case_id in FOCUS_CASES:
        lines.extend([f"- [{case_id}](tolerance-contact-sheets/{case_id}.png)", ""])
    lines.extend(["## Aggregate metrics", ""])
    for profile in (*PROFILES, "ALL_16_CASE_PROFILES"):
        lines.extend([f"### {profile}", "", "| Tol | Median sym max | Max sym max | Median area error | Max area error | Lines | Cubics | Segments | Median fallback | Max fallback |", "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"])
        source = metrics["overall"] if profile == "ALL_16_CASE_PROFILES" else metrics["byProfile"][profile]
        for tolerance in TOLERANCES:
            item = source[str(tolerance)]
            lines.append(f"| {tolerance:.1f} | {item['medianSymmetricMax']:.6f} | {item['maxSymmetricMax']:.6f} | {item['medianAreaError']:.8f} | {item['maxAreaError']:.8f} | {item['totalLineCount']} | {item['totalCubicCount']} | {item['totalSegmentCount']} | {item['medianFallbackRatio']:.6f} | {item['maxFallbackRatio']:.6f} |")
        lines.append("")
    lines.extend(["## Per-case metrics", ""])
    for profile in PROFILES:
        lines.extend([f"### {profile}", "", "| Fixture | Tol | Sym max | Mean deviation | Area error | Lines | Cubics | Segments | Fallback | Ratio |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"])
        for case_id, values in metrics["byCase"][profile].items():
            for tolerance in TOLERANCES:
                item = values[str(tolerance)]
                lines.append(f"| {case_id} | {tolerance:.1f} | {item['symmetricMaxDeviation']:.6f} | {item['meanDeviation']:.6f} | {item['areaErrorRatio']:.8f} | {item['lineCount']} | {item['cubicCount']} | {item['totalSegmentCount']} | {item['fallbackCount']} | {item['fallbackRatio']:.6f} |")
        lines.append("")
    hole = metrics["holeReview"]
    lines.extend(["## FLD-007 hole correspondence", "", f"Dedicated image: [FLD-007_HOLE_REVIEW.png]({Path(hole['path']).name})", "", f"Structural holes: **{hole['holeCount']}**; retained across all saved V2 tolerances: **{'29/29' if hole['allRetained'] else 'INCOMPLETE'}**; structural zero components including exterior: **{hole['structuralZeroComponentCount']}**; B0 principal void diagnostic: **{hole['principalVoidCount']}**.", "", "| Hole | Area | BBox | 0.5 retained/fallback | 1.0 retained/fallback | 2.0 retained/fallback |", "|---|---:|---|---|---|---|"])
    for row in hole["correspondence"]:
        cells = []
        for tolerance in TOLERANCES:
            route = row["routes"][str(tolerance)]
            cells.append(f"{'YES' if route['retained'] else 'NO'} / {', '.join(route['fallback'])}")
        lines.append(f"| {row['holeId']} | {row['originalArea']} | {row['bbox']} | {cells[0]} | {cells[1]} | {cells[2]} |")
    lines.extend(["", "## Integrity", "", f"112 saved route artifacts unchanged: **{metrics['integrity']['unchanged']}**", "", f"Route aggregate SHA-256: `{metrics['integrity']['after']['routeArtifactAggregateSha256']}`", "", f"Input aggregate SHA-256: `{metrics['integrity']['after']['inputArtifactAggregateSha256']}`", "", f"Original case-metrics SHA-256: `{metrics['integrity']['after']['caseMetricsSha256']}`", "", "No tolerance decision is made by this report.", ""])
    text = "\n".join(lines)
    for forbidden in ("BEST", "WINNER", "PRODUCTION", "RECOMMENDED_TOLERANCE"):
        if forbidden in text.upper():
            raise ValueError(f"forbidden decision language in evidence report: {forbidden}")
    (poc_root / "reports" / "V2_TOLERANCE_REVIEW.md").write_text(text, encoding="utf-8", newline="\n")
