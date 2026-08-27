"""Canonical pixel-cell half-edge graph for frozen structural label maps."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

import cv2
import numpy as np

Point = tuple[int, int]


class BoundaryGraphError(RuntimeError):
    pass


def _point(value: Iterable[int]) -> Point:
    x, y = value
    return int(x), int(y)


def zero_components(labels: np.ndarray) -> tuple[np.ndarray, list[dict[str, Any]]]:
    if labels.ndim != 2 or labels.dtype.kind not in "iu" or np.any(labels < 0):
        raise BoundaryGraphError("structural_label_map must be a non-negative integer 2D array")
    count, components = cv2.connectedComponents((labels == 0).astype(np.uint8), connectivity=4)
    records: list[dict[str, Any]] = []
    for component_id in range(1, count):
        mask = components == component_id
        ys, xs = np.where(mask)
        touches = bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())
        records.append(
            {
                "voidId": f"V{component_id:04d}",
                "componentId": component_id,
                "kind": "OUTER" if touches else "HOLE",
                "area": int(mask.sum()),
                "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
                "touchesCanvas": touches,
            }
        )
    return components.astype(np.int32), records


def audit_source_alpha(labels: np.ndarray, alpha: np.ndarray | None) -> dict[str, Any]:
    if alpha is None:
        return {"status": "NOT_PROVIDED", "mismatchPixelCount": None}
    if alpha.shape != labels.shape:
        raise BoundaryGraphError("STRUCTURAL_ALPHA_TOPOLOGY_MISMATCH: dimensions differ")
    mismatch = (labels == 0) != (alpha == 0)
    count = int(mismatch.sum())
    if count:
        raise BoundaryGraphError(f"STRUCTURAL_ALPHA_TOPOLOGY_MISMATCH: {count} pixels")
    return {"status": "MATCH", "mismatchPixelCount": 0}


def _segment_key(first: Point, second: Point) -> tuple[Point, Point]:
    return (first, second) if first <= second else (second, first)


def _canonical_open(points: list[Point]) -> list[Point]:
    reverse = list(reversed(points))
    return points if tuple(points) <= tuple(reverse) else reverse


def _minimum_rotation(points: list[Point]) -> list[Point]:
    best: tuple[Point, ...] | None = None
    for candidate in (points, list(reversed(points))):
        minimum = min(candidate)
        for index, value in enumerate(candidate):
            if value != minimum:
                continue
            rotated = tuple(candidate[index:] + candidate[:index])
            if best is None or rotated < best:
                best = rotated
    assert best is not None
    return list(best) + [best[0]]


def _canonical_ring_start(points: list[Point]) -> list[Point]:
    """Rotate a directed ring without reversing its face-walk orientation."""
    body = points[:-1]
    minimum = min(body)
    candidates = [tuple(body[index:] + body[:index]) for index, value in enumerate(body) if value == minimum]
    best = min(candidates)
    return list(best) + [best[0]]


def _direction_code(first: Point, second: Point) -> int:
    delta = (second[0] - first[0], second[1] - first[1])
    codes = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    if delta not in codes:
        raise BoundaryGraphError(f"non-grid half-edge {first}->{second}")
    return codes[delta]


def _signed_area(points: list[Point]) -> float:
    return 0.5 * sum(first[0] * second[1] - second[0] * first[1] for first, second in zip(points, points[1:]))


def _point_in_polygon(point: tuple[float, float], polygon: list[Point]) -> bool:
    x, y = point
    inside = False
    for first, second in zip(polygon, polygon[1:]):
        x1, y1 = first
        x2, y2 = second
        if (y1 > y) != (y2 > y):
            crossing = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if crossing > x:
                inside = not inside
    return inside


def _interior_probe(points: list[Point]) -> tuple[float, float]:
    # A half-pixel offset from the midpoint of the first unit edge toward the
    # ring's right side. Inner rings have the enclosing region on that side.
    first, second = points[0], points[1]
    mx, my = (first[0] + second[0]) / 2.0, (first[1] + second[1]) / 2.0
    dx, dy = second[0] - first[0], second[1] - first[1]
    length = max(1.0, float(abs(dx) + abs(dy)))
    return mx - dy * 0.25 / length, my + dx * 0.25 / length


def _build_unit_segments(labels: np.ndarray, components: np.ndarray, voids: list[dict[str, Any]]) -> list[dict[str, Any]]:
    height, width = labels.shape
    void_by_component = {item["componentId"]: item for item in voids}
    segments: list[dict[str, Any]] = []

    def append_segment(start: Point, end: Point, left: int, right: int, zero_component: int | None) -> None:
        if left == right or (left == 0 and right == 0):
            return
        if left > 0 and right > 0:
            boundary_type, void_id = "SHARED", None
        else:
            if zero_component is None:
                boundary_type, void_id = "OUTER", "OUTER_CANVAS"
            else:
                record = void_by_component[zero_component]
                boundary_type, void_id = record["kind"], record["voidId"]
        segments.append(
            {
                "unitId": len(segments),
                "start": start,
                "end": end,
                "leftRegionId": int(left),
                "rightRegionId": int(right),
                "boundaryType": boundary_type,
                "voidId": void_id,
            }
        )

    # Horizontal grid edges are oriented east: north cell is left, south is right.
    for y in range(height + 1):
        north = np.zeros(width, dtype=np.int32) if y == 0 else labels[y - 1]
        south = np.zeros(width, dtype=np.int32) if y == height else labels[y]
        for x in np.flatnonzero(north != south):
            zero_component = None
            if north[x] == 0 and y > 0:
                zero_component = int(components[y - 1, x])
            elif south[x] == 0 and y < height:
                zero_component = int(components[y, x])
            append_segment((int(x), y), (int(x + 1), y), int(north[x]), int(south[x]), zero_component)

    # Vertical grid edges are oriented south: east cell is left, west is right.
    for x in range(width + 1):
        west = np.zeros(height, dtype=np.int32) if x == 0 else labels[:, x - 1]
        east = np.zeros(height, dtype=np.int32) if x == width else labels[:, x]
        for y in np.flatnonzero(west != east):
            zero_component = None
            if west[y] == 0 and x > 0:
                zero_component = int(components[y, x - 1])
            elif east[y] == 0 and x < width:
                zero_component = int(components[y, x])
            append_segment((x, int(y)), (x, int(y + 1)), int(east[y]), int(west[y]), zero_component)
    return segments


def _chain_unit_segments(unit_segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[int, tuple[str, int]]]:
    all_incidence: dict[Point, list[int]] = defaultdict(list)
    grouped: dict[tuple[Any, ...], list[int]] = defaultdict(list)
    for segment in unit_segments:
        unit_id = segment["unitId"]
        start, end = segment["start"], segment["end"]
        all_incidence[start].append(unit_id)
        all_incidence[end].append(unit_id)
        pair = tuple(sorted((segment["leftRegionId"], segment["rightRegionId"])))
        grouped[(pair, segment["boundaryType"], segment["voidId"])].append(unit_id)

    segment_by_id = {item["unitId"]: item for item in unit_segments}
    raw_edges: list[dict[str, Any]] = []

    for group_key in sorted(grouped, key=str):
        ids = grouped[group_key]
        incidence: dict[Point, list[int]] = defaultdict(list)
        for unit_id in ids:
            segment = segment_by_id[unit_id]
            incidence[segment["start"]].append(unit_id)
            incidence[segment["end"]].append(unit_id)
        unused = set(ids)

        def is_break(vertex: Point) -> bool:
            return len(all_incidence[vertex]) != 2 or len(incidence[vertex]) != 2

        def walk(seed: int, start: Point) -> tuple[list[Point], list[int]]:
            points = [start]
            walked: list[int] = []
            current_id, current_vertex = seed, start
            while True:
                if current_id not in unused:
                    break
                unused.remove(current_id)
                walked.append(current_id)
                segment = segment_by_id[current_id]
                next_vertex = segment["end"] if segment["start"] == current_vertex else segment["start"]
                points.append(next_vertex)
                if next_vertex == start or is_break(next_vertex):
                    break
                candidates = [item for item in incidence[next_vertex] if item in unused]
                if len(candidates) != 1:
                    break
                current_id, current_vertex = candidates[0], next_vertex
            return points, walked

        while True:
            open_seed: tuple[int, Point] | None = None
            for unit_id in sorted(unused):
                segment = segment_by_id[unit_id]
                breakpoints = sorted(vertex for vertex in (segment["start"], segment["end"]) if is_break(vertex))
                if breakpoints:
                    open_seed = unit_id, breakpoints[0]
                    break
            if open_seed is None:
                break
            points, walked = walk(*open_seed)
            raw_edges.append({"points": _canonical_open(points), "unitIds": walked, "group": group_key})
        while unused:
            seed = min(unused)
            segment = segment_by_id[seed]
            points, walked = walk(seed, min(segment["start"], segment["end"]))
            if points[0] != points[-1]:
                raise BoundaryGraphError("closed boundary chain did not close")
            raw_edges.append({"points": _minimum_rotation(points[:-1]), "unitIds": walked, "group": group_key})

    for raw in raw_edges:
        first, second = raw["points"][0], raw["points"][1]
        unit = next(segment_by_id[item] for item in raw["unitIds"] if _segment_key(segment_by_id[item]["start"], segment_by_id[item]["end"]) == _segment_key(first, second))
        if unit["start"] == first and unit["end"] == second:
            left, right = unit["leftRegionId"], unit["rightRegionId"]
        else:
            left, right = unit["rightRegionId"], unit["leftRegionId"]
        raw["leftRegionId"], raw["rightRegionId"] = left, right
        raw["boundaryType"], raw["voidId"] = unit["boundaryType"], unit["voidId"]

    raw_edges.sort(
        key=lambda item: (
            item["points"], item["leftRegionId"], item["rightRegionId"], item["boundaryType"], item["voidId"] or ""
        )
    )
    unit_to_edge: dict[int, tuple[str, int]] = {}
    edges: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_edges, start=1):
        edge_id = f"E{index:06d}"
        direction_by_segment = {_segment_key(first, second): 1 for first, second in zip(raw["points"], raw["points"][1:])}
        edge = {
            "edgeId": edge_id,
            "geometry": [[x, y] for x, y in raw["points"]],
            "leftRegionId": raw["leftRegionId"],
            "rightRegionId": raw["rightRegionId"],
            "boundaryType": raw["boundaryType"],
            "voidId": raw["voidId"],
            "startVertex": list(raw["points"][0]),
            "endVertex": list(raw["points"][-1]),
            "closed": raw["points"][0] == raw["points"][-1],
            "rawGridSegmentCount": len(raw["points"]) - 1,
        }
        edges.append(edge)
        for unit_id in raw["unitIds"]:
            segment = segment_by_id[unit_id]
            key = _segment_key(segment["start"], segment["end"])
            chain_pair = next((pair for pair in zip(raw["points"], raw["points"][1:]) if _segment_key(*pair) == key), None)
            assert chain_pair is not None and key in direction_by_segment
            relative = 1 if (segment["start"], segment["end"]) == chain_pair else -1
            unit_to_edge[unit_id] = edge_id, relative
    return edges, unit_to_edge


def _face_walks(unit_segments: list[dict[str, Any]], unit_to_edge: dict[int, tuple[str, int]]) -> list[dict[str, Any]]:
    source_segment = {item["unitId"]: item for item in unit_segments}
    halfedges: dict[tuple[int, int], dict[str, Any]] = {}
    outgoing: dict[tuple[int, Point], list[tuple[int, int]]] = defaultdict(list)
    for segment in unit_segments:
        for region, forward in ((segment["leftRegionId"], True), (segment["rightRegionId"], False)):
            if region <= 0:
                continue
            start, end = (segment["start"], segment["end"]) if forward else (segment["end"], segment["start"])
            key = (segment["unitId"], int(region))
            halfedges[key] = {"start": start, "end": end, "region": int(region), "unitId": segment["unitId"]}
            outgoing[(int(region), start)].append(key)
    for values in outgoing.values():
        values.sort(key=lambda key: (_direction_code(halfedges[key]["start"], halfedges[key]["end"]), key))

    used: set[tuple[int, int]] = set()
    rings: list[dict[str, Any]] = []
    for start_key in sorted(halfedges):
        if start_key in used:
            continue
        current = start_key
        ring_keys: list[tuple[int, int]] = []
        points: list[Point] = [halfedges[current]["start"]]
        while True:
            if current in used:
                if current != start_key:
                    raise BoundaryGraphError("half-edge face walk reached an already consumed edge")
                break
            used.add(current)
            ring_keys.append(current)
            item = halfedges[current]
            points.append(item["end"])
            incoming = _direction_code(item["start"], item["end"])
            twin_direction = (incoming + 2) % 4
            candidates = outgoing[(item["region"], item["end"])]
            ranked = sorted(
                candidates,
                key=lambda key: (((_direction_code(halfedges[key]["start"], halfedges[key]["end"]) - twin_direction) % 4) or 4, key),
            )
            if not ranked:
                raise BoundaryGraphError("open region face in boundary graph")
            current = ranked[0]
            if current == start_key:
                break
        if points[0] != points[-1]:
            raise BoundaryGraphError("region face walk did not close")
        unit_refs: list[tuple[str, int]] = []
        for key in ring_keys:
            edge_id, unit_forward = unit_to_edge[key[0]]
            unit = halfedges[key]
            original = source_segment[key[0]]
            face_vs_unit = 1 if (unit["start"], unit["end"]) == (original["start"], original["end"]) else -1
            unit_refs.append((edge_id, unit_forward * face_vs_unit))

        # A ring may begin in the middle of a maximal chain. Rotate only to a
        # chain boundary so an edge is never referenced twice as partial geometry.
        candidates = [index for index in range(len(ring_keys)) if unit_refs[index] != unit_refs[index - 1]]
        if not candidates:
            candidates = list(range(len(ring_keys)))
        start_index = min(
            candidates,
            key=lambda index: (
                points[index],
                tuple(unit_refs[index:] + unit_refs[:index]),
                tuple(points[index:-1] + points[:index]),
            ),
        )
        ring_keys = ring_keys[start_index:] + ring_keys[:start_index]
        unit_refs = unit_refs[start_index:] + unit_refs[:start_index]
        body = points[:-1]
        body = body[start_index:] + body[:start_index]
        points = body + [body[0]]

        refs: list[dict[str, Any]] = []
        for edge_id, direction in unit_refs:
            if refs and refs[-1]["edgeId"] == edge_id and refs[-1]["direction"] == direction:
                continue
            refs.append({"edgeId": edge_id, "direction": direction})
        area = _signed_area(points)
        if abs(area) < 1e-9:
            raise BoundaryGraphError("zero-area region ring")
        rings.append(
            {
                "regionId": halfedges[start_key]["region"],
                "points": points,
                "edgeReferences": refs,
                "signedAreaScreen": area,
                "ringKind": "OUTER_RING" if area < 0 else "INNER_RING",
            }
        )
    return rings


def _build_region_records(rings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_region: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for ring in rings:
        by_region[ring["regionId"]].append(ring)
    result: list[dict[str, Any]] = []
    for region_id in sorted(by_region):
        region_rings = by_region[region_id]
        outers = sorted((ring for ring in region_rings if ring["ringKind"] == "OUTER_RING"), key=lambda item: (min(item["points"]), abs(item["signedAreaScreen"]), item["points"]))
        inners = sorted((ring for ring in region_rings if ring["ringKind"] == "INNER_RING"), key=lambda item: (min(item["points"]), abs(item["signedAreaScreen"]), item["points"]))
        components = [{"outerRing": outer, "innerRings": []} for outer in outers]
        for inner in inners:
            probe = _interior_probe(inner["points"])
            containers = [
                (abs(component["outerRing"]["signedAreaScreen"]), index)
                for index, component in enumerate(components)
                if _point_in_polygon(probe, component["outerRing"]["points"])
            ]
            if not containers:
                raise BoundaryGraphError(f"region {region_id} inner ring has no containing outer ring")
            components[min(containers)[1]]["innerRings"].append(inner)
        for component_index, component in enumerate(components, start=1):
            component["componentId"] = f"R{region_id:05d}-C{component_index:03d}"
            component["outerRing"]["ringId"] = component["componentId"] + "-O"
            component["outerRing"].pop("points", None)
            for hole_index, ring in enumerate(component["innerRings"], start=1):
                ring["ringId"] = component["componentId"] + f"-I{hole_index:03d}"
                ring.pop("points", None)
        result.append({"regionId": region_id, "components": components})
    return result


def _junction_kind(vertex: Point, labels: np.ndarray, unit_degree: int, pair_count: int) -> str:
    x, y = vertex
    height, width = labels.shape
    cells = []
    for yy, xx in ((y - 1, x - 1), (y - 1, x), (y, x - 1), (y, x)):
        cells.append(int(labels[yy, xx]) if 0 <= yy < height and 0 <= xx < width else 0)
    nw, ne, sw, se = cells
    if nw == se and ne == sw and nw != ne:
        return "CHECKERBOARD_POINT_TOUCH"
    if len(set(cells)) >= 3:
        return "MULTI_REGION_JUNCTION"
    if unit_degree != 2:
        return "BRANCH_JUNCTION"
    if pair_count > 1:
        return "REGION_PAIR_CHANGE"
    return "CLOSED_RING_ANCHOR"


def build_boundary_graph(labels: np.ndarray, source_alpha: np.ndarray | None = None) -> dict[str, Any]:
    labels = np.asarray(labels)
    components, voids = zero_components(labels)
    alpha_audit = audit_source_alpha(labels, source_alpha)
    unit_segments = _build_unit_segments(labels, components, voids)
    edges, unit_to_edge = _chain_unit_segments(unit_segments)
    rings = _face_walks(unit_segments, unit_to_edge)
    regions = _build_region_records(rings)

    incidence: dict[Point, set[str]] = defaultdict(set)
    unit_incidence: dict[Point, list[dict[str, Any]]] = defaultdict(list)
    edge_by_id = {edge["edgeId"]: edge for edge in edges}
    for edge in edges:
        incidence[_point(edge["startVertex"])].add(edge["edgeId"])
        incidence[_point(edge["endVertex"])].add(edge["edgeId"])
    for segment in unit_segments:
        unit_incidence[segment["start"]].append(segment)
        unit_incidence[segment["end"]].append(segment)
    vertices = []
    for index, vertex in enumerate(sorted(incidence), start=1):
        unit_items = unit_incidence[vertex]
        pairs = {
            tuple(sorted((item["leftRegionId"], item["rightRegionId"])))
            for item in unit_items
        }
        kind = _junction_kind(vertex, labels, len(unit_items), len(pairs))
        vertices.append(
            {
                "vertexId": f"VTX{index:06d}",
                "position": list(vertex),
                "incidentEdgeIds": sorted(incidence[vertex]),
                "unitDegree": len(unit_items),
                "junctionKind": kind,
                "fitLocked": True,
            }
        )
    vertex_id = {_point(item["position"]): item["vertexId"] for item in vertices}
    for edge in edges:
        edge["startVertexId"] = vertex_id[_point(edge.pop("startVertex"))]
        edge["endVertexId"] = vertex_id[_point(edge.pop("endVertex"))]

    graph = {
        "schemaVersion": "1.0.0-poc",
        "width": int(labels.shape[1]),
        "height": int(labels.shape[0]),
        "connectivity": {
            "regionIdentity": 8,
            "sharedEdgeAdjacency": 4,
            "zeroComponents": 4,
            "diagonalTouchCreatesAdjacency": False,
        },
        "alphaAudit": alpha_audit,
        "unitBoundarySegmentCount": len(unit_segments),
        "vertices": vertices,
        "edges": edges,
        "regions": regions,
        "voids": voids,
    }
    # Private source-ring cache is deterministic and omitted by serialize_graph.
    graph["_rings"] = rings
    graph["_edgeById"] = edge_by_id
    return graph


def serialize_graph(graph: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in graph.items() if not key.startswith("_")}


def ring_polyline(graph: dict[str, Any], ring: dict[str, Any], edge_geometries: dict[str, list[dict[str, Any]]] | None = None, flatten_tolerance: float = 0.0625) -> list[tuple[float, float]]:
    if edge_geometries is None:
        points: list[tuple[float, float]] = []
        for reference in ring["edgeReferences"]:
            geometry = [tuple(map(float, item)) for item in graph["_edgeById"][reference["edgeId"]]["geometry"]]
            if reference["direction"] < 0:
                geometry.reverse()
            if points and points[-1] == geometry[0]:
                points.extend(geometry[1:])
            else:
                points.extend(geometry)
        return points
    from bezier_fit import flatten_segments

    result: list[tuple[float, float]] = []
    for reference in ring["edgeReferences"]:
        segments = edge_geometries[reference["edgeId"]]
        if reference["direction"] < 0:
            segments = reverse_segments(segments)
        geometry = flatten_segments(segments, flatten_tolerance)
        if result and result[-1] == geometry[0]:
            result.extend(geometry[1:])
        else:
            result.extend(geometry)
    return result


def reverse_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for segment in reversed(segments):
        if segment["type"] == "LINE":
            result.append({"type": "LINE", "p0": segment["p1"], "p1": segment["p0"]})
        else:
            result.append(
                {"type": "CUBIC", "p0": segment["p1"], "c1": segment["c2"], "c2": segment["c1"], "p1": segment["p0"]}
            )
    return result


def rasterize_paths(graph: dict[str, Any], edge_geometries: dict[str, list[dict[str, Any]]] | None = None, flatten_tolerance: float = 0.0625) -> np.ndarray:
    height, width = graph["height"], graph["width"]
    output = np.zeros((height, width), dtype=np.int32)
    rings_by_region: dict[int, list[list[tuple[float, float]]]] = defaultdict(list)
    for ring in graph["_rings"]:
        rings_by_region[ring["regionId"]].append(ring_polyline(graph, ring, edge_geometries, flatten_tolerance))
    for region_id in sorted(rings_by_region):
        rings = rings_by_region[region_id]
        min_y = max(0, int(np.floor(min(point[1] for ring in rings for point in ring))))
        max_y = min(height, int(np.ceil(max(point[1] for ring in rings for point in ring))))
        for y in range(min_y, max_y):
            scan_y = y + 0.5
            intersections: list[float] = []
            for ring in rings:
                for first, second in zip(ring, ring[1:]):
                    x1, y1 = first
                    x2, y2 = second
                    if (y1 <= scan_y < y2) or (y2 <= scan_y < y1):
                        intersections.append(x1 + (scan_y - y1) * (x2 - x1) / (y2 - y1))
            intersections.sort()
            if len(intersections) % 2:
                raise BoundaryGraphError(f"odd scanline intersection count for region {region_id}")
            for left, right in zip(intersections[0::2], intersections[1::2]):
                start = max(0, int(np.ceil(left - 0.5 - 1e-10)))
                end = min(width, int(np.ceil(right - 0.5 - 1e-10)))
                if end <= start:
                    continue
                occupied = output[y, start:end]
                if np.any((occupied != 0) & (occupied != region_id)):
                    raise BoundaryGraphError("vector region paths overlap at pixel centers")
                output[y, start:end] = region_id
    return output
