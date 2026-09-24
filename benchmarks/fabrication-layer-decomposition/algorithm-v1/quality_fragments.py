"""Bounded, opt-in production-selection experiments, not frozen CP-B repair.

The source RGBA is immutable.  Labels describe a new design, never a corrected
ground truth.  Only local 4-neighbour ownership can change; disconnected same
colours are not joined.  RC-A must be rerun by the caller on the returned maps.
"""
from __future__ import annotations

import hashlib

import cv2
import numpy as np
from scipy import ndimage


VERSION = "application-selection-v1.0"
PARAMETERS = {
    "maximumFragmentAreaPx": 16,
    "minimumTargetComponentAreaPx": 64,
    "minimumTargetToFragmentAreaRatio": 8,
    "minimumTargetContactFraction": 0.5,
    "weakBoundaryLabDeltaE": 10.0,
    "maximumWeakBoundaryLabDeltaE": 18.0,
    "darkDetailLuminanceProtection": 45.0,
    "localRadiusPx": 3,
    "minimumBodySupportFraction": 0.35,
    "maximumExteriorTransitionThicknessPx": 1.5,
    "maximumTransitionRgbResidual": 22.0,
    "transitionMixMinimum": 0.1,
    "transitionMixMaximum": 0.9,
    "maximumTransitionChromaRgb": 36.0,
    "maximumAspectRatio": 4.0,
    "passes": 1,
}
CLEANUP_PARAMETERS = {
    "maximumIslandAreaPx": 9,
    "maximumIslandExtentPx": 5,
    "maximumIslandAspectRatio": 2.0,
    "minimumMajorAreaPx": 256,
    "minimumMajorRelativeArea": 0.01,
    "maximumMajorDistancePx": 6.0,
    "minimumIslandLuminance": 180.0,
    "maximumIslandChromaRgb": 35.0,
    "maximumExteriorRgbDistance": 80.0,
}
_CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], np.uint8)


def _digest(array):
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def _rgba(array):
    if not isinstance(array, np.ndarray) or array.dtype != np.uint8 or array.ndim != 3 or array.shape[2] != 4:
        raise ValueError("quality selection requires uint8 HxWx4 RGBA")
    if not array.shape[0] or not array.shape[1]:
        raise ValueError("empty RGBA dimensions")


def _components(mask):
    return cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=4)


def _exterior(mask):
    """Background connected to canvas edges; enclosed real holes stay excluded."""
    void = ~mask
    seed = np.zeros(mask.shape, bool)
    seed[[0, -1], :] = void[[0, -1], :]
    seed[:, [0, -1]] |= void[:, [0, -1]]
    return ndimage.binary_propagation(seed, structure=_CROSS, mask=void)


def _summary(labels):
    ids = [int(x) for x in np.unique(labels) if x > 0]
    return {"regions": len(ids), "components": sum(_components(labels == x)[0] - 1 for x in ids)}


