"""M7 finite, size-independent Base search over the selected vector domains.

This module never reads raster labels, fills a hole, buffers a polygon, or moves
an inherited boundary. Returned polygons are diagnostic geometry; the caller
binds these actual objects to b2.result/1 geometry artifacts.
"""
from __future__ import annotations

from itertools import combinations
import hashlib
import json
import math

from shapely.geometry import Polygon, LineString
from shapely.ops import split, unary_union, linemerge
from shapely import normalize


class SolidPlanError(ValueError):
    """A source domain or proposed plan violates a hard geometric contract."""


def _parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [part for item in geometry.geoms for part in _parts(item)]
    return []


def _lines(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry] if geometry.length > 0 else []
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        return [part for item in geometry.geoms for part in _lines(item)]
    return []


def _key(geometry):
    return normalize(geometry).wkb_hex


def _sort(polygons):
    return sorted(polygons, key=lambda p: (*p.bounds, p.area, _key(p)))


def _tolerance(geometry):
    # Numerical verification only: this tolerance never changes geometry.
    return max(1.0, geometry.area) * 1e-9


def _boundary_tolerance(geometry):
    x0, y0, x1, y1 = geometry.bounds
    return max(1.0, x1-x0, y1-y0) * 1e-10


def _boundary_distance(a, b, geometry_cache=None):
    # Exact topology equality already proves zero Hausdorff distance, including
    # redundant collinear vertices introduced by a partition. GEOS Hausdorff
    # is substantially more expensive for detailed inherited vector boundaries.
    key = ("boundary-distance", a.wkb, b.wkb) if geometry_cache is not None else None
    if geometry_cache is not None and key in geometry_cache:
        return geometry_cache[key]
    value = 0.0 if a.equals(b) else a.boundary.hausdorff_distance(b.boundary)
    if geometry_cache is not None:
        geometry_cache[key] = value
    return value


def _symmetric_difference_area(a, b, geometry_cache=None):
    key = ("symmetric-difference-area", a.wkb, b.wkb) if geometry_cache is not None else None
    if geometry_cache is not None and key in geometry_cache:
        return geometry_cache[key]
    value = 0.0 if a.equals(b) else a.symmetric_difference(b).area
    if geometry_cache is not None:
        geometry_cache[key] = value
    return value


def _difference_area(a, b, geometry_cache=None):
    key = ("difference-area", a.wkb, b.wkb) if geometry_cache is not None else None
    if geometry_cache is not None and key in geometry_cache:
        return geometry_cache[key]
    value = a.difference(b).area
    if geometry_cache is not None:
        geometry_cache[key] = value
    return value


def _intersects_area(a, b):
    # An exact axis-aligned bbox broad phase cannot suppress a positive-area
    # intersection, and avoids many GEOS overlays across disconnected bodies.
    ax0, ay0, ax1, ay1 = a.bounds
    bx0, by0, bx1, by1 = b.bounds
    return (max(ax0, bx0) < min(ax1, bx1) and max(ay0, by0) < min(ay1, by1)
            and a.intersection(b).area > 0)


def _require_polygon(polygon, label, *, solid=False):
    if not isinstance(polygon, Polygon) or polygon.is_empty:
        raise SolidPlanError(f"{label}: expected a nonempty single Polygon")
    if not polygon.is_valid or polygon.area <= 0:
        raise SolidPlanError(f"{label}: invalid or nonpositive geometry")
    if not all(math.isfinite(value) for value in polygon.bounds):
        raise SolidPlanError(f"{label}: non-finite geometry")
    if solid and polygon.interiors:
        raise SolidPlanError(f"{label}: solid piece retains an interior hole")


