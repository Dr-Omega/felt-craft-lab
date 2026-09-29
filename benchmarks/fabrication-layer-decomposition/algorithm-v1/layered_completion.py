"""Opt-in, exact-appearance fabrication completion with piece-level ordering.

Visible source domains are observations, not hidden-shape ground truth. The
bounded proposals below infer hidden material only under actual foreground
occluders. This module does not modify the legacy solid-plan contract.
"""
from __future__ import annotations

import hashlib
import json
import math
from itertools import combinations

from shapely import shortest_line
from shapely.geometry import GeometryCollection, LineString, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from coverage_geometry import ordered_coverage
from vertex_partition import partition as vertex_partition

from solid_plans import (_key, _lines, _parts, _sources, _tolerance,
                         _require_polygon, decompose_solid, SolidPlanError,
                         propose_plans as propose_legacy_plans)

STRATEGY = "layered-completion/1"
MAX_BRIDGE_PROPOSALS = 64
MAX_ACCEPTED_BRIDGES = 16


class LayeredPlanError(ValueError):
    """An actual layered construction fails source/coverage/order contracts."""


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _positive(a, b):
    ax, ay, az, aw = a.bounds
    bx, by, bz, bw = b.bounds
    return (max(ax, bx) < min(az, bz) and max(ay, by) < min(aw, bw)
            and a.intersection(b).area > 0)


def _same_domain(a, b, tolerance):
    """Compare complete area and boundary, not only an overlay area residual."""
    if a.equals(b):
        return True
    if a.is_empty or b.is_empty:
        return False
    scale = max(1., *(abs(value) for value in (*a.bounds, *b.bounds)))
    return (a.symmetric_difference(b).area <= tolerance
            and a.boundary.hausdorff_distance(b.boundary) <= scale * 1e-10)


def _hidden_domain(full, above):
    parts = _parts(full.intersection(above))
    return unary_union(parts) if parts else Polygon()


def _topological(ids, edges):
    pending = {identifier: set() for identifier in ids}
    children = {identifier: set() for identifier in ids}
    for below, above in edges:
        if below == above or below not in pending or above not in pending:
            raise LayeredPlanError("invalid piece-level order edge")
        pending[above].add(below)
        children[below].add(above)
    ready = sorted(identifier for identifier, parents in pending.items() if not parents)
    order = []
    while ready:
        identifier = ready.pop(0)
        order.append(identifier)
        for child in sorted(children[identifier]):
            pending[child].remove(identifier)
            if not pending[child]:
                ready.append(child)
                ready.sort()
    if len(order) != len(ids):
        raise LayeredPlanError("inferred piece occlusion contains a cycle")
    return order


def _group_edges(groups):
    tree = STRtree([group["visible"] for group in groups])
    edges = set()
    for index, group in enumerate(groups):
        for other in tree.query(group["full"]):
            other = int(other)
            if index != other and _positive(group["full"], groups[other]["visible"]):
                edges.add((str(index), str(other)))
    _topological([str(i) for i in range(len(groups))], edges)
    return edges


def _group(source):
    return {"sources": [source], "visible": source["polygon"], "full": source["polygon"],
            "evidence": [{"method": "observed-domain", "inferredHiddenGeometry": False}]}


def _filled_groups(sources, foreground):
    groups = [_group(source) for source in sources]
    for index, group in enumerate(groups):
        shell = Polygon(group["visible"].exterior)
        if not group["visible"].interiors or shell.difference(foreground).area > 0:
            continue  # A real transparency hole is never converted into material.
        proposal = dict(group, full=shell, evidence=[{
            "method": "foreground-supported-hole-completion", "inferredHiddenGeometry": True,
            "filledHoleCount": len(group["visible"].interiors),
            "hiddenAreaCanonical": float(shell.difference(group["visible"]).area)}])
        trial = [proposal if i == index else value for i, value in enumerate(groups)]
        try:
            _group_edges(trial)
        except LayeredPlanError:
            continue
        groups = trial
    return groups


