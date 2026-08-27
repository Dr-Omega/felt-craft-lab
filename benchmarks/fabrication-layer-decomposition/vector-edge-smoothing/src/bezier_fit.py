"""Minimal deterministic Schneider-style cubic fitting with conservative fallback."""
from __future__ import annotations

from typing import Any

import numpy as np

from polygon_simplify import persistent_corners


def _evaluate_cubic(control: np.ndarray, parameter: float) -> np.ndarray:
    one = 1.0 - parameter
    return (
        one**3 * control[0]
        + 3.0 * one**2 * parameter * control[1]
        + 3.0 * one * parameter**2 * control[2]
        + parameter**3 * control[3]
    )


def _derivative(control: np.ndarray, parameter: float) -> np.ndarray:
    one = 1.0 - parameter
    return 3.0 * (one**2 * (control[1] - control[0]) + 2.0 * one * parameter * (control[2] - control[1]) + parameter**2 * (control[3] - control[2]))


def _second_derivative(control: np.ndarray, parameter: float) -> np.ndarray:
    return 6.0 * ((1.0 - parameter) * (control[2] - 2.0 * control[1] + control[0]) + parameter * (control[3] - 2.0 * control[2] + control[1]))


def _chord_parameters(points: np.ndarray) -> np.ndarray:
    distances = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cumulative = np.concatenate(([0.0], np.cumsum(distances)))
    if cumulative[-1] <= 1e-12:
        return np.linspace(0.0, 1.0, len(points))
    return cumulative / cumulative[-1]


def _unit(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    return vector / length if length > 1e-12 else np.zeros(2, dtype=np.float64)


def _generate_control(points: np.ndarray, parameters: np.ndarray) -> np.ndarray:
    start, end = points[0], points[-1]
    start_tangent = _unit(points[1] - start)
    end_tangent = _unit(points[-2] - end)
    if not np.any(start_tangent) or not np.any(end_tangent):
        return np.stack((start, start, end, end))
    c = np.zeros((2, 2), dtype=np.float64)
    x = np.zeros(2, dtype=np.float64)
    for point, parameter in zip(points, parameters):
        one = 1.0 - parameter
        a1 = start_tangent * (3.0 * one**2 * parameter)
        a2 = end_tangent * (3.0 * one * parameter**2)
        base = start * (one**3 + 3.0 * one**2 * parameter) + end * (3.0 * one * parameter**2 + parameter**3)
        residual = point - base
        c[0, 0] += float(np.dot(a1, a1))
        c[0, 1] += float(np.dot(a1, a2))
        c[1, 0] += float(np.dot(a1, a2))
        c[1, 1] += float(np.dot(a2, a2))
        x[0] += float(np.dot(a1, residual))
        x[1] += float(np.dot(a2, residual))
    determinant = c[0, 0] * c[1, 1] - c[0, 1] * c[1, 0]
    if abs(determinant) > 1e-12:
        alpha_start = (x[0] * c[1, 1] - x[1] * c[0, 1]) / determinant
        alpha_end = (c[0, 0] * x[1] - c[1, 0] * x[0]) / determinant
    else:
        alpha_start = alpha_end = float(np.linalg.norm(end - start)) / 3.0
    minimum = 1e-6 * max(1.0, float(np.linalg.norm(end - start)))
    if alpha_start < minimum or alpha_end < minimum:
        alpha_start = alpha_end = float(np.linalg.norm(end - start)) / 3.0
    return np.stack((start, start + alpha_start * start_tangent, end + alpha_end * end_tangent, end))


def _refine_parameters(points: np.ndarray, control: np.ndarray, parameters: np.ndarray) -> np.ndarray:
    refined = parameters.copy()
    for index in range(1, len(points) - 1):
        parameter = float(refined[index])
        value = _evaluate_cubic(control, parameter)
        first = _derivative(control, parameter)
        second = _second_derivative(control, parameter)
        residual = value - points[index]
        denominator = float(np.dot(first, first) + np.dot(residual, second))
        if abs(denominator) > 1e-12:
            refined[index] = float(np.clip(parameter - np.dot(residual, first) / denominator, 0.0, 1.0))
    return np.maximum.accumulate(refined)


def _fit_error(points: np.ndarray, control: np.ndarray, parameters: np.ndarray) -> tuple[float, int]:
    distances = [float(np.linalg.norm(_evaluate_cubic(control, float(parameter)) - point)) for point, parameter in zip(points, parameters)]
    index = int(np.argmax(distances))
    return distances[index], index


def _control_is_safe(control: np.ndarray, points: np.ndarray, tolerance: float, max_handle_ratio: float) -> bool:
    arc_length = float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())
    if float(np.linalg.norm(control[1] - control[0])) > max_handle_ratio * max(arc_length, 1e-9):
        return False
    if float(np.linalg.norm(control[2] - control[3])) > max_handle_ratio * max(arc_length, 1e-9):
        return False
    minimum = points.min(axis=0) - tolerance
    maximum = points.max(axis=0) + tolerance
    return bool(np.all(control >= minimum) and np.all(control <= maximum))


def _distance_to_line(point: np.ndarray, first: np.ndarray, second: np.ndarray) -> float:
    delta = second - first
    denominator = float(np.dot(delta, delta))
    if denominator <= 1e-12:
        return float(np.linalg.norm(point - first))
    parameter = float(np.clip(np.dot(point - first, delta) / denominator, 0.0, 1.0))
    return float(np.linalg.norm(point - (first + parameter * delta)))