def _sources(observed):
    if not observed:
        raise SolidPlanError("no observed vector domains")
    result, ids, slot_rgb = [], set(), {}
    for raw in observed:
        item = dict(raw)
        component_id = item.get("componentId", item.get("id"))
        if not component_id or component_id in ids:
            raise SolidPlanError("missing or duplicate source Component identity")
        ids.add(component_id)
        item["componentId"] = str(component_id)
        for field in ("regionId", "colorSlotId"):
            if not isinstance(item.get(field), str) or not item[field]:
                raise SolidPlanError(f"{component_id}: missing {field}")
        rgb = item.get("rgb")
        if not isinstance(rgb, (list, tuple)) or len(rgb) != 3 or any(type(v) is not int or not 0 <= v <= 255 for v in rgb):
            raise SolidPlanError(f"{component_id}: invalid exact RGB identity")
        if item["colorSlotId"] in slot_rgb and slot_rgb[item["colorSlotId"]] != tuple(rgb):
            raise SolidPlanError("one ColorSlot cannot have multiple RGB identities")
        slot_rgb[item["colorSlotId"]] = tuple(rgb)
        _require_polygon(item.get("polygon"), component_id)
        if not item.get("boundaryProvenance"):
            raise SolidPlanError(f"{component_id}: missing selected-vector provenance")
        result.append(item)
    result.sort(key=lambda x: (x["regionId"], x["componentId"]))
    foreground = unary_union([x["polygon"] for x in result])
    tolerance = _tolerance(foreground)
    if sum(x["polygon"].area for x in result) - foreground.area > tolerance:
        raise SolidPlanError("observed source domains have unauthorized area overlap")
    return result, foreground


def decompose_solid(polygon, axis="x"):
    """Cut through actual holes, then merge adjacent cells into solid polygons.

    Axis cuts are positive-length partitions, not zero-width slit geometries.
    Every positive-area cell survives. Greedy merging is confined to this one
    original domain and cannot merge unrelated equal-color components.
    """
    _require_polygon(polygon, "split source")
    if axis not in ("x", "y"):
        raise SolidPlanError("axis must be x or y")
    if not polygon.interiors:
        # No geometry operation occurred: validity and positive area above are
        # the complete solid check, and identity proves exact conservation.
        return [polygon]
    todo, completed = [polygon], []
    while todo:
        current = todo.pop(0)
        if not current.interiors:
            completed.append(current)
            continue
        hole = _sort([Polygon(ring) for ring in current.interiors])[0]
        point = hole.representative_point()
        x0, y0, x1, y1 = current.bounds
        margin = max(x1-x0, y1-y0, 1.0)
        cutter = (LineString([(point.x, y0-margin), (point.x, y1+margin)]) if axis == "x"
                  else LineString([(x0-margin, point.y), (x1+margin, point.y)]))
        cells = _sort(_parts(split(current, cutter)))
        if len(cells) < 2 or sum(len(p.interiors) for p in cells) >= len(current.interiors):
            raise SolidPlanError("hole cut made no topological progress; source requires an unsupported decomposition")
        if unary_union(cells).symmetric_difference(current).area > _tolerance(current):
            raise SolidPlanError("hole cut failed source conservation")
        todo.extend(cells)
    completed = _sort(completed)
    while True:
        merges = []
        for i, j in combinations(range(len(completed)), 2):
            shared = completed[i].boundary.intersection(completed[j].boundary).length
            if shared <= 0:
                continue
            merged = completed[i].union(completed[j])
            if isinstance(merged, Polygon) and merged.is_valid and not merged.interiors:
                merges.append((-shared, _key(merged), i, j, merged))
        if not merges:
            break
        _, _, i, j, merged = min(merges)
        completed = _sort([p for k, p in enumerate(completed) if k not in (i, j)] + [merged])
    for part in completed:
        _require_polygon(part, "split piece", solid=True)
    reconstructed = unary_union(completed)
    if reconstructed.symmetric_difference(polygon).area > _tolerance(polygon):
        raise SolidPlanError("solid partition failed conservation")
    if _boundary_distance(reconstructed, polygon) > _boundary_tolerance(polygon):
        raise SolidPlanError("solid partition displaced an inherited boundary")
    if sum(p.area for p in completed) - polygon.area > _tolerance(polygon):
        raise SolidPlanError("solid partition contains area overlap")
    return completed