def _bridge(a, b, foreground):
    if a["sources"][0]["colorSlotId"] != b["sources"][0]["colorSlotId"]:
        return None
    visible = a["visible"].union(b["visible"])
    full = a["full"].union(b["full"]).convex_hull
    if not isinstance(full, Polygon) or full.difference(foreground).area > 0:
        return None
    hidden = full.difference(visible)
    # Local shape evidence limits proposals; it is not a safety tolerance and
    # does not alter observations. Very large speculative hidden boards lose.
    if hidden.area > visible.area or full.equals(a["full"].union(b["full"])):
        return None
    connector = shortest_line(a["visible"], b["visible"])
    gap = connector.length
    widths = [min(g.bounds[2]-g.bounds[0], g.bounds[3]-g.bounds[1])
              for g in (a["visible"], b["visible"])]
    if gap <= 0 or gap > 2 * max(widths):
        return None
    (x0, y0), (x1, y1) = connector.coords
    mx, my = (x0+x1)/2, (y0+y1)/2
    reach = max(full.bounds[2]-full.bounds[0], full.bounds[3]-full.bounds[1]) * 2
    dx, dy = -(y1-y0)/gap, (x1-x0)/gap
    cross_section = LineString([(mx-dx*reach, my-dy*reach), (mx+dx*reach, my+dy*reach)])
    bridge_width = full.intersection(cross_section).length
    if bridge_width < min(widths) * 0.25:
        return None
    return {"sources": sorted(a["sources"]+b["sources"], key=lambda s: s["componentId"]),
            "visible": visible, "full": full, "evidence": a["evidence"]+b["evidence"]+[{
                "method": "local-foreground-supported-convex-completion",
                "inferredHiddenGeometry": True, "observedGapCanonical": float(gap),
                "bridgeCrossSectionCanonical": float(bridge_width),
                "minimumSupportedWidthCanonical": float(min(widths)*0.25),
                "hiddenToVisibleArea": float(hidden.area/visible.area)}]}


def _joined_groups(groups, foreground):
    groups = list(groups)
    attempted = accepted = 0
    while attempted < MAX_BRIDGE_PROPOSALS and accepted < MAX_ACCEPTED_BRIDGES:
        pairs = [(a["visible"].distance(b["visible"]), i, j)
                 for (i, a), (j, b) in combinations(enumerate(groups), 2)
                 if a["sources"][0]["colorSlotId"] == b["sources"][0]["colorSlotId"]]
        changed = False
        for _, i, j in sorted(pairs):
            attempted += 1
            merged = _bridge(groups[i], groups[j], foreground)
            if merged is not None:
                trial = [g for k, g in enumerate(groups) if k not in (i, j)] + [merged]
                try:
                    _group_edges(trial)
                except LayeredPlanError:
                    pass
                else:
                    groups, changed = trial, True
                    accepted += 1
                    break
            if attempted >= MAX_BRIDGE_PROPOSALS:
                break
        if not changed:
            break
    return groups, {"bridgeProposalsExamined": attempted, "bridgesAccepted": accepted,
                    "bridgeProposalLimit": MAX_BRIDGE_PROPOSALS,
                    "acceptedBridgeLimit": MAX_ACCEPTED_BRIDGES}


def _materialize(groups, sources, axis, mode, diagnostics=None):
    pieces = []
    for group in groups:
        for full in vertex_partition(group["full"], axis):
            visible = full.intersection(group["visible"])
            if visible.area <= 0:
                raise LayeredPlanError("completion would manufacture a wholly hidden useless piece")
            actual_sources = [s for s in group["sources"] if _positive(visible, s["polygon"])]
            first = actual_sources[0]
            identifier = "LP-" + _digest({"full": _key(full), "visible": _key(visible),
                "color": first["colorSlotId"], "sources": [s["componentId"] for s in actual_sources]})[:20]
            pieces.append({"id": identifier, "polygon": full, "visiblePolygon": visible,
                           "hiddenPolygon": full.difference(visible), "colorSlotId": first["colorSlotId"],
                           "rgb": list(first["rgb"]), "sourceComponentIds": sorted(s["componentId"] for s in actual_sources),
                           "sourceRegionIds": sorted({s["regionId"] for s in actual_sources}),
                           "completionEvidence": group["evidence"]})
    pieces.sort(key=lambda p: p["id"])
    tree = STRtree([p["visiblePolygon"] for p in pieces])
    required_edges = set()
    for p in pieces:
        for index in tree.query(p["polygon"]):
            q = pieces[int(index)]
            if p["id"] != q["id"] and _positive(p["polygon"], q["visiblePolygon"]):
                required_edges.add((p["id"], q["id"]))
    order = _topological([p["id"] for p in pieces], required_edges)
    position = {identifier: i for i, identifier in enumerate(order)}
    edges = []
    full_tree = STRtree([p["polygon"] for p in pieces])
    for p in pieces:
        p["occluderIds"] = sorted(pieces[int(i)]["id"] for i in full_tree.query(p["polygon"])
            if position[pieces[int(i)]["id"]] > position[p["id"]]
            and _positive(p["polygon"], pieces[int(i)]["polygon"]))
        edges.extend({"belowPieceId": p["id"], "abovePieceId": above} for above in p["occluderIds"])
    # Hidden material is the actual ordered overlap, not full minus a rounded
    # source-derived visible overlay. The latter cancellation can erase a tiny
    # non-axis-aligned domain far from the remaining hidden boundary. Do not
    # drop such domains by area: retain the exact polygonal ordered intersection.
    by_id = {p["id"]: p for p in pieces}
    above = []
    for identifier in reversed(order):
        p = by_id[identifier]
        _, p["hiddenPolygon"], computed_occluders = ordered_coverage(p["polygon"], above)
        if computed_occluders != p['occluderIds']:
            raise LayeredPlanError('construction coverage and occluders disagree')
        above.append((identifier, p["polygon"]))
    plan = {"strategy": STRATEGY, "pieces": pieces, "bottomToTop": order,
            "occlusionEdges": sorted(edges, key=lambda e: (e["belowPieceId"], e["abovePieceId"])),
            "proposal": {"mode": mode, "splitAxis": axis, **(diagnostics or {})}}
    plan["id"] = "layered-" + _digest({"pieces": [p["id"] for p in pieces], "order": order})[:20]
    plan["physicalSeams"] = _seams(pieces)
    plan["geometryChecks"] = validate_layered_plan(sources, plan)
    return plan