def _fit_run(
    points: np.ndarray,
    tolerance: float,
    config: dict[str, Any],
    depth: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    if len(points) <= 2:
        return [{"type": "LINE", "p0": points[0].tolist(), "p1": points[-1].tolist()}], 0
    chord_error = max(_distance_to_line(point, points[0], points[-1]) for point in points[1:-1])
    if chord_error <= min(0.125, tolerance * 0.25):
        return [{"type": "LINE", "p0": points[0].tolist(), "p1": points[-1].tolist()}], 0
    parameters = _chord_parameters(points)
    control = _generate_control(points, parameters)
    error, split = _fit_error(points, control, parameters)
    for _ in range(int(config["maxReparameterizationIterations"])):
        if error <= tolerance:
            break
        parameters = _refine_parameters(points, control, parameters)
        control = _generate_control(points, parameters)
        error, split = _fit_error(points, control, parameters)
    if error <= tolerance and _control_is_safe(control, points, tolerance, float(config["maxHandleToArcLengthRatio"])):
        return [
            {
                "type": "CUBIC",
                "p0": control[0].tolist(),
                "c1": control[1].tolist(),
                "c2": control[2].tolist(),
                "p1": control[3].tolist(),
            }
        ], 0
    if depth >= int(config["maxRecursionDepth"]) or split <= 0 or split >= len(points) - 1:
        return [
            {"type": "LINE", "p0": first.tolist(), "p1": second.tolist()}
            for first, second in zip(points, points[1:])
        ], 1
    left, left_fallback = _fit_run(points[: split + 1], tolerance, config, depth + 1)
    right, right_fallback = _fit_run(points[split:], tolerance, config, depth + 1)
    return left + right, left_fallback + right_fallback


def fit_chain(
    edge: dict[str, Any],
    tolerance: float,
    corner_config: dict[str, Any],
    bezier_config: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    points = [tuple(map(float, point)) for point in edge["geometry"]]
    closed = bool(edge["closed"])
    corners, corner_diagnostics = persistent_corners(
        points,
        closed,
        [int(value) for value in corner_config["spans"]],
        float(corner_config["persistentTurnDegrees"]),
        int(corner_config["requiredScaleCount"]),
    )
    body = points[:-1] if closed else points
    if closed:
        anchors = sorted(set(corners or [0, len(body) // 2]))
        if len(anchors) == 1:
            anchors.append((anchors[0] + len(body) // 2) % len(body))
        start = min(anchors, key=lambda index: (body[index], index))
        rotated = body[start:] + body[:start]
        remapped = sorted((index - start) % len(body) for index in anchors)
        remapped = sorted(set([0, *remapped, len(body)]))
        working = rotated + [rotated[0]]
    else:
        working = body
        remapped = sorted(set([0, len(working) - 1, *corners]))

    segments: list[dict[str, Any]] = []
    local_fallbacks = 0
    for first, second in zip(remapped, remapped[1:]):
        run = np.asarray(working[first : second + 1], dtype=np.float64)
        fitted, fallbacks = _fit_run(run, tolerance, bezier_config)
        segments.extend(fitted)
        local_fallbacks += fallbacks
    diagnostics = {
        **corner_diagnostics,
        "tolerancePx": tolerance,
        "lineCount": sum(segment["type"] == "LINE" for segment in segments),
        "cubicSegmentCount": sum(segment["type"] == "CUBIC" for segment in segments),
        "fitFallbackCount": local_fallbacks,
    }
    return segments, diagnostics


def _cubic_flatness(segment: dict[str, Any]) -> float:
    points = [np.asarray(segment[key], dtype=np.float64) for key in ("p0", "c1", "c2", "p1")]
    return max(_distance_to_line(points[1], points[0], points[3]), _distance_to_line(points[2], points[0], points[3]))


def _split_cubic(segment: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    p0, c1, c2, p1 = [np.asarray(segment[key], dtype=np.float64) for key in ("p0", "c1", "c2", "p1")]
    a = (p0 + c1) / 2.0
    b = (c1 + c2) / 2.0
    c = (c2 + p1) / 2.0
    d = (a + b) / 2.0
    e = (b + c) / 2.0
    middle = (d + e) / 2.0
    return (
        {"type": "CUBIC", "p0": p0.tolist(), "c1": a.tolist(), "c2": d.tolist(), "p1": middle.tolist()},
        {"type": "CUBIC", "p0": middle.tolist(), "c1": e.tolist(), "c2": c.tolist(), "p1": p1.tolist()},
    )


def flatten_segments(segments: list[dict[str, Any]], flatness: float) -> list[tuple[float, float]]:
    output: list[tuple[float, float]] = []

    def append(point: list[float]) -> None:
        value = (float(point[0]), float(point[1]))
        if not output or output[-1] != value:
            output.append(value)

    def flatten(segment: dict[str, Any], depth: int = 0) -> None:
        if segment["type"] == "LINE" or _cubic_flatness(segment) <= flatness or depth >= 24:
            append(segment["p0"])
            append(segment["p1"])
            return
        left, right = _split_cubic(segment)
        flatten(left, depth + 1)
        flatten(right, depth + 1)

    for item in segments:
        flatten(item)
    return output
