"""Same-scale visual review artifacts for V0/V1/V2 evidence."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from boundary_graph import build_boundary_graph, ring_polyline
from vector_contract import sha256, write_json

FOCUS_CASES = {
    "FLD-001": "Moon — long curves and tips",
    "FLD-002": "Red envelope — straight lines and explicit corners",
    "FLD-004": "Lotus lantern — curves and petal tips",
    "FLD-005": "Thin flame/fuse — narrow feature",
    "FLD-006": "Rabbit — smooth silhouette and ears",
    "FLD-007": "Hole fixture — outer contour and 29 raster holes",
    "FLD-008": "Lantern — arcs and straight structure",
}


def _checkerboard(width: int, height: int, cell: int = 16) -> np.ndarray:
    yy, xx = np.indices((height, width))
    tiles = ((xx // cell + yy // cell) % 2).astype(np.uint8)
    values = np.where(tiles[..., None] == 0, 238, 210).astype(np.uint8)
    return np.repeat(values, 3, axis=2)


def _composite_source(source: np.ndarray) -> np.ndarray:
    background = _checkerboard(source.shape[1], source.shape[0])
    alpha = source[..., 3:4].astype(np.float32) / 255.0
    return np.rint(source[..., :3] * alpha + background * (1.0 - alpha)).astype(np.uint8)


def _load_colors(case_root: Path) -> dict[int, tuple[int, int, int]]:
    with gzip.open(case_root / "regions.json.gz", "rt", encoding="utf-8") as handle:
        regions = json.load(handle)
    return {int(item["regionId"]): tuple(map(int, item["representativeColorRgb"])) for item in regions}


def _geometry_map(result: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {item["edgeId"]: item["segments"] for item in result["geometry"]}


def render_vector(
    graph: dict[str, Any], geometries: dict[str, list[dict[str, Any]]], colors: dict[int, tuple[int, int, int]], scale: int = 3
) -> np.ndarray:
    height, width = graph["height"] * scale, graph["width"] * scale
    output = _checkerboard(width, height, cell=16 * scale)
    label_canvas = np.zeros((height, width), dtype=np.int32)
    # Fill outer faces from largest to smallest so nested non-zero regions are
    # restored on top of their containers. Then clear only true zero-hole
    # rings; inner boundaries against another region must never erase it.
    outer_rings = sorted(
        (ring for ring in graph["_rings"] if ring["ringKind"] == "OUTER_RING"),
        key=lambda item: (-abs(float(item["signedAreaScreen"])), int(item["regionId"]), item["ringId"]),
    )
    for ring in outer_rings:
        points = ring_polyline(graph, ring, geometries, 0.0625)
        polygon = np.rint(np.asarray(points, dtype=np.float64) * scale).astype(np.int32)
        cv2.fillPoly(label_canvas, [polygon], int(ring["regionId"]), lineType=cv2.LINE_8)
    for ring in graph["_rings"]:
        if ring["ringKind"] != "INNER_RING":
            continue
        edge_records = [graph["_edgeById"][reference["edgeId"]] for reference in ring["edgeReferences"]]
        if not edge_records or not all(edge["boundaryType"] == "HOLE" for edge in edge_records):
            continue
        points = ring_polyline(graph, ring, geometries, 0.0625)
        polygon = np.rint(np.asarray(points, dtype=np.float64) * scale).astype(np.int32)
        cv2.fillPoly(label_canvas, [polygon], 0, lineType=cv2.LINE_8)
    for region_id in sorted(colors):
        output[label_canvas == region_id] = colors[region_id]
    return output


def _fit_panel(image: np.ndarray, size: tuple[int, int]) -> Image.Image:
    panel = Image.new("RGB", size, "white")
    source = Image.fromarray(image, mode="RGB")
    source.thumbnail((size[0] - 16, size[1] - 16), Image.Resampling.LANCZOS)
    panel.paste(source, ((size[0] - source.width) // 2, (size[1] - source.height) // 2))
    return panel


def _metric_line(result: dict[str, Any]) -> str:
    geometry = result["metrics"]["geometry"]
    complexity = result["metrics"]["complexity"]
    return (
        f"Gate={'PASS' if result['hardGate']['pass'] else 'FAIL'}  "
        f"Dev={geometry['symmetricMaxBoundaryDeviation']:.3f}px  "
        f"Area={geometry['areaErrorRatio']:.5f}  "
        f"L/C={complexity['outputLineCount']}/{complexity['outputCubicSegmentCount']}  "
        f"Fallback={complexity['fallbackCount']}"
    )


def generate_reviews(benchmark_root: Path, poc_root: Path) -> dict[str, Any]:
    profile = "cp-b-aggressive_rc-a"
    tolerance_dir = "tol-1p0"
    output_dir = poc_root / "reports" / "contact-sheets"
    output_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for case_id, description in FOCUS_CASES.items():
        source = np.asarray(Image.open(benchmark_root / "fixtures" / "source" / f"{case_id}.png").convert("RGBA"))
        case_root = benchmark_root / "outputs" / "color-purification" / profile / case_id
        labels = np.load(case_root / "structural_label_map.npz")["labels"]
        graph = build_boundary_graph(labels, source[..., 3])
        colors = _load_colors(case_root)
        result_root = poc_root / "outputs" / profile / case_id
        paths = {
            "V0 Pixel Boundary": result_root / "V0" / "result.json",
            "V1 Polygon": result_root / "V1" / tolerance_dir / "result.json",
            "V2 Smooth Vector": result_root / "V2" / tolerance_dir / "result.json",
        }
        results = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in paths.items()}
        images = {"Original": _composite_source(source)}
        images.update({name: render_vector(graph, _geometry_map(result), colors) for name, result in results.items()})
        panel_size = (420, 420)
        header_height, footer_height = 54, 54
        sheet = Image.new("RGB", (panel_size[0] * 4, header_height + panel_size[1] + footer_height), "white")
        draw = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
        for index, (name, image) in enumerate(images.items()):
            x = index * panel_size[0]
            draw.text((x + 10, 8), name, fill="black", font=font)
            draw.text((x + 10, 26), f"{case_id} — {description}", fill=(70, 70, 70), font=font)
            sheet.paste(_fit_panel(image, panel_size), (x, header_height))
            if name == "Original":
                metric = "Frozen source; structural label geometry is unchanged"
            else:
                metric = _metric_line(results[name])
            draw.text((x + 10, header_height + panel_size[1] + 12), metric, fill="black", font=font)
        path = output_dir / f"{case_id}.png"
        sheet.save(path, format="PNG", optimize=False)
        records.append({"caseId": case_id, "description": description, "path": str(path.relative_to(poc_root)).replace("\\", "/"), "sha256": sha256(path)})

    lines = [
        "# P0-04C Vector Edge Smoothing Review Index",
        "",
        "Status: `POC_EVIDENCE_COMPLETE_PENDING_EXTERNAL_VECTOR_REVIEW`.",
        "",
        "V1/V2 panels use the non-frozen 1.0 px comparison setting. No route or tolerance is selected automatically.",
        "",
    ]
    for record in records:
        lines.extend([f"## {record['caseId']} — {record['description']}", "", f"![{record['caseId']}]({record['path']})", ""])
    (poc_root / "reports" / "REVIEW_INDEX.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
    write_json(poc_root / "reports" / "review-artifacts.json", {"status": "PENDING_EXTERNAL_VECTOR_REVIEW", "contactSheets": records})
    return {"contactSheets": records}


def write_summary_markdown(poc_root: Path) -> None:
    summary = json.loads((poc_root / "reports" / "summary.json").read_text(encoding="utf-8"))
    metrics = json.loads((poc_root / "reports" / "case-metrics.json").read_text(encoding="utf-8"))["cases"]
    rows = [item for group in metrics for item in group]
    lines = [
        "# P0-04C Label-to-Vector Edge Smoothing PoC",
        "",
        f"Status: `{summary['status']}`",
        "",
        f"V0 byte-identical: {summary['v0ByteIdenticalCount']}/{summary['caseProfileCount']}",
        "",
        "No V1/V2 winner or production tolerance is selected.",
        "",
        "| Profile | Case | Route | Tol px | Hard Gate | Symmetric max px | Area error | Lines | Cubics | Fallbacks |",
        "|---|---|---|---:|---|---:|---:|---:|---:|---:|",
    ]
    for item in rows:
        geometry = item["metrics"]["geometry"]
        complexity = item["metrics"]["complexity"]
        lines.append(
            f"| {item['profile']} | {item['caseId']} | {item['route']} | {item['tolerancePx'] if item['tolerancePx'] is not None else '-'} | "
            f"{'PASS' if item['hardGate']['pass'] else 'FAIL'} | {geometry['symmetricMaxBoundaryDeviation']:.6f} | "
            f"{geometry['areaErrorRatio']:.8f} | {complexity['outputLineCount']} | {complexity['outputCubicSegmentCount']} | {complexity['fallbackCount']} |"
        )
    lines.extend(
        [
            "",
            "## Safety interpretation",
            "",
            "All shared boundaries are fitted once and referenced by direction. Any ambiguous curve is locally downgraded V2→V1→V0. FLD-007 retains all 29 structural zero-component holes; the six B0 principal voids remain a separate diagnostic and no small hole is deleted.",
            "",
            "## External decision required",
            "",
            "Review the same-scale contact sheets for smoothness, tip/corner retention, thin features, and hand-cut suitability. This PoC does not promote either route to Production.",
        ]
    )
    (poc_root / "reports" / "LABEL_TO_VECTOR_POC_SUMMARY.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