def _group_seams(pieces, group_id):
    seams = []
    for a, b in combinations(pieces, 2):
        lines = _lines(a["polygon"].boundary.intersection(b["polygon"].boundary))
        if not lines:
            continue
        merged = unary_union(lines)
        if merged.geom_type == "MultiLineString":
            merged = linemerge(merged)
        for line in sorted(_lines(merged), key=_key):
            seams.append({"id": f"{group_id}-seam-{len(seams)+1}",
                          "pieceIds": [a["id"], b["id"]], "polyline": line,
                          "lengthCanonical": float(line.length),
                          "reason": "Axis cut through a source-domain hole; greedy valid-solid remerge retained this shared cut."})
    return seams


def _local_plan(sources, body, body_index, slot, axis, split_cache=None):
    pieces, exposures, groups = [], [], []

    def add_domain(domain, role, color, source_items, name):
        if split_cache is None:
            parts = decompose_solid(domain, axis)
        else:
            key = (domain.wkb, axis)
            if key not in split_cache:
                split_cache[key] = tuple(decompose_solid(domain, axis))
            parts = split_cache[key]
        group_id = f"{name}-split" if len(parts) > 1 else None
        members = []
        for index, polygon in enumerate(parts, 1):
            touching = [s for s in source_items if _intersects_area(s["polygon"], polygon)]
            member = {"id": f"{name}-piece-{index}", "role": role, "colorSlotId": color,
                      "sourceRegionIds": sorted({s["regionId"] for s in touching}),
                      "sourceComponentIds": sorted(s["componentId"] for s in touching),
                      "polygon": polygon, "splitGroupId": group_id,
                      "boundaryProvenance": {"operation": "EXACT_DOMAIN_PARTITION", "axis": axis,
                          "sources": [{"componentId": s["componentId"], "selectedVector": s["boundaryProvenance"]} for s in touching]}}
            pieces.append(member)
            members.append(member)
        if group_id:
            seams = _group_seams(members, group_id)
            if not seams:
                raise SolidPlanError("split geometry has no positive-length seam")
            groups.append({"id": group_id, "sourceRegionIds": sorted({s["regionId"] for s in source_items}),
                           "sourceComponentIds": sorted(s["componentId"] for s in source_items),
                           "pieceIds": [p["id"] for p in members], "seams": seams,
                           "sourcePolygon": domain, "partitionMethod": f"HOLE_AXIS_{axis.upper()}_GREEDY_SOLID_MERGE"})
        return members

    bases = add_domain(body, "BASE", slot, sources, f"body-{body_index}-base")
    for source in sources:
        if source["colorSlotId"] == slot:
            for base in bases:
                for exposed in _sort(_parts(source["polygon"].intersection(base["polygon"]))):
                    if exposed.area > 0:
                        exposures.append({"sourceRegionId": source["regionId"], "sourceComponentId": source["componentId"],
                                          "basePieceId": base["id"], "polygon": exposed})
        else:
            add_domain(source["polygon"], "VISIBLE", source["colorSlotId"], [source],
                       f"body-{body_index}-visible-{source['componentId']}")
    return {"pieces": pieces, "baseExposures": exposures, "splitGroups": groups,
            "baseChoices": [{"bodyId": f"body-{body_index}", "colorSlotId": slot, "splitAxis": axis,
                "sourceRegionIds": sorted({s["regionId"] for s in sources}),
                "sourceComponentIds": sorted(s["componentId"] for s in sources),
                "foregroundAreaCanonical": float(body.area), "globalHoleCount": len(body.interiors)}]}