def propose_foreground_cleanup(rgba, *, enabled=False):
    """Return a separate, unconfirmed gray exterior-residue hypothesis.

    Small area alone is insufficient: compact bright neutral appearance close
    to measured exterior RGB and close to a much larger body are also required.
    This cannot recognize artistic intent, so enabled output is explicitly an
    experimental candidate.  Original alpha is never edited in-place.
    """
    _rgba(rgba)
    p = CLEANUP_PARAMETERS
    derived = rgba.copy()
    foreground = rgba[..., 3] > 0
    count, components, stats, _ = _components(foreground)
    largest = int(stats[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0
    major_ids = [i for i in range(1, count)
                 if stats[i, cv2.CC_STAT_AREA] >= max(p["minimumMajorAreaPx"], largest * p["minimumMajorRelativeArea"])]
    major = np.isin(components, major_ids)
    distance = ndimage.distance_transform_edt(~major) if major_ids else np.full(foreground.shape, np.inf)
    exterior = _exterior(foreground)
    records = []
    for cid in range(1, count):
        x, y, w, h, area = [int(v) for v in stats[cid]]
        mask = components == cid
        rgb = np.median(rgba[mask, :3], axis=0)
        ring = cv2.dilate(mask.astype(np.uint8), _CROSS).astype(bool) & exterior
        outside = np.median(rgba[ring, :3], axis=0) if ring.any() else rgb
        delta = float(np.linalg.norm(rgb - outside))
        nearest = float(distance[mask].min()) if major_ids else None
        reasons = []
        if cid in major_ids: reasons.append("MAJOR_FOREGROUND_BODY")
        if area > p["maximumIslandAreaPx"]: reasons.append("AREA_OUTSIDE_BOUNDED_PROPOSAL")
        if max(w, h) > p["maximumIslandExtentPx"] or max(w, h) / min(w, h) > p["maximumIslandAspectRatio"]:
            reasons.append("EXTENDED_OR_STROKE_LIKE_DETAIL")
        if float(rgb.mean()) < p["minimumIslandLuminance"] or float(rgb.max() - rgb.min()) > p["maximumIslandChromaRgb"]:
            reasons.append("DARK_OR_COLORED_DECORATION_PROTECTED")
        if not ring.any() or delta > p["maximumExteriorRgbDistance"]: reasons.append("NOT_EXTERIOR_COLOR_RESIDUE")
        if nearest is None or nearest > p["maximumMajorDistancePx"]: reasons.append("DISTANT_OR_NO_MAJOR_BODY")
        # A ring-shaped island must not disappear, regardless of its small area.
        if np.any(ndimage.binary_fill_holes(mask, structure=_CROSS) & ~mask): reasons.append("ISLAND_HOLE_PROTECTED")
        proposed = not reasons
        remove = proposed and enabled
        coords = np.argwhere(mask)
        if remove: derived[mask, 3] = 0
        records.append({"inputIslandId": cid, "bbox": [x, y, w, h], "areaPx": area,
                        "medianRgb": rgb.tolist(), "nearestMajorDistancePx": nearest,
                        "exteriorMedianRgb": outside.tolist(), "exteriorRgbDistance": delta,
                        "proposal": "REMOVE_UNCONFIRMED" if proposed else "KEEP",
                        "action": "REMOVED_IN_DERIVED_CANDIDATE" if remove else "PRESERVED",
                        "reasons": reasons or ["COMPACT_BRIGHT_NEUTRAL_EXTERIOR_RESIDUE_NEAR_MAJOR_BODY"],
                        "uncertainty": "Artistic intent unknown; not user-confirmed noise.",
                        "changedPixelsXY": coords[:, ::-1].tolist() if remove else []})
    changed = np.argwhere(rgba[..., 3] != derived[..., 3])
    return derived, {"strategyVersion": VERSION + "/foreground-proposal", "enabled": bool(enabled),
                     "effectiveParameters": dict(p), "inputRgbaSha256": _digest(rgba),
                     "inputShape": list(rgba.shape),
                     "derivedRgbaSha256": _digest(derived), "sourceModified": False,
                     "manualConfirmation": "NOT_CONFIRMED", "records": records,
                     "removedIslandCount": sum(x["action"] == "REMOVED_IN_DERIVED_CANDIDATE" for x in records),
                     "changedAlphaPixelCount": int(len(changed)), "changedPixelsXY": changed[:, ::-1].tolist()}


def refine_selection(rgba, structural_labels, pixel_labels, color_config, *, enabled=True):
    """Create local selection B, then regenerate exact frozen fringe assignment.

    Interior adjustments require a multi-region junction and a weak raw colour
    boundary.  Exterior adjustments additionally use measured transition-colour
    evidence, not a relaxed high-contrast merge threshold.  True alpha holes,
    dark strokes, unsupported tips, and isolated input bodies are protected.
    """
    from color_purification import assign_fringe_pixels

    _rgba(rgba)
    for labels in (structural_labels, pixel_labels):
        if labels.dtype != np.int32 or labels.shape != rgba.shape[:2]:
            raise ValueError("quality selection labels must be int32 HxW")
    active = rgba[..., 3] >= color_config["structuralAlphaThreshold"]
    if np.any(structural_labels < 0) or not np.array_equal(structural_labels > 0, active):
        raise ValueError("quality selection input structural coverage mismatch")
    expected, _ = assign_fringe_pixels(rgba, structural_labels, color_config)
    if not np.array_equal(expected, pixel_labels):
        raise ValueError("quality selection input fringe assignment mismatch")
    new = structural_labels.copy()
    p = PARAMETERS
    exterior = _exterior(active)
    holes = ~active & ~exterior
    thickness = ndimage.distance_transform_edt(np.pad(active, 1))[1:-1, 1:-1]
    lab = cv2.cvtColor(rgba[..., :3].astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    _, input_ids, input_stats, _ = _components(rgba[..., 3] > 0)
    # Do not retain an image-sized component map for every tiny colour region.
    # Large targets are immutable originals and have bounded call-local reuse.
    unique_ids, areas = np.unique(structural_labels, return_counts=True)
    region_areas = {int(rid): int(area) for rid, area in zip(unique_ids, areas) if rid > 0}
    target_components = {}
    records = []
    for rid in region_areas:
        count, ids, stats, _ = _components(structural_labels == rid)
        for cid in range(1, count):
            x, y, w, h, area = [int(v) for v in stats[cid]]
            mask = ids == cid
            yy, xx = np.where(mask)
            source_island = int(input_ids[yy[0], xx[0]])
            record = {"oldRegionId": rid, "oldComponentIndex": cid, "newRegionId": rid,
                      "bbox": [x, y, w, h], "areaPx": area, "inputIslandId": source_island,
                      "inputIslandAreaPx": int(input_stats[source_island, cv2.CC_STAT_AREA]),
                      "classification": "INPUT_ISLAND" if int(input_stats[source_island, cv2.CC_STAT_AREA]) == area else "LABEL_PARTITION_WITHIN_INPUT_BODY",
                      "action": "PRESERVED", "reasons": [], "changedPixelsXY": []}
            records.append(record)
            if not enabled:
                record["reasons"] = ["STRATEGY_DISABLED"]; continue
            if area > p["maximumFragmentAreaPx"]:
                record["reasons"] = ["AREA_OUTSIDE_BOUNDED_LOCAL_REFINEMENT"]; continue
            if record["classification"] == "INPUT_ISLAND":
                record["reasons"] = ["INPUT_ISLAND_REQUIRES_SEPARATE_CLEANUP_PROPOSAL"]; continue
            ring = cv2.dilate(mask.astype(np.uint8), _CROSS).astype(bool) & ~mask
            if np.any(ring & holes):
                record["reasons"] = ["TRUE_ALPHA_HOLE_BOUNDARY_PROTECTED"]; continue
            rgb = np.median(rgba[mask, :3], axis=0)
            record["oldRawMedianRgb"] = rgb.tolist()
            if float(rgb.mean()) < p["darkDetailLuminanceProtection"]:
                record["reasons"] = ["DARK_DETAIL_PROTECTED"]; continue
            if max(w, h) / min(w, h) > p["maximumAspectRatio"]:
                record["reasons"] = ["ELONGATED_DETAIL_PROTECTED"]; continue
            # Count physical 4-neighbour contacts, not diagonal proximity.
            contacts = {}
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = yy + dy, xx + dx
                valid = (ny >= 0) & (ny < active.shape[0]) & (nx >= 0) & (nx < active.shape[1])
                ny, nx = ny[valid], nx[valid]
                for target in np.unique(structural_labels[ny, nx]):
                    if target > 0 and target != rid:
                        hits = structural_labels[ny, nx] == target
                        contacts.setdefault(int(target), []).extend(zip(ny[hits].tolist(), nx[hits].tolist()))
            if not contacts:
                record["reasons"] = ["NO_ACTUAL_POSITIVE_NEIGHBOUR"]; continue
            target = min(contacts, key=lambda key: (-len(contacts[key]), key))
            touch = np.array(contacts[target], dtype=int)
            if region_areas[target] < p["minimumTargetComponentAreaPx"]:
                record["reasons"] = ["NO_DOMINANT_LARGER_ADJACENT_COMPONENT"]; continue
            if target not in target_components:
                target_components[target] = _components(structural_labels == target)
            target_cc = target_components[target][1]
            target_ids = np.unique(target_cc[touch[:, 0], touch[:, 1]])
            if len(target_ids) != 1:
                record["reasons"] = ["WOULD_JOIN_DISCONNECTED_TARGET_COMPONENTS"]; continue
            target_area = int(target_components[target][2][target_ids[0], cv2.CC_STAT_AREA])
            fraction = len(touch) / sum(len(v) for v in contacts.values())
            record.update({"targetRegionId": target, "targetComponentIndex": int(target_ids[0]),
                           "targetComponentAreaPx": target_area, "targetContactFraction": fraction})
            if target_area < max(p["minimumTargetComponentAreaPx"], area * p["minimumTargetToFragmentAreaRatio"]) or fraction < p["minimumTargetContactFraction"]:
                record["reasons"] = ["NO_DOMINANT_LARGER_ADJACENT_COMPONENT"]; continue
            boundary_delta = np.linalg.norm(lab[touch[:, 0], touch[:, 1]] - np.median(lab[mask], axis=0), axis=1)
            record["boundaryLabDeltaMedian"] = float(np.median(boundary_delta))
            record["boundaryLabDeltaMaximum"] = float(boundary_delta.max())
            radius = p["localRadiusPx"]
            y0, y1 = max(0, y-radius), min(active.shape[0], y+h+radius)
            x0, x1 = max(0, x-radius), min(active.shape[1], x+w+radius)
            local_active = active[y0:y1, x0:x1]
            support = float(local_active.mean())
            record["localBodySupportFraction"] = support
            exterior_contact = bool(np.any(ring & exterior))
            weak_junction = (not exterior_contact and len(contacts) >= 2
                             and np.median(boundary_delta) <= p["weakBoundaryLabDeltaE"]
                             and boundary_delta.max() <= p["maximumWeakBoundaryLabDeltaE"])
            transition = False
            if exterior_contact and support >= p["minimumBodySupportFraction"] and float(thickness[mask].max()) <= p["maximumExteriorTransitionThicknessPx"]:
                local_rgb = rgba[y0:y1, x0:x1, :3]
                interior = (structural_labels[y0:y1, x0:x1] == target) & (thickness[y0:y1, x0:x1] >= 2)
                outside = exterior[y0:y1, x0:x1]
                if interior.any() and outside.any():
                    a = np.median(local_rgb[interior], axis=0)
                    b = np.median(local_rgb[outside], axis=0)
                    direction = b-a
                    denom = float(direction @ direction)
                    mix = float((rgb-a) @ direction / denom) if denom else -1.0
                    residual = float(np.linalg.norm(rgb-(a+mix*direction)))
                    record["exteriorTransitionEvidence"] = {"interiorRgb": a.tolist(), "exteriorRgb": b.tolist(), "mix": mix, "residualRgb": residual}
                    transition = (p["transitionMixMinimum"] <= mix <= p["transitionMixMaximum"]
                                  and residual <= p["maximumTransitionRgbResidual"]
                                  and float(rgb.max()-rgb.min()) <= p["maximumTransitionChromaRgb"])
            if not (weak_junction or transition):
                record["reasons"] = ["DETAIL_OR_STRONG_BOUNDARY_WITHOUT_TRANSITION_EVIDENCE"]; continue
            new[mask] = target
            record.update({"newRegionId": target, "action": "REASSIGNED",
                           "reasons": ["WEAK_RAW_BOUNDARY_AT_MULTI_REGION_JUNCTION" if weak_junction else "NEUTRAL_EXTERIOR_TRANSITION_WITH_THICK_BODY_SUPPORT"],
                           "uncertainty": "Experimental ownership; visual acceptance pending.",
                           "changedPixelsXY": np.column_stack((xx, yy)).tolist()})
    pixels, fringe = assign_fringe_pixels(rgba, new, color_config)
    if not np.array_equal(new > 0, active):
        raise AssertionError("selection changed structural coverage")
    changed = np.argwhere(new != structural_labels)
    return new, pixels, {"strategyVersion": VERSION, "enabled": bool(enabled), "effectiveParameters": dict(p),
                         "inputShape": list(rgba.shape), "effectiveCoverageParameters": {
                             "structuralAlphaThreshold": int(color_config["structuralAlphaThreshold"]),
                             "fringeMaxPropagationDistancePx": int(color_config["fringeMaxPropagationDistancePx"])},
                         "inputRgbaSha256": _digest(rgba), "inputStructuralSha256": _digest(structural_labels),
                         "outputStructuralSha256": _digest(new), "outputPixelSha256": _digest(pixels),
                         "sourceAlphaModified": False, "before": _summary(structural_labels), "after": _summary(new),
                         "changedComponentCount": sum(x["action"] == "REASSIGNED" for x in records),
                         "changedStructuralPixelCount": int(len(changed)), "changedPixelsXY": changed[:, ::-1].tolist(),
                         "componentMappings": records, "fringeAssignment": fringe,
                         "representativeColorPolicy": "RECOMPUTE_FROZEN_RC_A_ON_NEW_SELECTION_REQUIRED",
                         "manualQualityStatus": "PENDING_MANUAL_REVIEW"}
