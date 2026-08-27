"""Continuous geometry diagnostics and fail-closed planar embedding checks."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import cv2
import numpy as np
from scipy.spatial import cKDTree

from bezier_fit import flatten_segments
from boundary_graph import BoundaryGraphError, rasterize_paths, ring_polyline


def _point_segment_distance(point: np.ndarray, first: np.ndarray, second: np.ndarray) -> float:
    delta = second - first
    denominator = float(np.dot(delta, delta))
    if denominator <= 1e-15:
        return float(np.linalg.norm(point - first))
    parameter = float(np.clip(np.dot(point - first, delta) / denominator, 0.0, 1.0))
    return float(np.linalg.norm(point - (first + parameter * delta)))


def _point_polyline_distance(point: np.ndarray, polyline: list[tuple[float, float]]) -> float:
    return min(
        _point_segment_distance(point, np.asarray(first, dtype=np.float64), np.asarray(second, dtype=np.float64))
        for first, second in zip(polyline, polyline[1:])
    )


def _directed_continuous_bound(
    source: list[tuple[float, float]], target: list[tuple[float, float]], resolution: float
) -> tuple[float, float]:
    def sample(polyline: list[tuple[float, float]]) -> np.ndarray:
        values: list[np.ndarray] = []
        for first_value, second_value in zip(polyline, polyline[1:]):
            first = np.asarray(first_value, dtype=np.float64)
            second = np.asarray(second_value, dtype=np.float64)
            length = float(np.linalg.norm(second - first))
            count = max(1, int(np.ceil(length / resolution)))
            for index in range(count):
                values.append(first + (second - first) * (index / count))
        values.append(np.asarray(polyline[-1], dtype=np.float64))
        return np.asarray(values)

    source_samples = sample(source)
    target_samples = sample(target)
    distances = cKDTree(target_samples).query(source_samples, k=1, workers=1)[0]
    # Both continuous polylines are sampled at intervals <= resolution. Every
    # unsampled point is at most resolution/2 from a sample on each side, so
    # adding one resolution is a conservative directed whole-segment bound.
    return float(np.max(distances) + resolution), float(np.mean(distances))


def geometry_deviation(
    original: list[tuple[float, float]],
    segments: list[dict[str, Any]],
    flatness: float,
) -> dict[str, float]:
    candidate = flatten_segments(segments, flatness)
    forward_max, forward_mean = _directed_continuous_bound(original, candidate, flatness)
    reverse_max, reverse_mean = _directed_continuous_bound(candidate, original, flatness)
    # The flattened cubic is itself within the recorded De Casteljau flatness
    # corridor. Add that corridor to retain a conservative whole-curve bound.
    has_cubic = any(item["type"] == "CUBIC" for item in segments)
    curve_margin = flatness if has_cubic else 0.0
    return {
        "originalToCandidateMax": forward_max + curve_margin,
        "candidateToOriginalMax": reverse_max + curve_margin,
        "symmetricMax": max(forward_max, reverse_max) + curve_margin,
        "mean": (forward_mean + reverse_mean) / 2.0,
        "validationFlatnessPx": flatness,
    }


def _orientation(first: tuple[float, float], second: tuple[float, float], third: tuple[float, float]) -> float:
    return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])


def _on_segment(first: tuple[float, float], second: tuple[float, float], point: tuple[float, float], epsilon: float = 1e-9) -> bool:
    return (
        min(first[0], second[0]) - epsilon <= point[0] <= max(first[0], second[0]) + epsilon
        and min(first[1], second[1]) - epsilon <= point[1] <= max(first[1], second[1]) + epsilon
        and abs(_orientation(first, second, point)) <= epsilon
    )


def _segments_intersect(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float], d: tuple[float, float]) -> bool:
    values = (_orientation(a, b, c), _orientation(a, b, d), _orientation(c, d, a), _orientation(c, d, b))
    if ((values[0] > 0 > values[1]) or (values[1] > 0 > values[0])) and ((values[2] > 0 > values[3]) or (values[3] > 0 > values[2])):
        return True
    return any(
        abs(value) <= 1e-9 and _on_segment(first, second, point)
        for value, first, second, point in (
            (values[0], a, b, c),
            (values[1], a, b, d),
            (values[2], c, d, a),
            (values[3], c, d, b),
        )
    )


def illegal_intersections(
    graph: dict[str, Any], edge_geometries: dict[str, list[dict[str, Any]]], flatness: float
) -> dict[str, Any]:
    legal_junctions = {tuple(map(float, item["position"])) for item in graph["vertices"]}
    flattened: list[dict[str, Any]] = []
    for edge_id in sorted(edge_geometries):
        points = flatten_segments(edge_geometries[edge_id], flatness)
        for index, (first, second) in enumerate(zip(points, points[1:])):
            flattened.append({"edgeId": edge_id, "index": index, "first": first, "second": second})
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    cell_size = 16.0
    for index, item in enumerate(flattened):
        min_x, max_x = sorted((item["first"][0], item["second"][0]))
        min_y, max_y = sorted((item["first"][1], item["second"][1]))
        for gy in range(int(np.floor(min_y / cell_size)), int(np.floor(max_y / cell_size)) + 1):
            for gx in range(int(np.floor(min_x / cell_size)), int(np.floor(max_x / cell_size)) + 1):
                buckets[(gx, gy)].append(index)
    checked: set[tuple[int, int]] = set()
    violations: list[dict[str, Any]] = []
    offending: set[str] = set()
    for values in buckets.values():
        for offset, first_index in enumerate(values):
            for second_index in values[offset + 1 :]:
                pair = (min(first_index, second_index), max(first_index, second_index))
                if pair in checked:
                    continue
                checked.add(pair)
                first, second = flattened[first_index], flattened[second_index]
                if first["edgeId"] == second["edgeId"] and abs(first["index"] - second["index"]) <= 1:
                    continue
                if not _segments_intersect(first["first"], first["second"], second["first"], second["second"]):
                    continue
                common = set((first["first"], first["second"])) & set((second["first"], second["second"]))
                if len(common) == 1 and next(iter(common)) in legal_junctions:
                    continue
                violations.append({"edgeA": first["edgeId"], "edgeB": second["edgeId"]})
                offending.update((first["edgeId"], second["edgeId"]))
    return {"count": len(violations), "offendingEdgeIds": sorted(offending), "violations": violations[:200]}


def _adjacency(labels: np.ndarray) -> set[tuple[int, int]]:
    result: set[tuple[int, int]] = set()
    for first, second in ((labels[:, :-1], labels[:, 1:]), (labels[:-1], labels[1:])):
        mask = (first > 0) & (second > 0) & (first != second)
        for left, right in zip(first[mask], second[mask]):
            result.add(tuple(sorted((int(left), int(right)))))
    return result


def _components_by_region(labels: np.ndarray, connectivity: int) -> dict[int, int]:
    return {
        int(region): int(cv2.connectedComponents((labels == region).astype(np.uint8), connectivity=connectivity)[0] - 1)
        for region in np.unique(labels)
        if region > 0
    }


def _hole_count(labels: np.ndarray) -> int:
    count, components = cv2.connectedComponents((labels == 0).astype(np.uint8), connectivity=4)
    holes = 0
    for component_id in range(1, count):
        mask = components == component_id
        if not (mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any()):
            holes += 1
    return holes


def topology_record(labels: np.ndarray) -> dict[str, Any]:
    return {
        "componentCount4": _components_by_region(labels, 4),
        "componentCount8": _components_by_region(labels, 8),
        "holeCount": _hole_count(labels),
        "adjacency": [list(value) for value in sorted(_adjacency(labels))],
    }


def _signed_area(points: list[tuple[float, float]]) -> float:
    return 0.5 * sum(first[0] * second[1] - second[0] * first[1] for first, second in zip(points, points[1:]))


def validate_embedding(
    graph: dict[str, Any],
    original_labels: np.ndarray,
    edge_geometries: dict[str, list[dict[str, Any]]],
    flatness: float,
) -> dict[str, Any]:
    intersections = illegal_intersections(graph, edge_geometries, flatness)
    orientation_violations = 0
    orientation_edges: set[str] = set()
    for ring in graph["_rings"]:
        points = ring_polyline(graph, ring, edge_geometries, flatness)
        if _signed_area(points) * ring["signedAreaScreen"] <= 0:
            orientation_violations += 1
            orientation_edges.update(reference["edgeId"] for reference in ring["edgeReferences"])
    try:
        raster = rasterize_paths(graph, edge_geometries, flatness)
        raster_error = None
    except BoundaryGraphError as error:
        raster = np.zeros_like(original_labels)
        raster_error = str(error)
    source_topology = topology_record(original_labels)
    candidate_topology = topology_record(raster)
    component_match = source_topology["componentCount4"] == candidate_topology["componentCount4"] and source_topology["componentCount8"] == candidate_topology["componentCount8"]
    hole_match = source_topology["holeCount"] == candidate_topology["holeCount"]
    adjacency_match = source_topology["adjacency"] == candidate_topology["adjacency"]
    source_area = int(np.count_nonzero(original_labels))
    candidate_area = int(np.count_nonzero(raster))
    hard_pass = not raster_error and intersections["count"] == 0 and orientation_violations == 0 and component_match and hole_match and adjacency_match
    return {
        "pass": bool(hard_pass),
        "rasterError": raster_error,
        "componentTopologyMatch": component_match,
        "holeCountMatch": hole_match,
        "adjacencyMatch": adjacency_match,
        "sourceTopology": source_topology,
        "candidateTopology": candidate_topology,
        "selfOrInterEdgeIntersections": intersections,
        "ringOrientationViolationCount": orientation_violations,
        "ringOrientationOffendingEdgeIds": sorted(orientation_edges),
        "containmentViolationCount": 0 if hole_match and orientation_violations == 0 else 1,
        "newAdjacencyCount": len(set(map(tuple, candidate_topology["adjacency"])) - set(map(tuple, source_topology["adjacency"]))),
        "areaErrorPixels": candidate_area - source_area,
        "areaErrorRatio": abs(candidate_area - source_area) / max(1, source_area),
        "raster": raster,
    }


def aggregate_deviation(
    graph: dict[str, Any], edge_geometries: dict[str, list[dict[str, Any]]], flatness: float
) -> dict[str, Any]:
    records = []
    for edge in graph["edges"]:
        original = [tuple(map(float, point)) for point in edge["geometry"]]
        record = geometry_deviation(original, edge_geometries[edge["edgeId"]], flatness)
        records.append({"edgeId": edge["edgeId"], **record})
    return {
        "symmetricMaxBoundaryDeviation": max((item["symmetricMax"] for item in records), default=0.0),
        "meanBoundaryDeviation": float(np.mean([item["mean"] for item in records])) if records else 0.0,
        "edgeDiagnostics": records,
    }


def thin_feature_diagnostic(source: np.ndarray, candidate: np.ndarray) -> dict[str, Any]:
    def lower_width(labels: np.ndarray) -> float:
        active = (labels > 0).astype(np.uint8)
        if not np.any(active):
            return 0.0
        distances = cv2.distanceTransform(active, cv2.DIST_L2, 3)
        values = distances[active > 0] * 2.0
        return float(np.percentile(values, 10))

    source_width = lower_width(source)
    candidate_width = lower_width(candidate)
    return {
        "sourceP10LocalWidthPx": source_width,
        "candidateP10LocalWidthPx": candidate_width,
        "p10WidthRetentionRatio": candidate_width / max(source_width, 1e-12),
    }
