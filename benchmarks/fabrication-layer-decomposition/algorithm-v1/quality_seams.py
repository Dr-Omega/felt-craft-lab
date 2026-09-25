"""Optional finite-candidate seam study, not human/material acceptance.

All public operations validate current declarations. No plan-ID PASS cache or
image input is used. Renderers are pure: protected orchestration owns writes.
"""
from __future__ import annotations

import copy
import math

from PIL import Image, ImageChops, ImageDraw
from shapely.ops import unary_union

from solid_plans import _lines, _parts, _sources, rank_plans, validate_plan


STRATEGY = "experimental-central-visible-seam/1"
PARAMETERS = {
    "centralEllipseFractionOfBounds": 0.30,
    "centralWeight": 3.0,
    "darkColorWeight": 0.5,
    "integration": "MIDPOINT_PER_ACTUAL_POLYLINE_SEGMENT",
    "maximumCandidates": "EXISTING_FINITE_PROPOSALS_ONLY",
}


def _checked(observed, plans):
    if not plans:
        raise ValueError("no actual candidates to compare")
    sources, foreground = _sources(observed)
    copies = copy.deepcopy(list(plans))
    if len({p["id"] for p in copies}) != len(copies):
        raise ValueError("duplicate plan identity")
    # rank_plans calls the full hard validator through _score on every plan.
    return sources, foreground, rank_plans(sources, copies)


def _seam_geometry(plan, original_boundaries):
    pieces = {p["id"]: p for p in plan["pieces"]}
    for group in plan["splitGroups"]:
        for seam in group["seams"]:
            line = seam["polyline"]
            piece = pieces[seam["pieceIds"][0]]
            if piece["role"] == "VISIBLE":
                visible = line
            else:
                exposures = unary_union([e["polygon"] for e in plan["baseExposures"]
                                         if e["basePieceId"] in seam["pieceIds"]])
                visible = line.intersection(exposures)
            yield group, seam, piece, visible, line.difference(visible), visible.difference(original_boundaries)


def _proxy(line, bounds, rgb):
    x0, y0, x1, y1 = bounds
    cx, cy = (x0+x1)/2, (y0+y1)/2
    rx, ry = max((x1-x0)*0.30, 1e-12), max((y1-y0)*0.30, 1e-12)
    darkness = 1.0 - sum(rgb)/(3*255)
    cost = 0.0
    for part in _lines(line):
        for a, b in zip(part.coords, list(part.coords)[1:]):
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            central = math.exp(-((mx-cx)/rx)**2-((my-cy)/ry)**2)
            length = math.hypot(b[0]-a[0], b[1]-a[1])
            cost += length*(1.0+3.0*central)*(1.0+0.5*darkness)
    return cost


def _record(plan, sources, foreground):
    boundaries = unary_union([s["polygon"].boundary for s in sources])
    palette = {s["colorSlotId"]: s["rgb"] for s in sources}
    records, cost = [], 0.0
    for group, seam, piece, visible, covered, interior in _seam_geometry(plan, boundaries):
        value = _proxy(interior, foreground.bounds, palette[piece["colorSlotId"]])
        cost += value
        records.append({"splitGroupId": group["id"], "seamId": seam["id"],
                        "pieceIds": list(seam["pieceIds"]), "role": piece["role"],
                        "colorSlotId": piece["colorSlotId"],
                        "polyline": [list(p) for p in seam["polyline"].coords],
                        "physicalLengthCanonical": float(seam["polyline"].length),
                        "visibleLengthCanonical": float(visible.length),
                        "coveredLengthCanonical": float(covered.length),
                        "originalBoundaryCoincidenceLengthCanonical": float(visible.intersection(boundaries).length),
                        "newVisibleInteriorLengthCanonical": float(interior.length),
                        "centralColorProxyCost": value})
    return {"planId": plan["id"], "baseChoices": copy.deepcopy(plan["baseChoices"]),
            "hardChecks": copy.deepcopy(plan["geometryChecks"]),
            "recomputedLegacyScore": copy.deepcopy(plan["score"]),
            "physicalSeams": records, "physicalSeamRecordCount": len(records),
            "physicalLengthSumCanonical": sum(r["physicalLengthCanonical"] for r in records),
            "centralColorProxyCost": cost,
            "qualityRankingKey": [cost, plan["score"]["interiorSeamLengthCanonical"],
                                  plan["score"]["visibleSeamLengthCanonical"],
                                  plan["score"]["pieceCount"], plan["score"]["vertexCount"],
                                  plan["score"]["totalSeamLengthCanonical"]]}


