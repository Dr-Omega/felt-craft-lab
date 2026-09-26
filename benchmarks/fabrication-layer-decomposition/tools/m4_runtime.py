"""M4 runtime adapter over the frozen color, region, and vector kernels.

This module intentionally owns orchestration and runtime provenance only.  It
does not change the CP-B, RC-A, Region Core, or P0-04C algorithms.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import html
import importlib.util
import io
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from types import SimpleNamespace

import numpy as np
from PIL import Image, ImageDraw


BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BENCHMARK_ROOT.parents[1]
COLOR_ROOT = BENCHMARK_ROOT / "candidates" / "color-purification"
REGION_ROOT = BENCHMARK_ROOT / "region-core"
VECTOR_ROOT = BENCHMARK_ROOT / "vector-edge-smoothing"
for source_root in (COLOR_ROOT / "src", REGION_ROOT / "src", VECTOR_ROOT / "src"):
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))

from color_purification import (  # noqa: E402
    apply_representatives,
    get_candidate,
    label_map_preview,
    metrics_for_run,
)
from frozen_contract import (  # noqa: E402
    four_connected_components,
    perimeter_and_adjacency,
    void_topology,
)
from bezier_fit import fit_chain, flatten_segments  # noqa: E402
from boundary_graph import build_boundary_graph, serialize_graph  # noqa: E402
from geometry_validation import aggregate_deviation, validate_embedding  # noqa: E402
from polygon_simplify import exact_line_segments, simplify_chain  # noqa: E402
# The colour PoC also has a runner.py. Load this adapter dependency by exact
# path, leaving a caller's existing sys.modules['runner'] untouched.
_runner_spec = importlib.util.spec_from_file_location('_m4_frozen_vector_runner', VECTOR_ROOT / 'src' / 'runner.py')
_vector_runner = importlib.util.module_from_spec(_runner_spec)
_runner_spec.loader.exec_module(_vector_runner)
ROUTE_V0, ROUTE_V1, ROUTE_V2 = _vector_runner.ROUTE_V0, _vector_runner.ROUTE_V1, _vector_runner.ROUTE_V2
_enforce_continuous_bound = _vector_runner._enforce_continuous_bound
_result, _stabilize = _vector_runner._result, _vector_runner._stabilize
from m4_checks import validate_labels, candidate_polygons, render_polygons


PROFILE_TO_RUNTIME_ID = {
    "aggressive": "cp-b-aggressive_rc-a",
    "balanced": "cp-b-balanced_rc-a",
}
SUPPORTED_IMAGE_SUFFIXES = {".png"}
PROTECTED_RELATIVE_ROOTS = (
    Path("benchmarks/background-removal"),
    Path("benchmarks/fabrication-layer-decomposition/fixtures"),
    Path("benchmarks/fabrication-layer-decomposition/candidates"),
    Path("benchmarks/fabrication-layer-decomposition/schemas"),
    Path("benchmarks/fabrication-layer-decomposition/region-core"),
    Path("benchmarks/fabrication-layer-decomposition/vector-edge-smoothing"),
    Path("benchmarks/fabrication-layer-decomposition/fabrication-decomposition"),
    Path("benchmarks/fabrication-layer-decomposition/outputs"),
    Path("benchmarks/fabrication-layer-decomposition/reports"),
)


class M4RuntimeError(ValueError):
    """A caller-visible hard-contract failure."""


__all__ = ["M4RuntimeError", "run_runtime"]


@dataclass(frozen=True)
class NormalizedForeground:
    rgba: np.ndarray
    provenance: dict[str, Any]
    source_bytes: bytes = b''
    mask_bytes: bytes | None = None


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def validate_output_root(output_root: Path, input_paths: list[Path]) -> Path:
    resolved = output_root.resolve()
    for relative in PROTECTED_RELATIVE_ROOTS:
        protected = (REPOSITORY_ROOT / relative).resolve()
        if _within(resolved, protected):
            raise M4RuntimeError(f"output directory is protected: {resolved}")
    for input_path in input_paths:
        source = input_path.resolve()
        if resolved == source or _within(source, resolved):
            raise M4RuntimeError(f"output directory must be isolated from input: {source}")
    if resolved.exists() and any(resolved.iterdir()):
        raise M4RuntimeError(f"output directory must be absent or empty: {resolved}")
    return resolved


def load_foreground(
    image_path: Path,
    *,
    mode: str,
    mask_path: Path | None,
    foreground_source: str,
    manual_confirmation: str,
    whole_image_foreground: bool = False,
) -> NormalizedForeground:
    image_path = image_path.resolve()
    if image_path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
        raise M4RuntimeError("runtime currently supports PNG input only")
    if manual_confirmation not in {"CONFIRMED", "PENDING_REVIEW"}:
        raise M4RuntimeError("manual confirmation must be CONFIRMED or PENDING_REVIEW")
    source_bytes = image_path.read_bytes()
    with Image.open(io.BytesIO(source_bytes)) as decoded:
        if decoded.format != 'PNG' or getattr(decoded, 'n_frames', 1) != 1:
            raise M4RuntimeError('only single-frame PNG decoding is supported')
        if decoded.getexif().get(274, 1) != 1:
            raise M4RuntimeError('non-identity EXIF orientation is unsupported')
        source_mode = decoded.mode
        rgba = np.asarray(decoded.convert("RGBA"), dtype=np.uint8).copy()
    source_alpha = rgba[..., 3].copy()
    has_non_opaque_alpha = bool(np.any(source_alpha != 255))
    mask_record = None
    mask_bytes = None
    if mode == "embedded-alpha":
        if mask_path is not None:
            raise M4RuntimeError("embedded-alpha mode does not accept an external mask")
        if not has_non_opaque_alpha and not whole_image_foreground:
            raise M4RuntimeError("fully opaque input requires an explicit whole-image-foreground declaration")
        interpretation = "DECODED_EMBEDDED_ALPHA" if has_non_opaque_alpha else "CALLER_DECLARED_WHOLE_IMAGE_FOREGROUND"
    elif mode == "external-mask":
        if mask_path is None:
            raise M4RuntimeError("external-mask mode requires --mask")
        mask_path = mask_path.resolve()
        mask_bytes = mask_path.read_bytes()
        with Image.open(io.BytesIO(mask_bytes)) as decoded_mask:
            if mask_path.suffix.lower() != '.png' or decoded_mask.format != 'PNG' or getattr(decoded_mask, 'n_frames', 1) != 1:
                raise M4RuntimeError('external mask supports only single-frame PNG')
            if decoded_mask.getexif().get(274, 1) != 1:
                raise M4RuntimeError('external mask non-identity EXIF orientation is unsupported')
            if decoded_mask.mode != "L":
                raise M4RuntimeError("external mask must be a single-channel 8-bit image (mode L)")
            mask = np.asarray(decoded_mask, dtype=np.uint8).copy()
        if mask.shape != rgba.shape[:2]:
            raise M4RuntimeError(f"external mask dimensions {mask.shape[::-1]} do not match image {rgba.shape[1::-1]}")
        if has_non_opaque_alpha:
            raise M4RuntimeError("ambiguous dual alpha sources are rejected; no combination policy is defined")
        rgba[..., 3] = mask
        interpretation = "CALLER_PROVIDED_EXTERNAL_MASK_AS_EFFECTIVE_ALPHA"
        mask_record = {
            "path": str(mask_path),
            "sha256": _sha256_bytes(mask_bytes),
            "mode": "L",
            "softAlphaPreserved": bool(np.any((mask > 0) & (mask < 255))),
        }
    else:
        raise M4RuntimeError("foreground mode must be embedded-alpha or external-mask")
    if not np.any(rgba[..., 3] > 0):
        raise M4RuntimeError("effective foreground is empty")
    provenance = {
        "sourceImage": {
            "path": str(image_path),
            "sha256": _sha256_bytes(source_bytes),
            "decodedMode": source_mode,
            "width": int(rgba.shape[1]),
            "height": int(rgba.shape[0]),
        },
        "foregroundMode": mode,
        "foregroundSource": foreground_source,
        "manualConfirmation": manual_confirmation,
        "foregroundInterpretation": interpretation,
        "wholeImageForegroundDeclared": bool(whole_image_foreground),
        "externalMask": mask_record,
        "automaticBackgroundRemovalEvaluated": False,
    }
    return NormalizedForeground(rgba=rgba, provenance=provenance, source_bytes=source_bytes, mask_bytes=mask_bytes)


def load_profile(profile: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if profile not in PROFILE_TO_RUNTIME_ID:
        raise M4RuntimeError("profile must be aggressive or balanced")
    profiles_path = COLOR_ROOT / "configs" / "profiles.json"
    vector_path = VECTOR_ROOT / "configs" / "poc.v1.json"
    return (
        json.loads(profiles_path.read_text(encoding="utf-8"))[profile],
        json.loads(vector_path.read_text(encoding="utf-8")),
    )


def _vectorize(labels: np.ndarray, alpha: np.ndarray, runtime_id: str, profile_id: str, config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    # P0-04C audits the alpha supplied to it as the exact geometry domain.  M4
    # deliberately excludes low-alpha fringe from structural geometry, so the
    # adapter supplies the structural occupancy alpha while retaining the
    # effective foreground alpha independently in the M4 report.
    structural_alpha = np.where(labels > 0, 255, 0).astype(np.uint8)
    graph = build_boundary_graph(labels, structural_alpha)
    graph["runtimeAlphaAudit"] = {
        "effectiveForegroundNonzeroPixelCount": int(np.count_nonzero(alpha > 0)),
        "structuralGeometryPixelCount": int(np.count_nonzero(labels > 0)),
        "excludedFringePixelCount": int(np.count_nonzero((alpha > 0) & (labels == 0))),
    }
    flatness = float(config["bezier"]["validationFlatnessPx"])
    tolerance = 0.5
    input_sha = _sha256_bytes(labels.astype("<i4", copy=False).tobytes(order="C"))
    exact = {edge["edgeId"]: exact_line_segments(edge) for edge in graph["edges"]}

    v0_validation = validate_embedding(graph, labels, exact, flatness)
    if not np.array_equal(v0_validation["raster"], labels):
        raise M4RuntimeError("V0 exact structural-label round trip is not byte-identical")
    v0, _ = _result(runtime_id, profile_id, ROUTE_V0, None, input_sha, graph, labels, exact, {}, {}, copy.deepcopy(v0_validation), flatness)
    v0["hardGate"]["byteIdenticalLabelRoundTrip"] = bool(np.array_equal(v0_validation["raster"], labels))

    v1_diagnostics: dict[str, dict[str, Any]] = {}
    v1_raw: dict[str, list[dict[str, Any]]] = {}
    for edge in graph["edges"]:
        v1_raw[edge["edgeId"]], v1_diagnostics[edge["edgeId"]] = simplify_chain(edge, tolerance, config["cornerDetection"])
    v1, v1_fallbacks, v1_validation = _stabilize(graph, labels, v1_raw, [exact], flatness, ROUTE_V1)
    v1, v1_deviation = _enforce_continuous_bound(graph, v1, [exact], tolerance, flatness, v1_fallbacks, ROUTE_V1)
    v1, extra, v1_validation = _stabilize(graph, labels, v1, [exact], flatness, ROUTE_V1)
    v1_fallbacks.update(extra)
    if extra:
        v1_deviation = aggregate_deviation(graph, v1, flatness)
    v1_result, _ = _result(runtime_id, profile_id, ROUTE_V1, tolerance, input_sha, graph, labels, v1, v1_diagnostics, v1_fallbacks, copy.deepcopy(v1_validation), flatness, v1_deviation)

    v2_diagnostics: dict[str, dict[str, Any]] = {}
    v2_raw: dict[str, list[dict[str, Any]]] = {}
    for edge in graph["edges"]:
        try:
            v2_raw[edge["edgeId"]], v2_diagnostics[edge["edgeId"]] = fit_chain(edge, tolerance, config["cornerDetection"], config["bezier"])
        except (np.linalg.LinAlgError, FloatingPointError) as error:
            # Only numerical fit failures are recoverable. Malformed geometry,
            # missing references and arbitrary implementation exceptions escape.
            v2_raw[edge['edgeId']] = v1[edge['edgeId']]
            v2_diagnostics[edge['edgeId']] = {'recoverableFitFailure': type(error).__name__, 'fallbackRoute': ROUTE_V1}
    v2, v2_fallbacks, v2_validation = _stabilize(graph, labels, v2_raw, [v1, exact], flatness, ROUTE_V2)
    v2, v2_deviation = _enforce_continuous_bound(graph, v2, [v1, exact], tolerance, flatness, v2_fallbacks, ROUTE_V2)
    v2, extra, v2_validation = _stabilize(graph, labels, v2, [v1, exact], flatness, ROUTE_V2)
    v2_fallbacks.update(extra)
    if extra:
        v2_deviation = aggregate_deviation(graph, v2, flatness)
    v2_result, _ = _result(runtime_id, profile_id, ROUTE_V2, tolerance, input_sha, graph, labels, v2, v2_diagnostics, v2_fallbacks, copy.deepcopy(v2_validation), flatness, v2_deviation)

    attempted = [ROUTE_V2, ROUTE_V1, ROUTE_V0]
    for result in (v2_result, v1_result, v0):
        if result["hardGate"]["pass"]:
            return graph, result, attempted[: attempted.index(result["route"]) + 1]
    raise M4RuntimeError("no V2 -> V1 -> V0 vector route passed the existing hard gate")


def _runtime_regions(structural: np.ndarray, region_metadata: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    components = four_connected_components(structural)
    perimeter, adjacency = perimeter_and_adjacency(structural)
    by_id = {int(item["regionId"]): item for item in region_metadata}
    records = []
    for region_id in sorted(components):
        record = {key: value for key, value in by_id[region_id].items() if key not in {"componentCount"}}
        component_records = []
        for index, component in enumerate(components[region_id], start=1):
            component_records.append({**component, "componentId": f"R{region_id:05d}-C{index:03d}"})
        record.update({"componentCount": len(component_records), "components": component_records, "perimeterEdgeCount": perimeter[region_id]})
        records.append(record)
    return records, adjacency


def _observed_candidates(runtime_id: str, graph: dict[str, Any], vector_result: dict[str, Any], regions: list[dict[str, Any]], attempted: list[str]) -> list[dict[str, Any]]:
    graph_regions = {int(item["regionId"]): item for item in graph["regions"]}
    region_by_id = {int(item["regionId"]): item for item in regions}
    vector_by_id = {item["edgeId"]: item for item in vector_result["geometry"]}
    candidates = []
    for region_id, graph_region in sorted(graph_regions.items()):
        runtime_components = region_by_id[region_id]["components"]
        if len(runtime_components) != len(graph_region["components"]):
            raise M4RuntimeError(f"Region {region_id} component identity differs between Region Core and boundary graph")
        by_component = {c['componentId']: c for c in runtime_components}
        if len(by_component) != len(runtime_components):
            raise M4RuntimeError('duplicate runtime Component identity')
        for component in graph_region["components"]:
            runtime_component = by_component.get(component['componentId'])
            if runtime_component is None or 'pixelDomainSha256' not in runtime_component:
                raise M4RuntimeError(f"Region {region_id} component reference mismatch")
            rings = [component["outerRing"], *component.get("innerRings", [])]
            edge_ids = sorted({ref["edgeId"] for ring in rings for ref in ring["edgeReferences"]})
            if any(edge_id not in vector_by_id for edge_id in edge_ids):
                raise M4RuntimeError("observed candidate references a missing vector edge")
            candidates.append({
                "candidateId": f"OC-{runtime_id}-{component['componentId']}",
                "identitySemantics": "OBSERVED_COMPONENT_CANDIDATE_NOT_FORMAL_PIECE",
                "sourceRegionId": region_id,
                "sourceComponentId": component["componentId"],
                "sourcePixelDomainSha256": runtime_component['pixelDomainSha256'],
                "sourceComponentKey": {"runtimeId": runtime_id, "regionId": region_id, "componentId": component["componentId"]},
                "coordinateSystem": "source-pixel boundary grid",
                "unit": "source_pixel",
                "observedGeometry": {"outerRing": component["outerRing"], "innerRings": component.get("innerRings", []), "edgeIds": edge_ids},
                "vectorRoute": vector_result["route"],
                "toleranceSourcePixels": vector_result.get("tolerancePx"),
                "attemptedVectorRoutes": attempted,
                "representativeColor": {
                    "method": "RC-A",
                    "rgb": region_by_id[region_id]["representativeColorRgb"],
                    "lab": region_by_id[region_id]["representativeColorLab"],
                },
                "inferredGeometry": None,
                "finalCutGeometry": None,
                "baseAssignment": None,
                "layerOrder": None,
                "assembly": None,
                "manufacturingReadiness": "NOT_READY_OBSERVED_ONLY",
                "productionExportEligible": False,
            })
    return candidates


def _save_png(path: Path, rgba: np.ndarray) -> None:
    Image.fromarray(rgba, "RGBA").save(path)


def _numbered_preview(structural: np.ndarray, *, components: bool, regions=None) -> np.ndarray:
    import cv2

    preview = label_map_preview(structural)
    image = Image.fromarray(preview, "RGBA")
    draw = ImageDraw.Draw(image)
    for region_id in (int(value) for value in np.unique(structural) if value > 0):
        region_mask = structural == region_id
        if components:
            count, component_labels = cv2.connectedComponents(region_mask.astype(np.uint8), connectivity=4)
            masks = [component_labels == component_id for component_id in range(1, count)]
            masks.sort(key=lambda mask: int(np.flatnonzero(mask)[0]))
            actual = next(item for item in regions if int(item['regionId']) == region_id)['components']
            if len(actual) != len(masks):
                raise M4RuntimeError('preview Component count differs from actual records')
            items = []
            ordinals = [r['rasterScanOrdinal'] for r in actual]
            if sorted(ordinals) != list(range(1, len(masks)+1)):
                raise M4RuntimeError('preview Component raster mapping is not bijective')
            for record in actual:
                mask = masks[record['rasterScanOrdinal']-1]
                ys, xs = np.where(mask)
                bbox = [int(xs.min()), int(ys.min()), int(xs.max()-xs.min()+1), int(ys.max()-ys.min()+1)]
                if bbox != record['bbox'] or int(mask.sum()) != record['area']:
                    raise M4RuntimeError('preview Component identity differs from actual record')
                items.append((record['componentId'], mask))
        else:
            items = [(None, region_mask)]
        for component_id, mask in items:
            ys, xs = np.where(mask)
            if len(xs) == 0:
                continue
            x, y = int(np.median(xs)), int(np.median(ys))
            label = f"R{region_id:05d}" if component_id is None else component_id
            box = draw.textbbox((x, y), label, anchor="mm")
            draw.rectangle((box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1), fill=(0, 0, 0, 190))
            draw.text((x, y), label, fill=(255, 255, 255, 255), anchor="mm")
    return np.asarray(image)


def _vector_overlay(source: np.ndarray, vector_result: dict[str, Any], flatness: float) -> np.ndarray:
    image = Image.fromarray(source, "RGBA")
    draw = ImageDraw.Draw(image)
    for geometry in vector_result["geometry"]:
        points = flatten_segments(geometry["segments"], flatness)
        if len(points) >= 2:
            draw.line(points, fill=(0, 255, 255, 255), width=1)
    return np.asarray(image)


def _png_data_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _write_html(output: Path, report: dict[str, Any]) -> None:
    cards = []
    for title, filename in (
        ("Input foreground", "input-foreground.png"),
        ("Purified RGBA", "purified.png"),
        ("Region IDs", "region-labels.png"),
        ("4-connected Components", "components.png"),
        ("Selected vector boundary", "vector-overlay.png"),
        ("Observed candidates", "observed-candidates.png"),
    ):
        cards.append(f'<figure><h2>{html.escape(title)}</h2><img src="{_png_data_uri(output / filename)}" alt="{html.escape(title)}"></figure>')
    warnings = "".join(f"<li>{html.escape(item)}</li>" for item in report["review"]["items"])
    stage_rows = "".join(
        f"<tr><td>{html.escape(name)}</td><td>{html.escape(str(stage['status']))}</td><td>{stage['durationMs']:.3f}</td></tr>"
        for name, stage in report["stages"].items()
    )
    document = f"""<!doctype html><meta charset="utf-8"><title>M4 runtime {html.escape(report['runtimeId'])}</title>