def _score(plan, sources):
    all_lines, visible_lines = [], []
    pieces = {p["id"]: p for p in plan["pieces"]}
    original_boundaries = unary_union([s["polygon"].boundary for s in sources])
    for group in plan["splitGroups"]:
        for seam in group["seams"]:
            line = seam["polyline"]
            all_lines.append(line)
            a = pieces[seam["pieceIds"][0]]
            if a["role"] == "VISIBLE":
                exposed = line
            else:
                exposure = unary_union([e["polygon"] for e in plan["baseExposures"]
                                        if e["basePieceId"] in seam["pieceIds"]])
                exposed = line.intersection(exposure)
            visible_lines.extend(_lines(exposed))
            seam["visibleLengthCanonical"] = float(exposed.length)
            seam["interiorVisibleLengthCanonical"] = float(exposed.difference(original_boundaries).length)
            seam["visibilityReason"] = ("VISIBLE cut lies in the source visible domain" if a["role"] == "VISIBLE"
                                         else "BASE cut intersected with actual same-color Base exposures")
    all_seams, visible = unary_union(all_lines), unary_union(visible_lines)
    interior = visible.difference(original_boundaries)
    return {"visibleSeamLengthCanonical": float(visible.length),
            "interiorSeamLengthCanonical": float(interior.length),
            "totalSeamLengthCanonical": float(all_seams.length),
            "seamCount": len(_lines(linemerge(all_seams) if all_seams.geom_type == "MultiLineString" else all_seams)),
            "physicalSeamRecordCount": sum(len(g["seams"]) for g in plan["splitGroups"]),
            "pieceCount": len(plan["pieces"]),
            "vertexCount": sum(len(p["polygon"].exterior.coords)-1 for p in plan["pieces"]),
            "appearanceAreaErrorCanonical": 0.0,
            "proxyStatus": "EXPERIMENTAL_NOT_HUMAN_ACCEPTANCE"}


def _rank(plan):
    score = plan["score"]
    return [score["interiorSeamLengthCanonical"], score["visibleSeamLengthCanonical"],
            score["pieceCount"], score["vertexCount"], score["totalSeamLengthCanonical"]]