def _seams(pieces):
    result = []
    tree = STRtree([p["polygon"] for p in pieces])
    for i, a in enumerate(pieces):
        for j in sorted(int(k) for k in tree.query(a["polygon"])):
            b = pieces[j]
            if (j <= i or a["colorSlotId"] != b["colorSlotId"]
                    or _positive(a["polygon"], b["polygon"])):
                continue
            shared = a["polygon"].boundary.intersection(b["polygon"].boundary)
            for line in sorted(_lines(shared), key=_key):
                exposed = line.intersection(a["visiblePolygon"].boundary).intersection(b["visiblePolygon"].boundary)
                result.append({"id": "layered-seam-"+str(len(result)+1),
                    "pieceIds": [a["id"], b["id"]], "polyline": line,
                    "lengthCanonical": float(line.length),
                    "kind": "SAME_COLOR_MATERIAL_CUT", "visibleLengthCanonical": float(exposed.length)})
    return result


def validate_layered_plan(observed, plan):
    """Reusable scoring entry rechecks actual geometry and every source claim."""
    sources, foreground = _sources(observed)
    tolerance = _tolerance(foreground)
    if plan.get("strategy") != STRATEGY or not plan.get("pieces"):
        raise LayeredPlanError("missing versioned layered construction")
    pieces = plan["pieces"]
    ids = [p["id"] for p in pieces]
    order = plan.get("bottomToTop", [])
    if len(set(ids)) != len(ids) or len(order) != len(ids) or set(order) != set(ids):
        raise LayeredPlanError("missing or duplicate piece order")
    by_id = {p["id"]: p for p in pieces}
    actual_visible, actual_edges = [], []
    collected = {s["componentId"]: [] for s in sources}
    source_tree = STRtree([s["polygon"] for s in sources])
    above = GeometryCollection()
    for index in range(len(order)-1, -1, -1):
        identifier = order[index]
        p = by_id[identifier]
        full = p["polygon"]
        _require_polygon(full, identifier, solid=True)
        if full.difference(foreground).area > tolerance:
            raise LayeredPlanError("full piece enters genuine transparent foreground gap")
        occluders = [above for above in order[index+1:] if _positive(full, by_id[above]["polygon"])]
        visible, hidden, coverage_occluders = ordered_coverage(
            full, [(pid, by_id[pid]['polygon']) for pid in order[index+1:]])
        if coverage_occluders != sorted(occluders):
            raise LayeredPlanError('validation coverage and occluders disagree')
        if visible.area <= 0:
            raise LayeredPlanError("useless wholly hidden piece")
        if (not _same_domain(visible, p["visiblePolygon"], tolerance)
                or not _same_domain(hidden, p["hiddenPolygon"], tolerance)):
            raise LayeredPlanError("declared visible or hidden geometry differs from real ordered coverage")
        if p.get("occluderIds") != sorted(occluders):
            raise LayeredPlanError("missing or incorrect actual occluder identity")
        evidence = p.get("completionEvidence")
        if (not isinstance(evidence, list) or not evidence
                or any(not isinstance(e, dict) or not isinstance(e.get("method"), str)
                       or not e["method"] or type(e.get("inferredHiddenGeometry")) is not bool
                       for e in evidence)
                or (hidden.area > 0 and not any(e["inferredHiddenGeometry"] for e in evidence))):
            raise LayeredPlanError("hidden material requires explicit completion hypothesis evidence")
        if hidden.area > 0 and not occluders:
            raise LayeredPlanError("hidden material lacks an actual positive-area occluder")
        actual_edges.extend({"belowPieceId": identifier, "abovePieceId": other} for other in occluders)
        matching = []
        for source_index in source_tree.query(visible):
            source = sources[int(source_index)]
            if not _positive(visible, source["polygon"]):
                continue
            if p["colorSlotId"] != source["colorSlotId"] or list(p["rgb"]) != list(source["rgb"]):
                raise LayeredPlanError("actual visible piece changes exact source color")
            matching.append(source)
            collected[source["componentId"]].append(visible.intersection(source["polygon"]))
        if (p.get("sourceComponentIds") != sorted(s["componentId"] for s in matching)
                or p.get("sourceRegionIds") != sorted({s["regionId"] for s in matching})):
            raise LayeredPlanError("visible source Component/Region membership mismatch")
        expected = unary_union([s["polygon"].intersection(full) for s in matching])
        if not _same_domain(visible, expected, tolerance):
            raise LayeredPlanError("piece visible geometry no longer matches original complete source domain")
        actual_visible.append(visible)
        above = unary_union([above, full])
    if not _same_domain(above, foreground, tolerance):
        raise LayeredPlanError("final foreground full domain/boundary differs")
    for source in sources:
        reconstructed = unary_union(collected[source["componentId"]])
        if not _same_domain(reconstructed, source["polygon"], tolerance):
            raise LayeredPlanError("complete source domain/boundary differs: " + source["componentId"])
    if plan.get("occlusionEdges") != sorted(actual_edges, key=lambda e: (e["belowPieceId"], e["abovePieceId"])):
        raise LayeredPlanError("piece-level occlusion graph differs from actual overlaps")
    actual_seams = _seams(pieces)
    declared = plan.get("physicalSeams")
    if declared is None or len(declared) != len(actual_seams):
        raise LayeredPlanError("missing actual visible cut seam records")
    for a, b in zip(declared, actual_seams):
        if (a.get("pieceIds") != b["pieceIds"] or not a["polyline"].equals(b["polyline"])
                or abs(a.get("lengthCanonical", -1)-b["lengthCanonical"]) > 1e-9
                or abs(a.get("visibleLengthCanonical", -1)-b["visibleLengthCanonical"]) > 1e-9):
            raise LayeredPlanError("physical seam geometry or identity mismatch")
    return {"solidGeometry": "PASS", "exactVisibleCoverage": "PASS", "sourceBinding": "PASS",
            "actualOcclusion": "PASS", "trueTransparencyPreserved": "PASS"}