def rank_quality_plans(observed, plans, *, enabled=True):
    """Recheck every candidate; optionally order by a declared location proxy.

    This does not change geometry, exact color, physical seam records, candidate
    membership, or legacy ranking keys. The separate report binds the new order.
    A central bbox prior is a developer experiment, NOT motif detection. Dark
    colors receive a bounded multiplier, NOT a learned material-contrast model.
    """
    sources, foreground, legacy = _checked(observed, plans)
    records = [_record(plan, sources, foreground) for plan in legacy]
    by_id = {r["planId"]: r for r in records}
    ordered = (sorted(legacy, key=lambda p: (by_id[p["id"]]["qualityRankingKey"], p["id"]))
               if enabled else legacy)
    report = {"strategy": STRATEGY, "enabled": bool(enabled), "parameters": dict(PARAMETERS),
              "annotationProvenance": "DEVELOPER_DECLARED_NORMALIZED_BBOX_CENTER_AND_EXACT_RGB_PRIOR",
              "humanTruth": False, "motifDetection": False,
              "candidateCount": len(legacy), "candidateSetChanged": False,
              "legacyOrder": [p["id"] for p in legacy], "experimentalOrder": [p["id"] for p in ordered],
              "candidates": records, "visualAcceptance": "PENDING",
              "limitations": ["Central location is only a spatial prior; eccentric motifs may rank worse.",
                              "Costs sum physical records, even when their projected lines coincide.",
                              "Covered BASE seams retain records but contribute no visible-location cost.",
                              "An inherited pattern boundary is not itself a new physical split seam.",
                              "All candidates preserve the same design appearance; this does not certify input-to-design quality."]}
    return ordered, report


def _render(plan, sources, shape, scale, seams, numbered):
    height, width = shape[:2]
    if type(scale) is not int or not 1 <= scale <= 8 or height <= 0 or width <= 0:
        raise ValueError("positive image shape and integer scale in [1,8] required")
    palette = {s["colorSlotId"]: tuple(s["rgb"])+(255,) for s in sources}
    image = Image.new("RGBA", (width*scale, height*scale), (0, 0, 0, 0))
    ordered = sorted(plan["pieces"], key=lambda p: (p["role"] != "BASE", p["id"]))
    # Project actual assembled geometry first. Rasterizing BASE/VISIBLE in
    # different layer orders otherwise assigns inclusive boundary samples to
    # different colors for equivalent Base alternatives. Union is DISPLAY ONLY:
    # separate physical Pieces and their complete seams remain unchanged.
    pieces = {p["id"]: p for p in ordered}
    projected = {slot: [] for slot in palette}
    for piece in ordered:
        if piece["role"] == "VISIBLE":
            projected[piece["colorSlotId"]].append(piece["polygon"])
    for exposure in plan["baseExposures"]:
        base = pieces[exposure["basePieceId"]]
        projected[base["colorSlotId"]].append(base["polygon"].intersection(exposure["polygon"]))
    for slot in sorted(projected):
        mask = Image.new("L", image.size, 0)
        for polygon in _parts(unary_union(projected[slot])):
            # A hole belongs only to this Polygon. Clearing it in a shared
            # mask could erase an already drawn, same-colour nested island.
            # Union independent part masks; true unoccupied holes remain zero.
            part_mask = Image.new("L", image.size, 0)
            draw = ImageDraw.Draw(part_mask)
            draw.polygon([(x*scale, y*scale) for x, y in polygon.exterior.coords], fill=255)
            for ring in polygon.interiors:
                draw.polygon([(x*scale, y*scale) for x, y in ring.coords], fill=0)
            mask = ImageChops.lighter(mask, part_mask)
        image.paste(palette[slot], mask=mask)
    draw = ImageDraw.Draw(image)
    if seams:
        boundaries = unary_union([s["polygon"].boundary for s in sources])
        for _, _, _, visible, covered, _ in _seam_geometry(plan, boundaries):
            for geometry, color in ((covered, (0, 160, 210, 255)), (visible, (230, 0, 110, 255))):
                for line in _lines(geometry):
                    draw.line([(x*scale, y*scale) for x, y in line.coords], fill=color, width=scale)
    if numbered:
        for i, piece in enumerate(ordered, 1):
            point = piece["polygon"].representative_point()
            draw.text((point.x*scale, point.y*scale), str(i), fill=(0, 0, 0, 255),
                      stroke_width=1, stroke_fill=(255, 255, 255, 255))
    return image.resize((width, height), Image.Resampling.LANCZOS) if scale != 1 else image


