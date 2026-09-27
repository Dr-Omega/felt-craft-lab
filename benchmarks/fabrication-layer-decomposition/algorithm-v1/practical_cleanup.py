"""Unconfirmed exterior-residue proposals from visible boundary evidence only.

Never infer a matte colour from transparent RGB. An opaque island is removable
only when multiple spatial and colour-support observations agree. Unsupported
or ambiguous observations are preserved, not silently labelled as dirt.
"""
from __future__ import annotations

import copy
import hashlib

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

VERSION = "practical-visible-exterior-residue/1"
CROSS = ndimage.generate_binary_structure(2, 1)
PARAMETERS = {
    "trustedInteriorDepthPx": 4.0,
    "maximumUnsupportedExtentPx": 2,
    "maximumUnsupportedDepthPx": 1.0,
    "maximumBodyDistancePx": 6.0,
    "localEvidenceRadiusPx": 10,
    "minimumInteriorColorDistanceRgb": 24.0,
    "maximumEdgeToInteriorDistanceRatio": 0.30,
    "minimumEdgeMatchToleranceRgb": 12.0,
    "minimumMatchingBoundarySamples": 2,
    "minimumRepeatedBodyBoundarySamples": 8,
    "matteHypothesis": "NONE",
    "humanConfirmation": "NOT_CONFIRMED",
}


def _visible_digest(rgba):
    copy_rgba = rgba.copy()
    copy_rgba[copy_rgba[..., 3] == 0, :3] = 0
    return hashlib.sha256(copy_rgba.tobytes(order="C")).hexdigest()