def validate_plan(observed, plan, *, geometry_cache=None):
    """Independent hard checks on returned geometry, references and seams."""
    sources, foreground = _sources(observed)
    tolerance = _tolerance(foreground)
    pieces = plan.get("pieces", [])
    by_id = {p["id"]: p for p in pieces}
    if not pieces or len(by_id) != len(pieces):
        raise SolidPlanError("missing or duplicate final Piece identity")
    source_by_component = {s["componentId"]: s for s in sources}
    source_by_region = {r: [s for s in sources if s["regionId"] == r] for r in {s["regionId"] for s in sources}}
    bases, visible = [], []
    for piece in pieces:
        _require_polygon(piece["polygon"], piece["id"], solid=True)
        if piece["role"] not in ("BASE", "VISIBLE"):
            raise SolidPlanError("unknown Piece role")
        if piece["colorSlotId"] not in {s["colorSlotId"] for s in sources}:
            raise SolidPlanError("unknown exact ColorSlot identity")
        if not piece["sourceComponentIds"] or any(c not in source_by_component for c in piece["sourceComponentIds"]):
            raise SolidPlanError("dangling source Component")
        source_items = [source_by_component[c] for c in piece["sourceComponentIds"]]
        if set(piece["sourceRegionIds"]) != {s["regionId"] for s in source_items}:
            raise SolidPlanError("incorrect source Region mapping")
        if _difference_area(piece["polygon"], foreground, geometry_cache) > tolerance:
            raise SolidPlanError("piece changes foreground boundary or global void")
        if piece["role"] == "VISIBLE":
            if any(s["colorSlotId"] != piece["colorSlotId"] for s in source_items):
                raise SolidPlanError("VISIBLE exact ColorSlot mismatch")
            domain = unary_union([s["polygon"] for s in source_items])
            if _difference_area(piece["polygon"], domain, geometry_cache) > tolerance:
                raise SolidPlanError("VISIBLE invents hidden geometry")
            visible.append(piece["polygon"])
        else:
            bases.append(piece["polygon"])
    base_union = unary_union(bases)
    foreground_error = _symmetric_difference_area(base_union, foreground, geometry_cache)
    if foreground_error > tolerance:
        raise SolidPlanError("Base outer boundary/global hole coverage mismatch")
    boundary_error = _boundary_distance(base_union, foreground, geometry_cache)
    if boundary_error > _boundary_tolerance(foreground):
        raise SolidPlanError("Base displaced an inherited outer or void boundary")
    if sum(p.area for p in bases) - base_union.area > tolerance:
        raise SolidPlanError("unauthorized Base partition overlap")
    if sum(p.area for p in visible) - unary_union(visible).area > tolerance:
        raise SolidPlanError("unauthorized VISIBLE overlap")
    rendered = []
    max_source_error = 0.0
    for source in sources:
        presentations = [p["polygon"] for p in pieces if p["role"] == "VISIBLE" and source["componentId"] in p["sourceComponentIds"]]
        for exposure in plan["baseExposures"]:
            if exposure.get("sourceComponentId") != source["componentId"]:
                continue
            base = by_id.get(exposure["basePieceId"])
            if base is None or base["role"] != "BASE" or base["colorSlotId"] != source["colorSlotId"]:
                raise SolidPlanError("Base exposure identity or exact color mismatch")
            if exposure["sourceRegionId"] != source["regionId"]:
                raise SolidPlanError("Base exposure source Region mismatch")
            _require_polygon(exposure["polygon"], "exposure")
            if _difference_area(exposure["polygon"], base["polygon"], geometry_cache) > tolerance:
                raise SolidPlanError("Base exposure lacks actual Base support")
            presentations.append(exposure["polygon"])
        union = unary_union(presentations)
        error = _symmetric_difference_area(union, source["polygon"], geometry_cache)
        max_source_error = max(max_source_error, error)
        if error > tolerance or sum(p.area for p in presentations)-union.area > tolerance:
            raise SolidPlanError("source coverage missing, duplicated or wrong domain")
        if _boundary_distance(union, source["polygon"], geometry_cache) > _boundary_tolerance(source["polygon"]):
            raise SolidPlanError("source presentation displaced an inherited boundary")
        rendered.extend(presentations)
    for exposure in plan["baseExposures"]:
        if exposure.get("sourceComponentId") not in source_by_component or exposure["sourceRegionId"] not in source_by_region:
            raise SolidPlanError("dangling Base exposure source")
    if sum(p.area for p in rendered)-unary_union(rendered).area > tolerance:
        raise SolidPlanError("source presentations overlap")
    all_group_ids, grouped, all_seam_ids = set(), set(), set()
    for group in plan["splitGroups"]:
        if group["id"] in all_group_ids:
            raise SolidPlanError("duplicate SplitGroup identity")
        all_group_ids.add(group["id"])
        if len(group["pieceIds"]) < 2 or len(set(group["pieceIds"])) != len(group["pieceIds"]):
            raise SolidPlanError("invalid split membership")
        members = []
        for pid in group["pieceIds"]:
            if pid not in by_id or pid in grouped or by_id[pid]["splitGroupId"] != group["id"]:
                raise SolidPlanError("split membership or back-reference mismatch")
            grouped.add(pid)
            members.append(by_id[pid])
        if set(group["sourceRegionIds"]) != {r for p in members for r in p["sourceRegionIds"]}:
            raise SolidPlanError("split source Region mismatch")
        partition = unary_union([p["polygon"] for p in members])
        if _symmetric_difference_area(partition, group["sourcePolygon"], geometry_cache) > tolerance:
            raise SolidPlanError("SplitGroup fails source conservation")
        expected = _group_seams(members, group["id"])
        if not expected or len(expected) != len(group["seams"]):
            raise SolidPlanError("missing or duplicate seam record")
        for seam in group["seams"]:
            if seam["id"] in all_seam_ids:
                raise SolidPlanError("duplicate seam identity")
            all_seam_ids.add(seam["id"])
            a, b = seam["pieceIds"]
            if a == b or a not in group["pieceIds"] or b not in group["pieceIds"]:
                raise SolidPlanError("seam endpoints must be two member Pieces")
            line = seam["polyline"]
            if not isinstance(line, LineString) or not line.is_valid or line.length <= 0:
                raise SolidPlanError("invalid seam geometry")
            if not math.isfinite(seam["lengthCanonical"]) or abs(line.length-seam["lengthCanonical"]) > 1e-8:
                raise SolidPlanError("seam length measurement mismatch")
            matches = [s for s in expected if set(s["pieceIds"]) == {a,b} and line.equals(s["polyline"])]
            if len(matches) != 1:
                raise SolidPlanError("seam does not equal actual shared cut boundary")
        signatures = [(tuple(sorted(s["pieceIds"])), _key(s["polyline"])) for s in group["seams"]]
        if len(set(signatures)) != len(signatures):
            raise SolidPlanError("duplicate physical seam geometry")
    for piece in pieces:
        if (piece["splitGroupId"] is not None) != (piece["id"] in grouped):
            raise SolidPlanError("unrecorded split membership")
    return {"solidGeometry": "PASS", "sourceCoverage": "PASS", "splitConservation": "PASS",
            "frozenBoundaryAndVoids": "PASS", "addedSeams": "PASS", "baseSupport": "PASS",
            "maximumSourceSymmetricDifferenceArea": max_source_error,
            "foregroundSymmetricDifferenceArea": float(foreground_error),
            "inheritedBoundaryHausdorffCanonical": float(boundary_error),
            "boundaryVerificationToleranceCanonical": _boundary_tolerance(foreground),
            "areaVerificationTolerance": tolerance}


