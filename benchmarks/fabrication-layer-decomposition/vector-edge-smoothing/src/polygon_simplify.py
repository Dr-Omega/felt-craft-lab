"""Deterministic shared-chain polygon simplification and corner diagnostics."""
from __future__ import annotations

import math
from typing import Any

import numpy as np


def _distance_to_segment(point: np.ndarray, first: np.ndarray, second: np.ndarray) -> float:
    delta = second - first
    denominator = float(np.dot(delta, delta))
    if denominator <= 1e-15:
        return float(np.linalg.norm(point - first))
    parameter = float(np.clip(np.dot(point - first, delta) / denominator, 0.0, 1.0))
    return float(np.linalg.norm(point - (first + parameter * delta)))


def _rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points
    first = np.asarray(points[0], dtype=np.float64)
    last = np.asarray(points[-1], dtype=np.float64)
    distances = [_distance_to_segment(np.asarray(point, dtype=np.float64), first, last) for point in points[1:-1]]
    if not distances or max(distances) <= epsilon:
        return [points[0], points[-1]]
    index = 1 + int(np.argmax(distances))
    left = _rdp(points[: index + 1], epsilon)
    right = _rdp(points[index:], epsilon)
    return left[:-1] + right


def _interior_angle(first: tuple[float, float], center: tuple[float, float], last: tuple[float, float]) -> float:
    before = np.asarray(first, dtype=np.float64) - np.asarray(center, dtype=np.float64)
    after = np.asarray(last, dtype=np.float64) - np.asarray(center, dtype=np.float64)
    denominator = float(np.linalg.norm(before) * np.linalg.norm(after))
    if denominator <= 1e-12:
        return 180.0
    return math.degrees(math.acos(float(np.clip(np.dot(before, after) / denominator, -1.0, 1.0))))


def persistent_corners(
    points: list[tuple[float, float]],
    closed: bool,
    spans: list[int],
    persistent_turn_degrees: float,
    required_scale_count: int,
) -> tuple[list[int], dict[str, Any]]:
    body = points[:-1] if closed else points
    size = len(body)
    direction_changes = 0
    protected: list[int] = []
    evidence: list[dict[str, Any]] = []
    for index in range(size):
        if not closed and index in (0, size - 1):
            continue
        previous = body[index - 1]
        current = body[index]
        following = body[(index + 1) % size]
        incoming = (current[0] - previous[0], current[1] - previous[1])
        outgoing = (following[0] - current[0], following[1] - current[1])
        if incoming == outgoing:
            continue
        direction_changes += 1
        scale_evidence = []
        for span in spans:
            if not closed and (index - span < 0 or index + span >= size):
                continue
            before = body[(index - span) % size]
            after = body[(index + span) % size]
            angle = _interior_angle(before, current, after)
            turn = 180.0 - angle
            scale_evidence.append({"span": span, "turnDegrees": round(turn, 6), "persistent": turn >= persistent_turn_degrees})
        persistent_count = sum(item["persistent"] for item in scale_evidence)
        if persistent_count >= required_scale_count:
            protected.append(index)
            evidence.append({"index": index, "point": list(current), "scales": scale_evidence})
    return sorted(set(protected)), {
        "candidateCount": direction_changes,
        "protectedCount": len(protected),
        "rejectedRasterStepCount": direction_changes - len(protected),
        "spans": spans,
        "persistentTurnDegrees": persistent_turn_degrees,
        "requiredScaleCount": required_scale_count,
        "protected": evidence,
    }


def _simplify_open_with_protected(
    points: list[tuple[float, float]], epsilon: float, protected: list[int]
) -> list[tuple[float, float]]:
    anchors = sorted(set([0, len(points) - 1, *protected]))
    output: list[tuple[float, float]] = []
    for first, second in zip(anchors, anchors[1:]):
        part = _rdp(points[first : second + 1], epsilon)
        if output and output[-1] == part[0]:
            output.extend(part[1:])
        else:
            output.extend(part)
    return output


def simplify_chain(edge: dict[str, Any], epsilon: float, corner_config: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    points = [tuple(map(float, point)) for point in edge["geometry"]]
    closed = bool(edge["closed"])
    corners, diagnostics = persistent_corners(
        points,
        closed,
        [int(value) for value in corner_config["spans"]],
        float(corner_config["persistentTurnDegrees"]),
        int(corner_config["requiredScaleCount"]),
    )
    if closed:
        body = points[:-1]
        if corners:
            start = min(corners, key=lambda index: (body[index], index))
            ordered = body[start:] + body[:start] + [body[start]]
            remapped = sorted((index - start) % len(body) for index in corners)
            remapped.append(len(body))
            simplified = _simplify_open_with_protected(ordered, epsilon, remapped)
        else:
            start = min(range(len(body)), key=lambda index: (body[index], index))
            ordered = body[start:] + body[:start]
            opposite = len(ordered) // 2
            first = _rdp(ordered[: opposite + 1], epsilon)
            second = _rdp(ordered[opposite:] + [ordered[0]], epsilon)
            simplified = first[:-1] + second
    else:
        simplified = _simplify_open_with_protected(points, epsilon, corners)
    segments = [
        {"type": "LINE", "p0": list(first), "p1": list(second)}
        for first, second in zip(simplified, simplified[1:])
        if first != second
    ]
    diagnostics.update(
        {
            "rawGridVertices": len(points),
            "simplifiedVertices": len(simplified),
            "tolerancePx": epsilon,
        }
    )
    return segments, diagnostics


def exact_line_segments(edge: dict[str, Any]) -> list[dict[str, Any]]:
    points = [list(map(float, point)) for point in edge["geometry"]]
    return [{"type": "LINE", "p0": first, "p1": second} for first, second in zip(points, points[1:])]