def cleanup_foreground(rgba, config=None, request=None, *, enabled):
    """Return a separate derived image and deterministic, replayable evidence.

    ``config``/``request`` retain the upstream adapter signature. This cleanup
    does not consume reference palettes or hidden design answers. Original RGB
    bytes are preserved, including when alpha is removed in the derived image.
    """
    if not isinstance(rgba, np.ndarray) or rgba.dtype != np.uint8 or rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError("cleanup requires uint8 H×W×4 RGBA")
    if not rgba.shape[0] or not rgba.shape[1] or type(enabled) is not bool:
        raise ValueError("cleanup requires a nonempty frame and boolean enabled")
    source = rgba.copy()
    derived = source.copy()
    active = source[..., 3] > 0
    labels, count = ndimage.label(active, CROSS)
    depth = ndimage.distance_transform_edt(np.pad(active, 1))[1:-1, 1:-1]
    core = active & (depth >= PARAMETERS["trustedInteriorDepthPx"])
    trusted_ids = np.unique(labels[core])
    body = np.isin(labels, trusted_ids) & active
    if body.any():
        distance = ndimage.distance_transform_edt(~body)
        core_colors = np.unique(source[core, :3], axis=0)
        color_tree = cKDTree(core_colors.astype(float))
        edge_colors = source[body & ~core, :3].astype(float)
        edge_tree = cKDTree(edge_colors) if len(edge_colors) else None
    else:
        distance = np.full(active.shape, np.inf)
        color_tree = None
        edge_tree = None
    # Islands inside enclosed transparent holes are protected. The exterior
    # flood is based on alpha topology, not an assumed canvas RGB colour.
    exterior = ~ndimage.binary_fill_holes(active, structure=CROSS)
    records = []
    for cid, bounds in enumerate(ndimage.find_objects(labels), 1):
        if bounds is None:
            continue
        ys, xs = bounds
        local_mask = labels[bounds] == cid
        yy, xx = np.where(local_mask)
        points = np.column_stack((xx + xs.start, yy + ys.start))
        area = len(points)
        width, height = xs.stop - xs.start, ys.stop - ys.start
        reasons = []
        trusted = bool(cid in trusted_ids)
        if trusted:
            reasons.append("TRUSTED_BODY_NEVER_ALTERED")
        if max(width, height) > PARAMETERS["maximumUnsupportedExtentPx"]:
            reasons.append("EXTENDED_OR_COHERENT_DETAIL_PROTECTED")
        maximum_depth = float(depth[bounds][local_mask].max())
        if maximum_depth > PARAMETERS["maximumUnsupportedDepthPx"]:
            reasons.append("TWO_DIMENSIONAL_CORE_PROTECTED")
        if width >= 2 and height >= 2 and np.any(local_mask[:-1, :-1] & local_mask[1:, :-1] & local_mask[:-1, 1:] & local_mask[1:, 1:]):
            reasons.append("SOLID_TWO_BY_TWO_DECORATION_PROTECTED")
        nearest = float(distance[bounds][local_mask].min())
        if not np.isfinite(nearest) or nearest > PARAMETERS["maximumBodyDistancePx"]:
            reasons.append("NO_NEARBY_TRUSTED_BODY")
        # A one-cell ring suffices: a component's neighbours cannot belong to
        # another four-connected foreground component.
        y0, y1 = max(0, ys.start - 1), min(active.shape[0], ys.stop + 1)
        x0, x1 = max(0, xs.start - 1), min(active.shape[1], xs.stop + 1)
        ring = ndimage.binary_dilation(labels[y0:y1, x0:x1] == cid, CROSS)
        if not np.any(ring & exterior[y0:y1, x0:x1]):
            reasons.append("ENCLOSED_HOLE_OR_INTERIOR_DECORATION_PROTECTED")

        median_rgb = np.median(source[bounds][local_mask, :3], axis=0)
        evidence = {"nearestTrustedBodyDistancePx": nearest if np.isfinite(nearest) else None}
        # Avoid expensive colour search for already protected bodies and lines.
        if not reasons:
            radius = PARAMETERS["localEvidenceRadiusPx"]
            y0, y1 = max(0, ys.start - radius), min(active.shape[0], ys.stop + radius)
            x0, x1 = max(0, xs.start - radius), min(active.shape[1], xs.stop + radius)
            window = np.s_[y0:y1, x0:x1]
            local_core = core[window]
            edge = body[window] & ~local_core
            local_rgb = source[window][..., :3].astype(float)
            global_distance = float(color_tree.query(median_rgb)[0]) if color_tree is not None else None
            evidence["nearestTrustedInteriorColorDistanceRgb"] = global_distance
            if global_distance is None or global_distance <= PARAMETERS["minimumInteriorColorDistanceRgb"]:
                reasons.append("SUPPORTED_INTERIOR_COLOR_OR_UNKNOWN_PROTECTED")
            if not local_core.any() or not edge.any():
                reasons.append("INSUFFICIENT_LOCAL_TRANSITION_EVIDENCE")
            else:
                core_distance = float(np.linalg.norm(local_rgb[local_core] - median_rgb, axis=1).min())
                edge_distances = np.linalg.norm(local_rgb[edge] - median_rgb, axis=1)
                tolerance = max(PARAMETERS["minimumEdgeMatchToleranceRgb"],
                                PARAMETERS["maximumEdgeToInteriorDistanceRatio"] * core_distance)
                matches = int(np.count_nonzero(edge_distances <= tolerance))
                repeated = len(edge_tree.query_ball_point(median_rgb,
                    PARAMETERS["minimumEdgeMatchToleranceRgb"])) if edge_tree is not None else 0
                # An individual local edge extremum may occur once. It is only
                # supported if the same visible transition colour recurs around
                # the trusted boundary, yet has no trusted interior support.
                boundary_supported = matches >= PARAMETERS["minimumMatchingBoundarySamples"] or (
                    matches >= 1 and repeated >= PARAMETERS["minimumRepeatedBodyBoundarySamples"])
                evidence.update(localInteriorColorDistanceRgb=core_distance,
                    localBoundaryColorDistanceRgb=float(edge_distances.min()),
                    boundaryMatchToleranceRgb=float(tolerance), matchingBoundarySamples=matches,
                    repeatedTrustedBoundarySamples=repeated,
                    supportMode="LOCAL_MULTISAMPLE" if matches >= PARAMETERS["minimumMatchingBoundarySamples"] else "LOCAL_PLUS_REPEATED_TRUSTED_BOUNDARY")
                if core_distance <= PARAMETERS["minimumInteriorColorDistanceRgb"] or not boundary_supported:
                    reasons.append("NO_BOUNDARY_SPECIFIC_TRANSITION_SUPPORT")
        removable = not reasons
        remove = removable and enabled
        if remove:
            derived[bounds][local_mask, 3] = 0
        records.append({"inputIslandId": cid, "bbox": [xs.start, ys.start, width, height],
            "areaPx": area, "maximumInteriorDepthPx": maximum_depth,
            "medianVisibleRgb": median_rgb.tolist(), "alphaRange": [int(source[bounds][local_mask, 3].min()), int(source[bounds][local_mask, 3].max())],
            "evidence": evidence, "reasons": reasons or ["COMPACT_EXTERIOR_FRAGMENT_OF_LOCALLY_OBSERVED_TRANSITION"],
            "proposal": "REMOVE_UNCONFIRMED" if removable else "PRESERVE_UNCERTAIN_OR_SUPPORTED",
            "action": "REMOVED_IN_DERIVED_CANDIDATE" if remove else "PRESERVED",
            "changedPixelsXY": points.tolist() if remove else []})
    changed = np.argwhere(source[..., 3] != derived[..., 3])
    return derived, {"strategyVersion": VERSION, "enabled": enabled,
        "effectiveParameters": copy.deepcopy(PARAMETERS), "records": records,
        "sourceModified": False, "manualConfirmation": "NOT_CONFIRMED",
        "referencePaletteUsed": False, "transparentRgbUsed": False,
        "removedIslandCount": sum(record["action"] == "REMOVED_IN_DERIVED_CANDIDATE" for record in records),
        "changedAlphaPixelCount": len(changed), "changedPixelsXY": changed[:, ::-1].tolist(),
        "trustedBodyPixelCount": int(body.sum()), "trustedBodyPixelsChanged": int(np.count_nonzero(body & (source[..., 3] != derived[..., 3]))),
        "originalVisibleRgbaSha256": _visible_digest(source), "derivedVisibleRgbaSha256": _visible_digest(derived)}
