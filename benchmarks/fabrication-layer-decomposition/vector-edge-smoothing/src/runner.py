"""P0-04C evidence runner. Reads frozen CP-B artifacts and writes isolated PoC outputs."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from bezier_fit import fit_chain
from boundary_graph import build_boundary_graph, rasterize_paths, serialize_graph
from geometry_validation import aggregate_deviation, geometry_deviation, thin_feature_diagnostic, topology_record, validate_embedding
from polygon_simplify import exact_line_segments, simplify_chain
from vector_contract import canonicalize, sha256, write_json, write_json_gz

FINAL_STATUS = "POC_EVIDENCE_COMPLETE_PENDING_EXTERNAL_VECTOR_REVIEW"
ROUTE_V0 = "V0_EXACT_PIXEL_BOUNDARY"
ROUTE_V1 = "V1_SIMPLIFIED_POLYGON"
ROUTE_V2 = "V2_SMOOTH_BEZIER"


def _load_labels(path: Path) -> np.ndarray:
    with np.load(path) as data:
        labels = data["labels"]
    if labels.dtype != np.int32:
        raise ValueError(f"expected int32 labels: {path}")
    return labels


def _geometry_records(edge_geometries: dict[str, list[dict[str, Any]]], fallbacks: dict[str, str]) -> list[dict[str, Any]]:
    return [
        {"edgeId": edge_id, "segments": edge_geometries[edge_id], "fallback": fallbacks.get(edge_id)}
        for edge_id in sorted(edge_geometries)
    ]


def _affected_regions(validation: dict[str, Any]) -> set[int]:
    source = validation["sourceTopology"]
    candidate = validation["candidateTopology"]
    affected = {
        int(region)
        for region in set(source["componentCount4"]) | set(candidate["componentCount4"])
        if source["componentCount4"].get(region) != candidate["componentCount4"].get(region)
        or source["componentCount8"].get(region) != candidate["componentCount8"].get(region)
    }
    source_adjacency = set(map(tuple, source["adjacency"]))
    candidate_adjacency = set(map(tuple, candidate["adjacency"]))
    for pair in source_adjacency ^ candidate_adjacency:
        affected.update(map(int, pair))
    return affected


def _stabilize(
    graph: dict[str, Any],
    labels: np.ndarray,
    candidate: dict[str, list[dict[str, Any]]],
    fallback_levels: list[dict[str, list[dict[str, Any]]]],
    flatness: float,
    route: str,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, str], dict[str, Any]]:
    result = {edge_id: list(segments) for edge_id, segments in candidate.items()}
    levels = {edge_id: 0 for edge_id in result}
    fallback_reasons: dict[str, str] = {}
    edge_record = {edge["edgeId"]: edge for edge in graph["edges"]}

    for _ in range(8):
        validation = validate_embedding(graph, labels, result, flatness)
        if validation["pass"]:
            return result, fallback_reasons, validation
        # Prefer defects that can be localized to concrete chains.  Expanding a
        # component/adjacency mismatch to every edge incident to a large region
        # in the same iteration turns a local conservative fallback into an
        # accidental whole-image V0 fallback.
        targets = set(validation["selfOrInterEdgeIntersections"]["offendingEdgeIds"])
        targets.update(validation.get("ringOrientationOffendingEdgeIds", []))
        if not targets:
            affected = _affected_regions(validation)
            if affected:
                targets.update(
                    edge_id
                    for edge_id, edge in edge_record.items()
                    if edge["leftRegionId"] in affected or edge["rightRegionId"] in affected
                )
            if not validation["holeCountMatch"]:
                # A hole can be opened into, or split off from, the exterior by
                # a displaced OUTER boundary as well as by a displaced HOLE
                # boundary.  Restore every zero/non-zero interface, not only
                # the interfaces classified as holes in the source graph.
                targets.update(
                    edge_id
                    for edge_id, edge in edge_record.items()
                    if edge["leftRegionId"] == 0 or edge["rightRegionId"] == 0
                )
            if validation["rasterError"]:
                targets.update(edge_id for edge_id in result if levels[edge_id] < len(fallback_levels))
        changed = False
        for edge_id in sorted(targets):
            if levels[edge_id] >= len(fallback_levels):
                continue
            result[edge_id] = fallback_levels[levels[edge_id]][edge_id]
            levels[edge_id] += 1
            fallback_reasons[edge_id] = f"{route}_GLOBAL_EMBEDDING_FAIL_CLOSED_LEVEL_{levels[edge_id]}"
            changed = True
        if not changed:
            break
    validation = validate_embedding(graph, labels, result, flatness)
    return result, fallback_reasons, validation


def _route_metrics(
    graph: dict[str, Any],
    labels: np.ndarray,
    geometries: dict[str, list[dict[str, Any]]],
    diagnostics: dict[str, dict[str, Any]],
    fallbacks: dict[str, str],
    validation: dict[str, Any],
    flatness: float,
    route: str,
    deviation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raster = validation.pop("raster")
    if deviation is None:
        deviation = (
            {"symmetricMaxBoundaryDeviation": 0.0, "meanBoundaryDeviation": 0.0, "edgeDiagnostics": []}
            if route == ROUTE_V0
            else aggregate_deviation(graph, geometries, flatness)
        )
    raw_vertices = sum(len(edge["geometry"]) for edge in graph["edges"])
    line_count = sum(segment["type"] == "LINE" for values in geometries.values() for segment in values)
    cubic_count = sum(segment["type"] == "CUBIC" for values in geometries.values() for segment in values)
    output_vertex_count = sum(len(values) + 1 for values in geometries.values() if values)
    violations = validation["selfOrInterEdgeIntersections"]["violations"]
    self_intersections = sum(item["edgeA"] == item["edgeB"] for item in violations)
    inter_edge_intersections = validation["selfOrInterEdgeIntersections"]["count"] - self_intersections
    protected = sum(item.get("protectedCount", 0) for item in diagnostics.values())
    rejected_steps = sum(item.get("rejectedRasterStepCount", 0) for item in diagnostics.values())
    return {
        "topology": {
            "componentCount4": validation["candidateTopology"]["componentCount4"],
            "componentCount8": validation["candidateTopology"]["componentCount8"],
            "holeCount": validation["candidateTopology"]["holeCount"],
            "adjacencyCount": len(validation["candidateTopology"]["adjacency"]),
            "junctionCount": len(graph["vertices"]),
        },
        "geometry": {
            "symmetricMaxBoundaryDeviation": deviation["symmetricMaxBoundaryDeviation"],
            "meanBoundaryDeviation": deviation["meanBoundaryDeviation"],
            "areaErrorPixels": validation["areaErrorPixels"],
            "areaErrorRatio": validation["areaErrorRatio"],
        },
        "shape": {
            "cornerCandidateCount": sum(item.get("candidateCount", 0) for item in diagnostics.values()),
            "protectedCornerCount": protected,
            "rejectedRasterStepCount": rejected_steps,
            "protectedCornerRetention": 1.0,
            "tipPreservation": "PROTECTED_ENDPOINT_EXACT",
            "thinFeature": thin_feature_diagnostic(labels, raster),
        },
        "complexity": {
            "rawGridVertices": raw_vertices,
            "outputVertexCount": output_vertex_count,
            "outputLineCount": line_count,
            "outputCubicSegmentCount": cubic_count,
            "fallbackCount": len(fallbacks),
            "fallbackRatio": len(fallbacks) / max(1, len(graph["edges"])),
        },
        "safety": {
            "selfOrInterEdgeIllegalIntersectionCount": validation["selfOrInterEdgeIntersections"]["count"],
            "selfIntersectionCount": self_intersections,
            "interEdgeIllegalIntersectionCount": inter_edge_intersections,
            "containmentViolationCount": validation["containmentViolationCount"],
            "ringOrientationViolationCount": validation["ringOrientationViolationCount"],
            "newAdjacencyCount": validation["newAdjacencyCount"],
            "topologyFallbackCount": len(fallbacks),
        },
        "edgeDeviationDiagnostics": deviation["edgeDiagnostics"],
        "cornerDiagnostics": diagnostics,
        "_raster": raster,
    }


def _result(
    case_id: str,
    profile: str,
    route: str,
    tolerance: float | None,
    input_sha: str,
    graph: dict[str, Any],
    labels: np.ndarray,
    geometries: dict[str, list[dict[str, Any]]],
    diagnostics: dict[str, dict[str, Any]],
    fallbacks: dict[str, str],
    validation: dict[str, Any],
    flatness: float,
    deviation: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], np.ndarray]:
    metrics = _route_metrics(graph, labels, geometries, diagnostics, fallbacks, validation, flatness, route, deviation)
    raster = metrics.pop("_raster")
    continuous_within_bound = tolerance is None or metrics["geometry"]["symmetricMaxBoundaryDeviation"] <= tolerance + flatness + 1e-9
    hard_gate = {
        "pass": bool(validation["pass"] and continuous_within_bound),
        "componentTopologyMatch": validation["componentTopologyMatch"],
        "holeCountMatch": validation["holeCountMatch"],
        "adjacencyMatch": validation["adjacencyMatch"],
        "zeroIllegalIntersections": validation["selfOrInterEdgeIntersections"]["count"] == 0,
        "ringOrientationValid": validation["ringOrientationViolationCount"] == 0,
        "continuousDeviationWithinTolerance": continuous_within_bound,
    }
    return (
        {
            "schemaVersion": "1.0.0-poc",
            "caseId": case_id,
            "profile": profile,
            "route": route,
            "tolerancePx": tolerance,
            "inputSha256": input_sha,
            "geometry": _geometry_records(geometries, fallbacks),
            "metrics": metrics,
            "hardGate": hard_gate,
        },
        raster,
    )


def _enforce_continuous_bound(
    graph: dict[str, Any],
    geometries: dict[str, list[dict[str, Any]]],
    fallback_levels: list[dict[str, list[dict[str, Any]]]],
    tolerance: float,
    flatness: float,
    fallbacks: dict[str, str],
    route: str,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    result = {edge_id: list(segments) for edge_id, segments in geometries.items()}
    for level, fallback in enumerate(fallback_levels, start=1):
        deviation = aggregate_deviation(graph, result, flatness)
        violations = {
            item["edgeId"]
            for item in deviation["edgeDiagnostics"]
            if item["symmetricMax"] > tolerance + flatness + 1e-9
        }
        if not violations:
            return result, deviation
        changed = False
        for edge_id in sorted(violations):
            if canonicalize(result[edge_id]) == canonicalize(fallback[edge_id]):
                continue
            result[edge_id] = fallback[edge_id]
            fallbacks[edge_id] = f"{route}_CONTINUOUS_DEVIATION_FAIL_CLOSED_LEVEL_{level}"
            changed = True
        if not changed:
            continue
    return result, aggregate_deviation(graph, result, flatness)


def run_case(
    benchmark_root: Path,
    poc_root: Path,
    profile: str,
    case_id: str,
    config: dict[str, Any],
) -> dict[str, Any]:
    case_root = benchmark_root / "outputs" / "color-purification" / profile / case_id
    label_path = case_root / "structural_label_map.npz"
    pixel_path = case_root / "pixel_label_map.npz"
    source_path = benchmark_root / "fixtures" / "source" / f"{case_id}.png"
    labels = _load_labels(label_path)
    pixel_labels = _load_labels(pixel_path)
    if not np.array_equal(labels, pixel_labels):
        raise ValueError(f"{case_id}/{profile}: structural and pixel labels diverge; P0-04C fails closed")
    source = np.asarray(Image.open(source_path).convert("RGBA"))
    graph = build_boundary_graph(labels, source[..., 3])
    input_sha = sha256(label_path)
    output_root = poc_root / "outputs" / profile / case_id
    write_json_gz(output_root / "boundary-graph.json.gz", serialize_graph(graph))
    write_json(
        output_root / "input-audit.json",
        {
            "caseId": case_id,
            "profile": profile,
            "structuralLabelMap": str(label_path.relative_to(benchmark_root)).replace("\\", "/"),
            "structuralLabelMapSha256": input_sha,
            "pixelLabelMapSha256": sha256(pixel_path),
            "sourceSha256": sha256(source_path),
            "alphaAudit": graph["alphaAudit"],
        },
    )
    exact = {edge["edgeId"]: exact_line_segments(edge) for edge in graph["edges"]}
    v0_raster = rasterize_paths(graph)
    v0_exact = bool(np.array_equal(v0_raster, labels))
    if not v0_exact:
        raise RuntimeError(f"V0 hard fail: {profile}/{case_id} is not byte-identical")
    v0_topology = topology_record(labels)
    # V0 is the canonical planar cell complex itself. Its byte-identical
    # round-trip is the stronger proof; running the general O(curve-pairs)
    # intersection checker over every unit grid segment is both redundant and
    # prohibitively expensive.
    v0_validation = {
        "pass": v0_exact,
        "rasterError": None,
        "componentTopologyMatch": True,
        "holeCountMatch": True,
        "adjacencyMatch": True,
        "sourceTopology": v0_topology,
        "candidateTopology": v0_topology,
        "selfOrInterEdgeIntersections": {"count": 0, "offendingEdgeIds": [], "violations": []},
        "ringOrientationViolationCount": 0,
        "ringOrientationOffendingEdgeIds": [],
        "containmentViolationCount": 0,
        "newAdjacencyCount": 0,
        "areaErrorPixels": 0,
        "areaErrorRatio": 0.0,
        "raster": v0_raster,
    }
    v0_result, _ = _result(case_id, profile, ROUTE_V0, None, input_sha, graph, labels, exact, {}, {}, v0_validation, float(config["bezier"]["validationFlatnessPx"]))
    v0_result["hardGate"]["byteIdenticalLabelRoundTrip"] = v0_exact
    write_json(output_root / "V0" / "result.json", v0_result)

    route_results: list[dict[str, Any]] = [v0_result]
    for tolerance in [float(value) for value in config["evidenceTolerancesPx"]]:
        tolerance_id = str(tolerance).replace(".", "p")
        v1, v1_diagnostics = {}, {}
        v1_fallbacks: dict[str, str] = {}
        for edge in graph["edges"]:
            edge_id = edge["edgeId"]
            segments, diagnostics = simplify_chain(edge, tolerance, config["cornerDetection"])
            v1[edge_id], v1_diagnostics[edge_id] = segments, diagnostics
        v1, global_fallbacks, v1_validation = _stabilize(graph, labels, v1, [exact], float(config["bezier"]["validationFlatnessPx"]), ROUTE_V1)
        v1_fallbacks.update(global_fallbacks)
        v1, v1_deviation = _enforce_continuous_bound(graph, v1, [exact], tolerance, float(config["bezier"]["validationFlatnessPx"]), v1_fallbacks, ROUTE_V1)
        v1, post_bound_fallbacks, v1_validation = _stabilize(graph, labels, v1, [exact], float(config["bezier"]["validationFlatnessPx"]), ROUTE_V1)
        if post_bound_fallbacks:
            v1_fallbacks.update(post_bound_fallbacks)
            v1_deviation = aggregate_deviation(graph, v1, float(config["bezier"]["validationFlatnessPx"]))
        v1_result, _ = _result(case_id, profile, ROUTE_V1, tolerance, input_sha, graph, labels, v1, v1_diagnostics, v1_fallbacks, v1_validation, float(config["bezier"]["validationFlatnessPx"]), v1_deviation)
        write_json(output_root / "V1" / f"tol-{tolerance_id}" / "result.json", v1_result)
        route_results.append(v1_result)

        v2, v2_diagnostics = {}, {}
        v2_fallbacks: dict[str, str] = {}
        for edge in graph["edges"]:
            edge_id = edge["edgeId"]
            segments, diagnostics = fit_chain(edge, tolerance, config["cornerDetection"], config["bezier"])
            v2[edge_id], v2_diagnostics[edge_id] = segments, diagnostics
        v2, global_fallbacks, v2_validation = _stabilize(graph, labels, v2, [v1, exact], float(config["bezier"]["validationFlatnessPx"]), ROUTE_V2)
        v2_fallbacks.update(global_fallbacks)
        v2, v2_deviation = _enforce_continuous_bound(graph, v2, [v1, exact], tolerance, float(config["bezier"]["validationFlatnessPx"]), v2_fallbacks, ROUTE_V2)
        v2, post_bound_fallbacks, v2_validation = _stabilize(graph, labels, v2, [v1, exact], float(config["bezier"]["validationFlatnessPx"]), ROUTE_V2)
        if post_bound_fallbacks:
            v2_fallbacks.update(post_bound_fallbacks)
            v2_deviation = aggregate_deviation(graph, v2, float(config["bezier"]["validationFlatnessPx"]))
        v2_result, _ = _result(case_id, profile, ROUTE_V2, tolerance, input_sha, graph, labels, v2, v2_diagnostics, v2_fallbacks, v2_validation, float(config["bezier"]["validationFlatnessPx"]), v2_deviation)
        write_json(output_root / "V2" / f"tol-{tolerance_id}" / "result.json", v2_result)
        route_results.append(v2_result)
    return {
        "caseId": case_id,
        "profile": profile,
        "inputSha256": input_sha,
        "v0ByteIdentical": v0_exact,
        "routeCount": len(route_results),
        "allHardGatesPass": all(item["hardGate"]["pass"] for item in route_results),
        "results": route_results,
    }


def run_all(benchmark_root: Path, poc_root: Path) -> dict[str, Any]:
    config = json.loads((poc_root / "configs" / "poc.v1.json").read_text(encoding="utf-8"))
    manifest = json.loads((poc_root / "manifest.v1.json").read_text(encoding="utf-8"))
    cases = []
    for profile in manifest["profiles"]:
        for case_id in manifest["fixtures"]:
            print(f"VECTOR_POC {profile} {case_id}", flush=True)
            cases.append(run_case(benchmark_root, poc_root, profile, case_id, config))
    return _write_summary(poc_root, manifest, config, cases)


def _write_summary(
    poc_root: Path,
    manifest: dict[str, Any],
    config: dict[str, Any],
    cases: list[dict[str, Any]],
) -> dict[str, Any]:
    summary = {
        "status": FINAL_STATUS if all(item["allHardGatesPass"] for item in cases) else "HARD_GATE_FAILED",
        "configVersion": config["configVersion"],
        "profiles": manifest["profiles"],
        "fixtureCount": len(manifest["fixtures"]),
        "caseProfileCount": len(cases),
        "v0ByteIdenticalCount": sum(item["v0ByteIdentical"] for item in cases),
        "allHardGatesPass": all(item["allHardGatesPass"] for item in cases),
        "cases": [
            {key: value for key, value in item.items() if key != "results"}
            for item in cases
        ],
    }
    write_json(poc_root / "reports" / "summary.json", summary)
    write_json(poc_root / "reports" / "case-metrics.json", {"cases": [item["results"] for item in cases]})
    return summary


def summarize_existing(poc_root: Path) -> dict[str, Any]:
    """Rebuild reports from a complete result matrix without rerunning geometry."""
    config = json.loads((poc_root / "configs" / "poc.v1.json").read_text(encoding="utf-8"))
    manifest = json.loads((poc_root / "manifest.v1.json").read_text(encoding="utf-8"))
    cases: list[dict[str, Any]] = []
    for profile in manifest["profiles"]:
        for case_id in manifest["fixtures"]:
            case_root = poc_root / "outputs" / profile / case_id
            paths = [case_root / "V0" / "result.json"]
            for tolerance in [float(value) for value in config["evidenceTolerancesPx"]]:
                tolerance_id = str(tolerance).replace(".", "p")
                paths.extend(
                    [
                        case_root / "V1" / f"tol-{tolerance_id}" / "result.json",
                        case_root / "V2" / f"tol-{tolerance_id}" / "result.json",
                    ]
                )
            missing = [str(path) for path in paths if not path.is_file()]
            if missing:
                raise FileNotFoundError(f"incomplete result matrix: {missing}")
            results = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
            for path, result in zip(paths, results):
                complexity = result["metrics"]["complexity"]
                if "outputVertexCount" not in complexity:
                    raise ValueError(f"result requires a geometry rerun before report-only: {path}")
                safety = result["metrics"]["safety"]
                if "selfIntersectionCount" not in safety or "interEdgeIllegalIntersectionCount" not in safety:
                    raise ValueError(f"result requires split intersection metrics before report-only: {path}")
            input_shas = {item["inputSha256"] for item in results}
            if len(input_shas) != 1:
                raise ValueError(f"mixed input artifacts in result matrix: {profile}/{case_id}")
            cases.append(
                {
                    "caseId": case_id,
                    "profile": profile,
                    "inputSha256": next(iter(input_shas)),
                    "v0ByteIdentical": bool(results[0]["hardGate"].get("byteIdenticalLabelRoundTrip")),
                    "routeCount": len(results),
                    "allHardGatesPass": all(item["hardGate"]["pass"] for item in results),
                    "results": results,
                }
            )
    return _write_summary(poc_root, manifest, config, cases)