def propose_plans(observed):
    """Search exact Base colors and two deterministic hole-cut directions.

    Every disconnected body receives a separate Base. Finite global proposals
    comprise every uniform color strategy plus the independently best local
    choices; no exponential search or synthetic connecting geometry is used.
    """
    sources, foreground = _sources(observed)
    body_options, rejected = [], []
    # Immutable Shapely polygons, cache lifetime limited to this one search.
    # All colors/axes are still evaluated; only repeated identical partitions
    # are reused. This does not alter geometry, IDs or the finite search set.
    split_cache = {}
    geometry_cache = {}
    for body_index, body in enumerate(_sort(_parts(foreground)), 1):
        members = [s for s in sources if _intersects_area(s["polygon"], body)]
        options = []
        for slot in sorted({s["colorSlotId"] for s in members}):
            for axis in ("x", "y"):
                try:
                    option = _local_plan(members, body, body_index, slot, axis, split_cache)
                except SolidPlanError as exc:
                    rejected.append({"bodyId": f"body-{body_index}", "colorSlotId": slot,
                                     "splitAxis": axis, "reason": str(exc)})
                    continue
                option["score"] = _score(option, members)
                options.append(option)
        if not options:
            raise SolidPlanError("No valid Base/solid partition for body: " + json.dumps(rejected, sort_keys=True))
        options.sort(key=lambda p: (_rank(p), json.dumps(p["baseChoices"], sort_keys=True)))
        body_options.append(options)
    combinations_to_try = [[opts[0] for opts in body_options]]
    for slot in sorted({s["colorSlotId"] for s in sources}):
        for axis in ("x", "y"):
            combinations_to_try.append([next((o for o in opts if o["baseChoices"][0]["colorSlotId"] == slot and o["baseChoices"][0]["splitAxis"] == axis), opts[0]) for opts in body_options])
    results, seen = [], set()
    for combination in combinations_to_try:
        plan = {key: [value for option in combination for value in option[key]]
                for key in ("pieces", "baseExposures", "splitGroups", "baseChoices")}
        signature = json.dumps(sorted((p["role"], p["colorSlotId"], tuple(p["sourceComponentIds"]), _key(p["polygon"])) for p in plan["pieces"]))
        if signature in seen:
            continue
        seen.add(signature)
        plan["id"] = "m7-plan-" + hashlib.sha256(signature.encode()).hexdigest()[:16]
        plan["geometryChecks"] = validate_plan(sources, plan, geometry_cache=geometry_cache)
        plan["rejectedCandidates"] = rejected
        plan["score"] = _score(plan, sources)
        plan["rankingKey"] = _rank(plan)
        plan["selectionReasons"] = ["Hard geometry, inherited boundary, global void, exact-color exposure and coverage checks passed.",
            "Rank experimentally by exposed interior seam length, total exposed seam length, then piece/vertex count and total cut length.",
            "Base support spans only actual connected foreground; VISIBLE pieces are exact partitions of their original visible domains.",
            "Seam visibility is closed-domain intersection length, not calibrated human/material acceptance."]
        results.append(plan)
    results.sort(key=lambda p: (p["rankingKey"], p["id"]))
    return results