<style>body{{font:14px system-ui;margin:24px;background:#1d1f24;color:#eee}}main{{max-width:1200px;margin:auto}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}}figure{{margin:0;padding:12px;background:#292d35;border-radius:8px}}img{{width:100%;image-rendering:auto;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0/20px 20px}}table{{border-collapse:collapse}}td,th{{padding:6px 10px;border:1px solid #666}}code{{overflow-wrap:anywhere}}</style>
<main><h1>M4 color purification runtime — audit candidate</h1><p>Status: <b>{html.escape(report['status'])}</b>; quality: <b>{html.escape(report['review']['status'])}</b></p>
<p>Input SHA-256: <code>{report['input']['sourceImage']['sha256']}</code><br>Profile: <code>{html.escape(report['configuration']['runtimeProfileId'])}</code><br>Output: observed-only; production export is not eligible.</p>
<h2>Warnings and review</h2><ul>{warnings}</ul><h2>Stages</h2><table><tr><th>Stage</th><th>Status</th><th>ms</th></tr>{stage_rows}</table>
<section class="grid">{''.join(cards)}</section><h2>Counts</h2><pre>{html.escape(json.dumps(report['counts'], ensure_ascii=False, indent=2))}</pre></main>"""
    (output / "index.html").write_text(document, encoding="utf-8", newline="\n")


def _run_runtime(
    foreground: NormalizedForeground,
    *,
    runtime_id: str,
    profile: str,
    output_root: Path,
    quality_mode: str = 'baseline',
    foreground_cleanup: bool = False,
    design_color_request: dict | None = None,
) -> dict[str, Any]:
    if not runtime_id or runtime_id.startswith("FLD-"):
        raise M4RuntimeError("runtime ID must be non-empty and separate from the frozen FLD fixture ID space")
    output_root.mkdir(parents=True, exist_ok=True)
    stages: dict[str, dict[str, Any]] = {}
    current_stage = 'configuration'

    def timed(name: str, operation: Any) -> Any:
        nonlocal current_stage
        current_stage = name
        started = time.perf_counter()
        value = operation()
        stages[name] = {"status": "PASS", "durationMs": round((time.perf_counter() - started) * 1000.0, 3)}
        return value

    color_config, vector_config = load_profile(profile)
    rgba = foreground.rgba
    quality = None
    baseline_analysis = None
    original_rgba = rgba.copy()
    try:
        proposal = timed("cpBProposal", lambda: get_candidate("CP-B").propose(rgba, color_config))
        if quality_mode != 'baseline':
            # Optional experimental design B. Frozen proposal A is retained,
            # never overwritten or relabeled as an accepted design.
            quality_root = str(BENCHMARK_ROOT / 'algorithm-v1')
            if quality_root not in sys.path:
                sys.path.insert(0, quality_root)
            from quality_fragments import propose_foreground_cleanup, refine_selection
            baseline_purified, baseline_metadata = apply_representatives(
                rgba, proposal.structural_label_map, 'RC-A', color_config, proposal.pixel_label_map)
            baseline_analysis = (proposal.structural_label_map.copy(), proposal.pixel_label_map.copy(),
                                 baseline_purified, baseline_metadata)
            design_mode = quality_mode in {'design-colors', 'design-cleanup'}
            if design_mode:
                from design_color_regions import cleanup_foreground, rebuild_regions
                rgba, cleanup = timed('experimentalForegroundProposal', lambda: cleanup_foreground(
                    original_rgba, color_config, design_color_request, enabled=foreground_cleanup))
            else:
                rgba, cleanup = timed('experimentalForegroundProposal', lambda: propose_foreground_cleanup(
                    original_rgba, enabled=foreground_cleanup))
            if not np.array_equal(rgba, original_rgba):
                proposal = timed('derivedForegroundCpB', lambda: get_candidate('CP-B').propose(rgba, color_config))
            if quality_mode == 'design-colors':
                structural, pixels, refinement = timed('experimentalSelection', lambda: rebuild_regions(
                    rgba, proposal.structural_label_map, proposal.pixel_label_map, color_config, design_color_request))
            else:
                structural, pixels, refinement = timed('experimentalSelection', lambda: refine_selection(
                    rgba, proposal.structural_label_map, proposal.pixel_label_map, color_config,
                    enabled=quality_mode in {'selection', 'combined'}))
            proposal = SimpleNamespace(structural_label_map=structural, pixel_label_map=pixels)
            quality = {'schemaVersion': 'application-quality-design/1', 'mode': quality_mode,
                       'foregroundCleanupEnabled': foreground_cleanup, 'cleanup': cleanup,
                       'selection': refinement, 'sourceSha256': foreground.provenance['sourceImage']['sha256'],
                       'originalEffectiveRgbaSha256': _sha256_bytes(original_rgba.tobytes()),
                       'derivedEffectiveRgbaSha256': _sha256_bytes(rgba.tobytes()),
                       'humanConfirmation': 'PENDING_REVIEW', 'frozenEvidence': False}
            if design_mode:
                quality['designColorRequest'] = design_color_request
        purified, metadata = timed(
            "rcARepresentativeAssignment",
            lambda: apply_representatives(rgba, proposal.structural_label_map, "RC-A", color_config, proposal.pixel_label_map),
        )
        if not np.array_equal(rgba[..., 3], purified[..., 3]):
            raise M4RuntimeError("purified alpha differs from effective foreground alpha")
        label_validation = timed('independentLabelValidation', lambda: validate_labels(
            rgba, purified, proposal.structural_label_map, proposal.pixel_label_map, metadata, color_config))
        regions, adjacency = timed("regionAndComponentDerivation", lambda: _runtime_regions(proposal.structural_label_map, metadata))
        graph, vector_result, attempted = timed(
            "boundaryAndVectorDerivation",
            lambda: _vectorize(proposal.structural_label_map, rgba[..., 3], runtime_id, PROFILE_TO_RUNTIME_ID[profile], vector_config),
        )
        from component_binding import bind_components
        regions, component_binding = timed('componentDomainBinding', lambda: bind_components(
            proposal.structural_label_map, graph, regions))
        if quality is not None:
            from quality_contours import refine_contours
            vector_result, quality['contours'] = timed('experimentalSharedContours', lambda: refine_contours(
                graph, vector_result, proposal.structural_label_map, vector_config,
                enabled=quality_mode in {'contour', 'combined', 'design-colors'},
                point_touch_cycles=quality_mode == 'design-colors'))
            # This is a new selected geometry, not a claim to frozen P0-04C evidence.
            attempted = list(dict.fromkeys([vector_result['route'], *attempted]))
        candidates = timed("observedCandidateDerivation", lambda: _observed_candidates(runtime_id, graph, vector_result, regions, attempted))
        geometry_objects = timed('selectedGeometryValidation', lambda: candidate_polygons(
            candidates, graph, vector_result, float(vector_config['bezier']['validationFlatnessPx']),
            point_touch_cycles=quality_mode == 'design-colors'))
        if quality_mode == 'design-colors':
            quality['pointTouchMaterialization'] = [
                {'candidateId': item['id'], **item['boundaryProvenance']['pointTouchMaterialization']}
                for item in geometry_objects if 'pointTouchMaterialization' in item['boundaryProvenance']]
        metrics = timed('diagnosticMetrics', lambda: metrics_for_run(rgba, proposal.structural_label_map, purified, color_config, None, pixel_label_map=proposal.pixel_label_map, regions=metadata))
    except Exception as error:
        failure = {
            "runtimeId": runtime_id,
            "status": "HARD_CONTRACT_FAILED",
            "failedStage": current_stage,
            "errorType": type(error).__name__,
            "error": str(error),
            "completedStages": stages,
            "downstreamStopped": True,
        }
        (output_root / "failure.json").write_bytes(_canonical_json(failure))
        if quality is not None and current_stage == 'selectedGeometryValidation':
            # Failed design evidence, never a completed runtime or accepted
            # Piece plan. Keep actual computed labels/geometry for inspection.
            diagnostics = output_root / 'failure-diagnostics'
            try:
                diagnostics.mkdir(exist_ok=False)
                _save_png(diagnostics / 'input-foreground.png', rgba)
                _save_png(diagnostics / 'purified.png', purified)
                _save_png(diagnostics / 'baseline-purified.png', baseline_analysis[2])
                _save_png(diagnostics / 'vector-overlay.png', _vector_overlay(
                    purified, vector_result, float(vector_config['bezier']['validationFlatnessPx'])))
                np.savez_compressed(diagnostics / 'structural_label_map.npz',
                                    labels=proposal.structural_label_map.astype(np.int32))
                for name, value in [('boundary-graph.json', serialize_graph(graph)),
                                    ('vector-result.json', vector_result),
                                    ('experimental-design.json', quality), ('regions.json', regions)]:
                    (diagnostics / name).write_bytes(_canonical_json(value))
                (diagnostics / 'diagnostics.json').write_bytes(_canonical_json({
                    'status': 'FAILED_NOT_ACCEPTED_GEOMETRY', 'failure': failure,
                    'source': foreground.provenance, 'humanVisualAcceptance': 'PENDING',
                    'downstreamPiecesExist': False, 'productionExportEligible': False}))
            except Exception as diagnostic_error:
                # Preserve the original contract failure as well as a separate
                # diagnostic write error; never replace either with COMPLETE.
                raise M4RuntimeError(f'{error}; failed diagnostic write at {diagnostics}: {diagnostic_error}') from error
        raise

    # Keep actual completed computation stages if any subsequent artifact or
    # page write fails. This is execution evidence, excluded from stable identity.
    (output_root / 'stage-progress.json').write_bytes(_canonical_json(stages))
    np.savez_compressed(output_root / "structural_label_map.npz", labels=proposal.structural_label_map.astype(np.int32))
    (output_root / 'source-snapshot.png').write_bytes(foreground.source_bytes)
    if foreground.mask_bytes is not None:
        (output_root / 'external-mask-snapshot.png').write_bytes(foreground.mask_bytes)
    np.savez_compressed(output_root / "pixel_label_map.npz", labels=proposal.pixel_label_map.astype(np.int32))
    if quality is not None:
        old_structural, old_pixels, old_purified, old_metadata = baseline_analysis
        np.savez_compressed(output_root / 'baseline-analysis.npz', structural=old_structural,
                            pixels=old_pixels)
        _save_png(output_root / 'original-effective-foreground.png', original_rgba)
        _save_png(output_root / 'baseline-purified.png', old_purified)
        (output_root / 'baseline-regions.json').write_bytes(_canonical_json(old_metadata))
        quality.update({
            'baselineStructuralSha256': _sha256_bytes(old_structural.astype('<i4').tobytes()),
            'newStructuralSha256': _sha256_bytes(proposal.structural_label_map.astype('<i4').tobytes()),
            'newPixelLabelsSha256': _sha256_bytes(proposal.pixel_label_map.astype('<i4').tobytes()),
            'newPurifiedRgbaSha256': _sha256_bytes(purified.tobytes()),
            'selectedGeometrySha256': _sha256_bytes(_canonical_json(vector_result['geometry'])),
            'newRegionMetadata': metadata,
            'originalRegionMetadata': old_metadata,
            'numericChecks': label_validation,
            'colorMappingSemantics': 'Recomputed exact RC-A RGB per new label; experimental groups are not ColorSlots',
            'alphaOriginalRetained': bool(np.array_equal(original_rgba[..., 3], foreground.rgba[..., 3])),
            'derivedAlphaChangedPixels': int(np.count_nonzero(original_rgba[..., 3] != rgba[..., 3])),
            'sourceToDesignChangedRgbPixels': int(np.count_nonzero(np.any(original_rgba[..., :3] != purified[..., :3], axis=2) & (original_rgba[..., 3] > 0))),
        })
        (output_root / 'experimental-design.json').write_bytes(_canonical_json(quality))
        if quality_mode in {'design-colors', 'design-cleanup'}:
            # Full-resolution changes, separate from untouched original A.
            changed_alpha = original_rgba[..., 3] != rgba[..., 3]
            changed_labels = old_structural != proposal.structural_label_map
            np.savez_compressed(output_root / 'design-change-maps.npz',
                                alpha_changed=changed_alpha, labels_changed=changed_labels)
            change_preview = np.zeros((*changed_alpha.shape, 4), np.uint8)
            change_preview[changed_labels] = [255, 180, 0, 255]
            change_preview[changed_alpha] = [255, 0, 255, 255]
            _save_png(output_root / 'design-changes.png', change_preview)
    _save_png(output_root / "input-foreground.png", rgba)
    _save_png(output_root / "purified.png", purified)
    _save_png(output_root / "region-labels.png", _numbered_preview(proposal.structural_label_map, components=False))
    component_preview = _numbered_preview(proposal.structural_label_map, components=True, regions=regions)
    _save_png(output_root / "components.png", component_preview)
    flatness = float(vector_config["bezier"]["validationFlatnessPx"])
    _save_png(output_root / "vector-overlay.png", _vector_overlay(purified, vector_result, flatness))
    _save_png(output_root / "observed-candidates.png", render_polygons(geometry_objects, rgba.shape[:2], numbered=True))
    _save_png(output_root / 'observed-geometry.png', render_polygons(geometry_objects, rgba.shape[:2]))
    (output_root / "boundary-graph.json").write_bytes(_canonical_json(serialize_graph(graph)))
    (output_root / "vector-result.json").write_bytes(_canonical_json(vector_result))
    (output_root / "regions.json").write_bytes(_canonical_json(regions))
    (output_root / 'component-binding.json').write_bytes(_canonical_json(component_binding))
    (output_root / "observed-candidates.json").write_bytes(_canonical_json(candidates))
    (output_root / "metrics.json").write_bytes(_canonical_json(metrics))
    alpha_equal = bool(np.array_equal(rgba[..., 3], purified[..., 3]))
    review_items = [
        "Color partition quality requires human review; zero within-region variance is not correctness evidence.",
        "Observed candidates are not formal pieces and have no inferred hidden contour, base, order, assembly, or manufacturing approval.",
        "This run does not evaluate automatic background removal.",
    ]
    if metrics["orphan_fringe_count"]:
        review_items.append(f"{metrics['orphan_fringe_count']} ORPHAN_FRINGE pixels remain source-preserved and outside structural geometry.")
    report = {
        "schemaVersion": "m4-runtime-1.0.0",
        "runtimeId": runtime_id,
        "status": "COMPLETE_PENDING_MANUAL_QUALITY_REVIEW",
        'componentBinding': {'artifact': 'component-binding.json', 'schemaVersion': component_binding['schemaVersion'],
                             'sha256': _sha256_file(output_root / 'component-binding.json')},
        "input": foreground.provenance,
        "configuration": {
            'effectiveColorConfig': color_config,
            'effectiveVectorConfig': vector_config,
            "candidateId": "CP-B",
            "representativeMethod": "RC-A",
            "profile": profile,
            "runtimeProfileId": PROFILE_TO_RUNTIME_ID[profile],
            "profileSource": str((COLOR_ROOT / "configs" / "profiles.json").relative_to(REPOSITORY_ROOT)).replace("\\", "/"),
            "vectorConfigSource": str((VECTOR_ROOT / "configs" / "poc.v1.json").relative_to(REPOSITORY_ROOT)).replace("\\", "/"),
            "vectorSelectionLadder": [ROUTE_V2, ROUTE_V1, ROUTE_V0],
            "vectorToleranceSourcePixels": 0.5,
        },
        "contracts": {
            'independentLabelValidation': label_validation,
            "alphaBitIdentical": alpha_equal,
            "geometryTruth": "structural_label_map",
            "proposalConnectivity": 8,
            "componentConnectivity": 4,
            "sharedBoundaryConnectivity": 4,
            "vectorHardGate": vector_result["hardGate"],
            "automaticBackgroundRemovalEvaluated": False,
            "productionExportEligible": False,
            "finalFabricationReadiness": "NOT_READY_OBSERVED_ONLY",
        },
        "counts": {
            "colorIdentityCountExperimental": metrics["color_group_count_after"],
            "localRegionCount": len(regions),
            "geometryComponentCount": sum(item["componentCount"] for item in regions),
            "observedCandidateCount": len(candidates),
            "formalPieceCount": None,
            "smallRegionCount": metrics["small_component_count_after"],
            "regionArea": {"mean": metrics["mean_region_area"], "median": metrics["median_region_area"], "p10": metrics["p10_region_area"]},
        },
        "metrics": metrics,
        "topology": {"voids": void_topology(rgba[..., 3]), "adjacency": adjacency,
                     'structuralVoids': void_topology(np.where(proposal.structural_label_map > 0, 255, 0).astype(np.uint8)),
                     'regionInnerRingCount': sum(len(c['observedGeometry']['innerRings']) for c in candidates),
                     'semantics': 'Original alpha voids, threshold voids and Region inner rings are distinct; another positive Region inside a ring is not a global hole.'},
        'metricDefinitions': {'geometry_component_count': 'Frozen metric: whole effective foreground 8-connectivity',
                              'geometryComponentCount': 'Sum of per-Region 4-connected Components',
                              'smallRegionCount': 'Diagnostic source-pixel area threshold; not manual cutting qualification',
                              'proposalColorDistance': 'CIEDE2000', 'diagnosticDeltaE': 'LAB_EUCLIDEAN_APPROX'},
        "selectedVector": {"route": vector_result["route"], "toleranceSourcePixels": vector_result.get("tolerancePx"), "attemptedRoutes": attempted},
        "review": {"status": "PENDING_MANUAL_REVIEW", "callerForegroundConfirmation": foreground.provenance["manualConfirmation"], "items": review_items},
        "stages": stages,
        "artifacts": {
            "page": "index.html",
            "purified": "purified.png",
            "structuralLabels": "structural_label_map.npz",
            "pixelLabels": "pixel_label_map.npz",
            "regions": "regions.json",
            "boundaryGraph": "boundary-graph.json",
            "vectorResult": "vector-result.json",
            "observedCandidates": "observed-candidates.json",
        },
    }
    if quality is not None:
        if quality_mode == 'design-colors':
            report['topology']['materializedSinglePolygonHoleCount'] = sum(len(o['polygon'].interiors) for o in geometry_objects)
            report['topology']['pointTouchMaterializedComponentCount'] = len(quality['pointTouchMaterialization'])
        report['experimentalDesign'] = {'artifact': 'experimental-design.json',
            'sha256': _sha256_file(output_root / 'experimental-design.json'),
            'mode': quality_mode, 'foregroundCleanupEnabled': foreground_cleanup,
            'frozenEvidence': False, 'humanConfirmation': 'PENDING_REVIEW'}
        report['configuration']['experimentalDesign'] = report['experimentalDesign']
        if design_color_request is not None:
            report['experimentalDesign']['designColorRequest'] = design_color_request
            report['configuration']['designColorRequest'] = design_color_request
        report['configuration']['baselineFitToleranceSourcePixels'] = 0.5
        report['configuration']['vectorToleranceSourcePixels'] = vector_result.get('tolerancePx')
        report['contracts']['geometryTruth'] = 'experimental design B structural labels and explicitly selected shared contours'
        report['review']['items'].append('Experimental design B changes original analysis A; exact B-to-Piece rerender is NOT original-image quality acceptance.')
    _write_html(output_root, report)
    stable = {'sourceSha256': foreground.provenance['sourceImage']['sha256'],
              'maskSha256': (foreground.provenance['externalMask'] or {}).get('sha256'),
              'effectiveRgbaSha256': _sha256_bytes(rgba.tobytes()),
              'configuration': report['configuration'],
              'implementation': {p.name: _sha256_bytes(p.read_bytes().replace(b'\r\n', b'\n')) for p in (Path(__file__), Path(__file__).with_name('m4_checks.py'), Path(__file__).with_name('component_binding.py'))},
              'componentBinding': report['componentBinding'],
              'structuralLabelsSha256': _sha256_bytes(proposal.structural_label_map.astype('<i4').tobytes()),
              'pixelLabelsSha256': _sha256_bytes(proposal.pixel_label_map.astype('<i4').tobytes()),
              'purifiedRgbaSha256': _sha256_bytes(purified.tobytes()),
              'selectedGeometrySha256': _sha256_bytes(_canonical_json(vector_result['geometry']))}
    report['algorithmIdentity'] = _sha256_bytes(_canonical_json(stable))
    (output_root / 'algorithm-identity.json').write_bytes(_canonical_json(stable))
    report['artifactSha256'] = {p.name: _sha256_file(p) for p in sorted(output_root.iterdir()) if p.is_file()}
    # COMPLETE is the final write, after all mandatory plots/pages/artifacts.
    (output_root / "report.json").write_bytes(_canonical_json(report))
    return report


def run_runtime(
    *,
    image_path: Path,
    mode: str,
    mask_path: Path | None,
    foreground_source: str,
    manual_confirmation: str,
    runtime_id: str,
    profile: str,
    output_root: Path,
    whole_image_foreground: bool = False,
    quality_mode: str = 'baseline',
    foreground_cleanup: bool = False,
    design_palette: list[list[int]] | None = None,
    palette_provenance: str | None = None,
) -> dict[str, Any]:
    """Run the complete M4 chain through its single public processing API.

    Input normalization is read-only. Output isolation is then enforced before
    this function delegates to the private writer. Keeping the writer private
    prevents reusable service callers from accidentally bypassing the same
    protected-path, non-empty-directory, and overlap gates used by the CLI.
    """
    if quality_mode not in {'baseline', 'selection', 'contour', 'combined', 'design-colors', 'design-cleanup'}:
        raise M4RuntimeError('invalid experimental quality mode')
    if type(foreground_cleanup) is not bool or (foreground_cleanup and quality_mode == 'baseline'):
        raise M4RuntimeError('foreground cleanup requires an explicit experimental quality mode')
    design_request = None
    if quality_mode in {'design-colors', 'design-cleanup'}:
        quality_root = str(BENCHMARK_ROOT / 'algorithm-v1')
        if quality_root not in sys.path:
            sys.path.insert(0, quality_root)
        from design_color_regions import validate_request
        design_request = validate_request(design_palette, palette_provenance)
    elif design_palette is not None or palette_provenance is not None:
        raise M4RuntimeError('design palette is only accepted by the explicit design-colour path')
    foreground = load_foreground(
        image_path,
        mode=mode,
        mask_path=mask_path,
        foreground_source=foreground_source,
        manual_confirmation=manual_confirmation,
        whole_image_foreground=whole_image_foreground,
    )
    input_paths = [path for path in (image_path, mask_path) if path is not None]
    validated_output = validate_output_root(output_root, input_paths)
    try:
        options = {} if quality_mode == 'baseline' else {'quality_mode': quality_mode, 'foreground_cleanup': foreground_cleanup}
        if design_request is not None:
            options['design_color_request'] = design_request
        return _run_runtime(foreground, runtime_id=runtime_id, profile=profile, output_root=validated_output, **options)
    except Exception as error:
        if validated_output.exists() and not (validated_output / 'failure.json').exists():
            failure = {'runtimeId': runtime_id, 'status': 'RUNTIME_FAILED', 'errorType': type(error).__name__,
                       'error': str(error), 'downstreamStopped': True,
                       'completedArtifactNames': sorted(p.name for p in validated_output.iterdir() if p.is_file())}
            progress = validated_output / 'stage-progress.json'
            if progress.exists():
                failure['completedStages'] = json.loads(progress.read_text(encoding='utf-8'))
            try:
                (validated_output / 'failure.json').write_bytes(_canonical_json(failure))
            except OSError as cleanup_error:
                raise M4RuntimeError(f'failure record could not be written; inspect residual output {validated_output}: {cleanup_error}') from error
        raise