def render_plan_preview(plan, observed, shape, scale=3, seams=False, numbered=False):
    """Pure RGBA rendering from actual Piece geometry / exact ColorSlots.

    Transparent canvas, same deterministic supersampling for all candidates;
    supersampling improves display only and does not modify Piece geometry.
    Cyan indicates covered physical seams, magenta exposed physical seams.
    This schematic seam overlay is not a simulation of fabric appearance.
    """
    sources, _ = _sources(observed)
    validate_plan(sources, plan)
    return _render(plan, sources, shape, scale, seams, numbered)


def compare_quality_plans(observed, plans, shape, *, scale=3):
    """Return anonymous actual X/Y + alternate-Base comparisons without I/O.

    A/B reflect axis order, never a 'best' label; C uses a different exact Base
    strategy if available. Missing alternatives are explicit, not fabricated.
    All candidate data remain in the report even when only three are pictured.
    """
    sources, foreground, legacy = _checked(observed, plans)
    selected = []
    signature = lambda p: tuple((b["bodyId"], b["colorSlotId"]) for b in p["baseChoices"])
    for p in legacy:
        if all(b["splitAxis"] == "x" for b in p["baseChoices"]):
            y = next((q for q in legacy if signature(q) == signature(p) and
                      all(b["splitAxis"] == "y" for b in q["baseChoices"])), None)
            if y is not None:
                selected = [p, y]
                break
    if not selected:
        selected = [legacy[0]]
    alternate = next((p for p in legacy if signature(p) != signature(selected[0])), None)
    if alternate is not None:
        selected.append(alternate)
    images, comparisons = {}, []
    height, width = shape[:2]
    x0, y0, x1, y1 = foreground.bounds
    cx, cy = (x0+x1)/2, (y0+y1)/2
    rx, ry = (x1-x0)*0.20, (y1-y0)*0.20
    crop = (max(0, math.floor(cx-rx)), max(0, math.floor(cy-ry)),
            min(width, math.ceil(cx+rx)), min(height, math.ceil(cy+ry)))
    for label, plan in zip("ABC", selected):
        record = _record(plan, sources, foreground)
        record["anonymousLabel"] = label
        record["pieceNumberMap"] = {str(i): p["id"] for i, p in enumerate(
            sorted(plan["pieces"], key=lambda p: (p["role"] != "BASE", p["id"])), 1)}
        comparisons.append(record)
        for suffix, seam_flag, numbers in (("appearance", False, False), ("seams", True, False), ("references", True, True)):
            images[f"{label}-{suffix}"] = _render(plan, sources, shape, scale, seam_flag, numbers)
        if crop[2] > crop[0] and crop[3] > crop[1]:
            for suffix in ("appearance", "seams"):
                detail = images[f"{label}-{suffix}"].crop(crop)
                images[f"{label}-{suffix}-detail"] = detail.resize(
                    (detail.width*3, detail.height*3), Image.Resampling.NEAREST)
    report = {"strategy": STRATEGY, "comparisonCount": len(comparisons),
              "comparisons": comparisons, "allCandidateIds": [p["id"] for p in legacy],
              "sampling": {"scale": scale, "filter": "LANCZOS" if scale != 1 else "NONE", "background": "TRANSPARENT_RGBA"},
              "detailWindow": {"xyxy": list(crop), "magnification": 3, "filter": "NEAREST",
                               "provenance": "Fixed central 40 percent of actual foreground bounds; not detected motif"},
              "labelMeaning": "Anonymous axis/Base alternatives, not quality verdicts",
              "missingAlternatives": [] if len(selected) == 3 else ["Fewer than three distinct X/Y and alternate-Base plans exist"],
              "overlayLegend": {"magenta": "exposed physical seam", "cyan": "covered physical seam (reference only)"},
              "visualAcceptance": "PENDING"}
    return report, images