def rank_layered_plans(observed, plans):
    """Never trust persisted scores or cached PASS records supplied by a caller."""
    sources, foreground = _sources(observed)
    if not plans:
        raise LayeredPlanError("cannot rank an empty or omitted candidate collection")
    for plan in plans:
        plan["geometryChecks"] = validate_layered_plan(sources, plan)
        pieces = {p["id"]: p for p in plan["pieces"]}
        depth = {identifier: 1 for identifier in plan["bottomToTop"]}
        for identifier in plan["bottomToTop"]:
            for above in pieces[identifier]["occluderIds"]:
                depth[above] = max(depth[above], depth[identifier]+1)
        seam_length = sum(s["visibleLengthCanonical"] for s in plan["physicalSeams"])
        hidden = sum(p["hiddenPolygon"].area for p in pieces.values())
        overlap_boundary = sum(p["hiddenPolygon"].boundary.intersection(p["visiblePolygon"].boundary).length
                               for p in pieces.values())
        score = {"appearanceAreaErrorCanonical": 0.0, "pieceCount": len(pieces),
            "microPieceCountAreaLe4": sum(p["polygon"].area <= 4 for p in pieces.values()),
            "visibleSeamLengthCanonical": float(seam_length), "physicalSeamRecordCount": len(plan["physicalSeams"]),
            "totalSeamLengthCanonical": float(sum(s["lengthCanonical"] for s in plan["physicalSeams"])),
            "overlapBoundaryLengthCanonical": float(overlap_boundary),
            "hiddenAreaCanonical": float(hidden), "hiddenAreaToForegroundRatio": float(hidden/foreground.area),
            "layerDepth": max(depth.values()), "occlusionEdgeCount": len(plan["occlusionEdges"]),
            "vertexCount": sum(len(p["polygon"].exterior.coords)-1 for p in pieces.values()),
            "proxyStatus": "EXPERIMENTAL_NOT_HUMAN_ACCEPTANCE"}
        score["normalizedVisibleSeamLength"] = score["visibleSeamLengthCanonical"] / math.sqrt(foreground.area)
        score["decisionCostVersion"] = "layered-balanced-cost/1"
        score["decisionCost"] = (score["pieceCount"] + 4*score["microPieceCountAreaLe4"]
            + 12*score["normalizedVisibleSeamLength"] + 0.2*score["hiddenAreaToForegroundRatio"]
            + 0.02*score["vertexCount"] + 0.5*(score["layerDepth"]-1))
        plan["score"] = score
        plan["rankingKey"] = [score["appearanceAreaErrorCanonical"],
            score["decisionCost"], score["visibleSeamLengthCanonical"], score["pieceCount"], score["hiddenAreaToForegroundRatio"],
            score["vertexCount"], score["layerDepth"]]
    return sorted(plans, key=lambda p: (p["rankingKey"], p["id"]))


