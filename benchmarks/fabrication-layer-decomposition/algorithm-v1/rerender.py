"""Independent dereference, geometry checks and actual final-Piece rendering.

Only serialized wire references and their hash-bound GeoJSON are authoritative.
No cached M7 plan, source labels or previously rendered image supplies pixels.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import sys

import numpy as np
from shapely import intersects_xy
from shapely.geometry import LineString, Polygon, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from m4_checks import render_polygons
from m1_adapter import canonical_bytes, run_shared_validation
from relations import validate_relations
from solid_plans import SolidPlanError, validate_plan


class RerenderError(ValueError):
    """The referenced result cannot be verified or rendered as a valid plan."""


def _pixel_window(polygon, shape_hw):
    x0, y0, x1, y1 = polygon.bounds
    left, top = max(0, math.floor(x0)), max(0, math.floor(y0))
    right, bottom = min(shape_hw[1], math.ceil(x1)), min(shape_hw[0], math.ceil(y1))
    yy, xx = np.mgrid[top:bottom, left:right]
    return (slice(top, bottom), slice(left, right)), xx+0.5, yy+0.5


def _render_closed(objects, shape_hw):
    # Reuse the actual-polygon renderer for interior samples. Exact boundary
    # samples use the same paint order, so a new split seam cannot erase alpha.
    canvas = np.zeros((*shape_hw, 4), dtype=np.uint8)
    for obj in objects:
        layer = render_polygons([obj], shape_hw)
        window, xx, yy = _pixel_window(obj["polygon"], shape_hw)
        boundary = intersects_xy(obj["polygon"].boundary, xx, yy)
        layer[window][boundary] = [*obj['rgb'], 255]
        mask = layer[..., 3] > 0
        canvas[mask] = layer[mask]
    return canvas


def _finite_coordinates(value):
    if isinstance(value, (list, tuple)):
        return all(_finite_coordinates(item) for item in value)
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def verify_and_render(result_wire: dict, geometry_document: dict, observed: list, shape_hw: tuple) -> dict:
    """Verify actual referenced solids, source coverage and order, then paint.

    ``mismatchPixelCount`` excludes only a mathematically ambiguous *exact*
    original boundary sample when the actual pixel equals one of its adjacent
    source colors. ``rawMismatchPixelCount`` retains the direct image diff.
    No interior pixel or displaced geometry can pass via that boundary rule.
    """
    if len(shape_hw) != 2 or any(type(v) is not int or v <= 0 for v in shape_hw):
        raise RerenderError("shape_hw must contain positive integer height and width")
    if result_wire.get("schemaVersion") != "b2.result/1":
        raise RerenderError("expected the real b2.result/1 wire result")
    checked_result = run_shared_validation(result=result_wire)
    if not checked_result["ok"]:
        raise RerenderError("shared result identity/contract verification failed: " + str(checked_result.get("result")))
    payload = result_wire["payload"]
    source = payload["input"]
    artifacts = source["artifacts"]
    artifact_ids = {a["id"] for a in artifacts}
    if len(artifact_ids) != len(artifacts):
        raise RerenderError("duplicate artifact identity")
    artifact_id = "fabrication-geometry.json"
    matching = [a for a in artifacts if a["id"] == artifact_id]
    if len(matching) != 1:
        raise RerenderError("missing fabrication geometry artifact identity")
    data = canonical_bytes(geometry_document)
    if (matching[0]["sha256"] != hashlib.sha256(data).hexdigest()
            or matching[0]["byteLength"] != len(data)
            or matching[0]["identityMode"] not in ("EXACT_BYTES", "TEXT_LF_UTF8")):
        raise RerenderError("fabrication geometry document does not match its artifact digest/length")
    frame_id = source["coordinates"]["canonicalFrameId"]
    frames = [f for f in source["coordinates"]["frames"] if f["id"] == frame_id]
    if (len(frames) != 1 or frames[0]["space"] != "fabrication-canonical"
            or frames[0]["bounds"] != [0, 0, shape_hw[1], shape_hw[0]]
            or frames[0]["xDirection"] != "RIGHT" or frames[0]["yDirection"] != "DOWN"):
        raise RerenderError("canonical frame must match the actual rendered canvas and orientation")
    objects = geometry_document.get("objects")
    if not isinstance(objects, dict):
        raise RerenderError("geometry document objects must be an ID-to-GeoJSON mapping")

    def object_geometry(object_id, expected_type, *, solid=False):
        raw = objects.get(object_id)
        if not isinstance(raw, dict) or raw.get("type") != expected_type:
            raise RerenderError(f"{object_id}: missing or wrong GeoJSON geometry type")
        if not _finite_coordinates(raw.get("coordinates")):
            raise RerenderError(f"{object_id}: non-finite or malformed coordinates")
        try:
            geometry = shape(raw)
        except Exception as exc:
            raise RerenderError(f"{object_id}: malformed geometry") from exc
        if geometry.is_empty or not geometry.is_valid:
            raise RerenderError(f"{object_id}: empty, self-intersecting or invalid geometry")
        if expected_type == "Polygon" and (geometry.area <= 0 or (solid and len(geometry.interiors))):
            raise RerenderError(f"{object_id}: final piece must be positive and hole-free")
        if expected_type == "LineString" and geometry.length <= 0:
            raise RerenderError(f"{object_id}: seam must have positive length")
        return geometry

    def dereference(reference, expected_id, geometry_type, *, solid=False):
        if reference != {"artifactId": artifact_id, "objectId": expected_id, "frameId": frame_id}:
            raise RerenderError(f"{expected_id}: wrong geometry artifact/object/frame reference")
        return object_geometry(expected_id, geometry_type, solid=solid)

    slots = {s["id"]: s for s in source["colorSlots"]}
    if len(slots) != len(source["colorSlots"]):
        raise RerenderError("duplicate ColorSlot identity")
    source_regions = {r["id"]: r for r in source["observedRegions"]}
    if len(source_regions) != len(source["observedRegions"]):
        raise RerenderError("duplicate input Region identity")
    observed_regions = {s["regionId"] for s in observed}
    if observed_regions != set(source_regions):
        raise RerenderError("input Region identities differ from actual observed domains")
    for region in observed_regions:
        members = [s for s in observed if s["regionId"] == region]
        if set(source_regions[region]["componentIds"]) != {s.get("componentId", s.get("id")) for s in members}:
            raise RerenderError("input Component identities differ from observed geometry")
        for member in members:
            slot = slots.get(member["colorSlotId"])
            if slot is None or tuple(slot["rgb"]) != tuple(member["rgb"]) or source_regions[region]["colorSlotId"] != slot["id"]:
                raise RerenderError("exact source ColorSlot/RGB identity mismatch")

    plan = {"pieces": [], "baseExposures": [], "splitGroups": []}
    for piece in payload["pieces"]:
        polygon = dereference(piece["geometry"], piece["id"], "Polygon", solid=True)
        if piece.get("solid") is not True or piece["colorSlotId"] not in slots:
            raise RerenderError("invalid piece solid declaration or ColorSlot reference")
        touched = [s for s in observed if s["polygon"].intersection(polygon).area > 0]
        if set(piece["sourceRegionIds"]) != {s["regionId"] for s in touched}:
            raise RerenderError("piece Region provenance differs from actual geometric intersections")
        plan["pieces"].append({**piece, "polygon": polygon,
            "sourceComponentIds": sorted(s.get("componentId", s.get("id")) for s in touched)})
    for index, exposure in enumerate(payload["baseExposures"]):
        polygon = dereference(exposure["geometry"], f"exposure:{index}", "Polygon")
        touched = [s for s in observed if s["polygon"].intersection(polygon).area > 0]
        if len(touched) != 1 or touched[0]["regionId"] != exposure["sourceRegionId"]:
            raise RerenderError("exposure does not map to one actual source Component")
        plan["baseExposures"].append({**exposure, "polygon": polygon,
            "sourceComponentId": touched[0].get("componentId", touched[0].get("id"))})
    for group in payload["splitGroups"]:
        seams = [{**s, "polyline": dereference(s["geometry"], s["id"], "LineString")} for s in group["seams"]]
        plan["splitGroups"].append({**group, "seams": seams,
            "sourcePolygon": object_geometry("source:"+group["id"], "Polygon")})
    try:
        checks = validate_plan(observed, plan)
        validate_relations(payload["relations"], observed_regions, {p["id"] for p in plan["pieces"]})
    except ValueError as exc:
        raise RerenderError("independent geometric/relation verification failed: "+str(exc)) from exc
    by_id = {p["id"]: p for p in plan["pieces"]}
    edges = {pid: set() for pid in by_id}
    for relation in payload["relations"]:
        if any(e not in artifact_ids for e in relation["evidenceArtifactIds"]):
            raise RerenderError("relation evidence artifact reference is missing")
        if relation["fabricationImpact"] == "BLOCKING" and relation["status"] in ("UNRESOLVED", "NOT_EVALUATED"):
            raise RerenderError("blocking relation prevents a verified assembly render")
        if relation["kind"] == "ASSEMBLY_PRECEDENCE" and relation["status"] == "RESOLVED":
            a, b = relation["a"], relation["b"]
            if relation["direction"] == "B_TO_A":
                a, b = b, a
            edges[a].add(b)

    def reaches(a, b):
        queue, seen = [a], set()
        while queue:
            current = queue.pop()
            if current == b:
                return True
            if current not in seen:
                seen.add(current)
                queue.extend(edges[current])
        return False

    support_count = 0
    for base in (p for p in plan["pieces"] if p["role"] == "BASE"):
        for cover in (p for p in plan["pieces"] if p["role"] == "VISIBLE"):
            if base["polygon"].intersection(cover["polygon"]).area > 1e-8:
                support_count += 1
                if not reaches(base["id"], cover["id"]):
                    raise RerenderError("actual Base support lacks Base-before-visible assembly evidence")
    order = []
    remaining = set(by_id)
    while remaining:
        roots = sorted(pid for pid in remaining if not any(pid in edges[p] for p in remaining))
        if not roots:
            raise RerenderError("assembly graph has a cycle")
        order.extend(roots)
        remaining.difference_update(roots)
    actual_objects = [{"polygon": by_id[pid]["polygon"], "rgb": slots[by_id[pid]["colorSlotId"]]["rgb"]} for pid in order]
    expected_objects = sorted(observed, key=lambda s: (s["regionId"], s.get("componentId", s.get("id"))))
    image = _render_closed(actual_objects, shape_hw)
    observed_rgba = _render_closed(expected_objects, shape_hw)
    raw_mismatch = np.any(image != observed_rgba, axis=2)
    allowed_boundary_tie = np.zeros(shape_hw, dtype=bool)
    boundary_samples = np.zeros(shape_hw, dtype=bool)
    for obj in expected_objects:
        window, xx, yy = _pixel_window(obj["polygon"], shape_hw)
        boundary = intersects_xy(obj["polygon"].boundary, xx, yy)
        boundary_samples[window] |= boundary
        same = np.all(image[window] == [*obj["rgb"], 255], axis=2)
        allowed_boundary_tie[window] |= boundary & same
    mismatch = raw_mismatch & ~allowed_boundary_tie
    return {"image": image, "rgba": image, "observed_rgba": observed_rgba,
        "resultSha256": result_wire["identity"]["sha256"],
        "mismatchPixelCount": int(mismatch.sum()), "rawMismatchPixelCount": int(raw_mismatch.sum()),
        "boundaryTiePixelCount": int((raw_mismatch & allowed_boundary_tie).sum()),
        "originalBoundarySamplePixelCount": int(boundary_samples.sum()),
        "mismatchMask": mismatch, "geometryChecks": checks, "topologicalOrder": order,
        "relationsStatus": "PASS",
        "actualBaseSupportPairCount": support_count,
        "samplingConvention": "PIXEL_CENTER_CLOSED_DOMAIN; exact original-boundary adjacent colors are equivalent; no coordinate shift",
        "renderBackStatus": "PASS" if not mismatch.any() else "FAIL"}