def propose_layered_plans(observed):
    """At most nine exact-appearance candidates; all proposals are default-off.

    Hole completion supports ordinary middle layers, not just a universal Base.
    A bounded local bridge search joins same-color domains only under actual
    foreground and an acyclic piece order; it never joins through transparency.
    """
    sources, foreground = _sources(observed)
    initial = [_group(source) for source in sources]
    filled = _filled_groups(sources, foreground)
    joined, diagnostics = _joined_groups(filled, foreground)
    joined_first, early_diagnostics = _joined_groups(initial, foreground)
    plans = {}
    trials = []
    for mode, groups in (("observed-solid-partition", initial),
                         ("supported-hole-completion", filled),
                         ("supported-hole-and-bridge-completion", joined),
                         ("supported-bridge-without-hole-completion", joined_first)):
        for axis in ("x", "y"):
            try:
                detail = diagnostics if groups is joined else early_diagnostics if groups is joined_first else None
                plan = _materialize(groups, sources, axis, mode, detail)
            except (LayeredPlanError, SolidPlanError) as error:
                trials.append({"mode": mode, "splitAxis": axis, "status": "REJECTED", "reason": str(error)})
                continue
            trials.append({"mode": mode, "splitAxis": axis, "status": "VALID", "planId": plan["id"]})
            plans.setdefault(plan["id"], plan)
    # Retain a proven existing support choice rather than forcing the new local
    # completion proposals to rediscover it. Its source membership is rebuilt
    # from actual same-color visible intersections, never legacy BASE claims.
    try:
        legacy = propose_legacy_plans(sources, reject_invalid_options=True, clip_numeric_parts=True)[0]
        legacy_groups = []
        for piece in legacy["pieces"]:
            matching = [s for s in sources if s["colorSlotId"] == piece["colorSlotId"]
                        and _positive(piece["polygon"], s["polygon"])]
            visible = unary_union([s["polygon"] for s in matching]).intersection(piece["polygon"])
            if visible.area <= 0:
                raise LayeredPlanError("legacy support includes an invisible useless piece")
            legacy_groups.append({"sources": matching, "visible": visible, "full": piece["polygon"],
                "evidence": [{"method": "LEGACY_BASE_SUPPORT_REUSED", "legacyPlanId": legacy["id"],
                              "inferredHiddenGeometry": piece["polygon"].difference(visible).area > 0}]})
        converted = _materialize(legacy_groups, sources, "x", "LEGACY_BASE_SUPPORT_REUSED")
        trials.append({"mode": "LEGACY_BASE_SUPPORT_REUSED", "status": "VALID", "planId": converted["id"]})
        plans.setdefault(converted["id"], converted)
    except (LayeredPlanError, SolidPlanError) as error:
        trials.append({"mode": "LEGACY_BASE_SUPPORT_REUSED", "status": "REJECTED", "reason": str(error)})
    if not plans:
        raise LayeredPlanError("no legally representable layered completion candidate")
    for plan in plans.values():
        plan["proposalSearch"] = trials
    return rank_layered_plans(sources, list(plans.values()))
