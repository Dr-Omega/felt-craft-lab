"""Bounded experimental shared-chain refitting; frozen kernels remain unchanged.

Design budgets are pixel-space choices, not numerical verification tolerances.
Every trial uses the existing fitting, continuous-bound and planar-embedding
checks. Thin-region geometry is an additional conservative detail guard.
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

import numpy as np
import cv2
from skimage.morphology import skeletonize


STRATEGY_VERSION = "shared-contour-refit/1"
DESIGN_BUDGETS_PX = (0.5, 0.75, 1.0)
FIT_BUDGET_FRACTION = 0.75
LOCAL_BRANCH_RADIUS_PX = 2.0
LOCAL_BRANCH_CORRIDOR_MARGIN_PX = 1.0


def _sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode("utf-8")).hexdigest()


def _complexity(geometries):
    return sum(len(value) for value in geometries.values())


def _fit_protected_chain(kernel, edge, tolerance, config, protected_indices):
    """Fit ordinary runs, retaining raw narrow-branch boundary runs exactly.

    Reuse fit_chain with the original persistent corners inserted as endpoints;
    this changes segmentation only, not fitting mathematics or shared-edge IDs.
    """
    from polygon_simplify import persistent_corners
    points = [tuple(map(float, p)) for p in edge["geometry"]]
    corner = config["cornerDetection"]
    corners, diagnostics = persistent_corners(points, bool(edge["closed"]), corner["spans"],
                                               corner["persistentTurnDegrees"], corner["requiredScaleCount"])
    anchors = sorted({0, len(points)-1, *corners, *protected_indices})
    segments = []
    for first, last in zip(anchors, anchors[1:]):
        part = {**edge, "closed": False, "geometry": [list(p) for p in points[first:last+1]]}
        if last == first + 1 and (first in protected_indices or last in protected_indices):
            fitted = kernel.exact_line_segments(part)
        else:
            fitted, _ = kernel.fit_chain(part, tolerance, corner, config["bezier"])
        for segment in fitted:
            # Exact collinear LINE coalescing removes unit-grid bookkeeping,
            # without moving any protected boundary or changing cubic controls.
            if segments and segment["type"] == segments[-1]["type"] == "LINE" and segments[-1]["p1"] == segment["p0"]:
                a = np.asarray(segments[-1]["p1"]) - np.asarray(segments[-1]["p0"])
                b = np.asarray(segment["p1"]) - np.asarray(segment["p0"])
                if a[0]*b[1] == a[1]*b[0] and float(np.dot(a, b)) > 0:
                    segments[-1] = {**segments[-1], "p1": segment["p1"]}
                    continue
            segments.append(segment)
    diagnostics.update({"localBranchProtectedVertexCount": len(protected_indices),
                        "localBranchSegmentation": "EXACT_NARROW_RUNS_EXISTING_FIT_ORDINARY_RUNS",
                        "tolerancePx": tolerance,
                        "lineCount": sum(s["type"] == "LINE" for s in segments),
                        "cubicSegmentCount": sum(s["type"] == "CUBIC" for s in segments)})
    return segments, diagnostics


def refine_contours(graph: dict[str, Any], vector_result: dict[str, Any],
                    labels: np.ndarray, vector_config: dict[str, Any], *,
                    enabled: bool = True) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return an independently checked selected vector and locatable audit.

    No mutation, file I/O, plan-ID cache, per-piece smoothing or frozen writes.
    Edge IDs and oriented path references are inherited unchanged from graph;
    each edge has exactly one geometry shared by both sides.
    """
    import m4_runtime as kernel
    from geometry_validation import geometry_deviation

    if labels.dtype != np.int32 or labels.ndim != 2:
        raise ValueError("contour labels must be a two-dimensional int32 array")
    input_labels_sha = hashlib.sha256(labels.astype("<i4").tobytes()).hexdigest()
    if vector_result["inputSha256"] != input_labels_sha:
        raise ValueError("contour source-label identity mismatch")
    baseline = {item["edgeId"]: copy.deepcopy(item["segments"])
                for item in vector_result["geometry"]}
    if (len(baseline) != len(vector_result["geometry"])
            or len(baseline) != len(graph["edges"])
            or set(baseline) != {edge["edgeId"] for edge in graph["edges"]}):
        raise ValueError("contour input edge identity mismatch")
    flatness = float(vector_config["bezier"]["validationFlatnessPx"])
    initial_validation = kernel.validate_embedding(graph, labels, baseline, flatness)
    if not initial_validation["pass"] or not vector_result["hardGate"]["pass"]:
        raise ValueError("contour input is not a valid baseline embedding")
    baseline_raster = initial_validation["raster"]
    # Protect complete narrow components (including one-pixel black strokes and
    # decoration dots), never infer that their area makes them disposable.
    # The threshold is a fixed experimental protection rule, not a hard-gate
    # numeric tolerance; all persistent corners still use the frozen detector.
    protected_regions = []
    protected_components = []
    protected_pixels = np.zeros(labels.shape, dtype=bool)
    branch_pixels = np.zeros(labels.shape, dtype=bool)
    branch_records = []
    for region_id in sorted(int(value) for value in np.unique(labels) if value > 0):
        mask = np.pad((labels == region_id).astype(np.uint8), 1)
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
        count, component_labels, stats, _ = cv2.connectedComponentsWithStats(mask[1:-1, 1:-1], connectivity=4)
        radius = np.zeros(count, dtype=np.float32)
        np.maximum.at(radius, component_labels.ravel(), distance.ravel())
        protected = [index for index in range(1, count) if radius[index] <= 2.0]
        protected_pixels |= np.isin(component_labels, protected)
        for index in protected:
            protected_components.append({"regionId": region_id, "rasterComponentIndex": index,
                                         "bboxXYWH": stats[index, :4].tolist(),
                                         "areaPixels": int(stats[index, cv2.CC_STAT_AREA]),
                                         "maxInscribedRadiusPx": float(radius[index])})
        if len(protected) == count - 1:
            protected_regions.append(region_id)
        else:
            # Skeleton is used only to protect local narrow branches in a
            # mixed-width component, never as the replacement contour. Ordinary
            # thick-object boundary pixels are not skeleton pixels, so this
            # avoids freezing every normal boundary by distance-to-edge alone.
            skeleton = skeletonize(mask[1:-1, 1:-1].astype(bool))
            narrow = skeleton & (distance <= LOCAL_BRANCH_RADIUS_PX) & (radius[component_labels] > LOCAL_BRANCH_RADIUS_PX)
            yy, xx = np.where(narrow)
            for y, x in zip(yy, xx):
                corridor = float(distance[y, x]) + LOCAL_BRANCH_CORRIDOR_MARGIN_PX
                extent = int(np.ceil(corridor))
                y0, y1 = max(0, y-extent), min(labels.shape[0], y+extent+1)
                x0, x1 = max(0, x-extent), min(labels.shape[1], x+extent+1)
                rows, columns = np.mgrid[y0:y1, x0:x1]
                branch_pixels[y0:y1, x0:x1] |= ((rows-y)**2 + (columns-x)**2 <= corridor**2)
            if len(xx):
                branch_records.append({"regionId": region_id, "narrowSkeletonPixelCount": int(len(xx)),
                                       "bbox": [int(xx.min()), int(yy.min()), int(xx.max())+1, int(yy.max())+1]})
    protected_edges = set()
    branch_vertices = {}
    height, width = labels.shape
    for edge in graph["edges"]:
        # Raw graph points are integer pixel-cell corners. Testing the four
        # incident cells identifies exactly which inherited shared chains touch
        # protected components, including same-colour disconnected decoration.
        for x, y in edge["geometry"]:
            if any(0 <= yy < height and 0 <= xx < width and protected_pixels[yy, xx]
                   for xx, yy in ((int(x)-1, int(y)-1), (int(x), int(y)-1),
                                  (int(x)-1, int(y)), (int(x), int(y)))):
                protected_edges.add(edge["edgeId"])
                break
        indices = []
        for index, (x, y) in enumerate(edge["geometry"]):
            if any(0 <= yy < height and 0 <= xx < width and branch_pixels[yy, xx]
                   for xx, yy in ((int(x)-1, int(y)-1), (int(x), int(y)-1),
                                  (int(x)-1, int(y)), (int(x), int(y)))):
                indices.append(index)
        if indices:
            branch_vertices[edge["edgeId"]] = indices
    report = {
        "strategyVersion": STRATEGY_VERSION, "enabled": enabled,
        "inputVectorSha256": _sha(vector_result),
        "inputLabelsSha256": input_labels_sha,
        "designDeviationBudgetsPx": list(DESIGN_BUDGETS_PX),
        "fitBudgetFraction": FIT_BUDGET_FRACTION,
        "numericalValidationFlatnessPx": flatness,
        "cornerDetection": copy.deepcopy(vector_config["cornerDetection"]),
        "hardChecks": "UNCHANGED_FROZEN_EMBEDDING_AND_CONTINUOUS_BOUND_PLUS_THIN_REGION_GEOMETRY_PRESERVATION",
        "thinRegionMaxInscribedRadiusPx": 2.0,
        "protectedThinRegionIds": protected_regions,
        "protectedThinComponents": protected_components,
        "protectedThinEdgeIds": sorted(protected_edges),
        "localBranchProtection": {"maxSkeletonRadiusPx": LOCAL_BRANCH_RADIUS_PX,
                                  "corridorMarginPx": LOCAL_BRANCH_CORRIDOR_MARGIN_PX,
                                  "detector": "SKIMAGE_SKELETON_PROTECTION_ONLY_NOT_GEOMETRY",
                                  "regions": branch_records, "edgeVertexIndices": branch_vertices},
        "trials": [], "changedEdges": [], "status": "DISABLED" if not enabled else "NO_LEGAL_IMPROVEMENT",
        "baselineSegmentCount": _complexity(baseline),
        "baselineFallbacks": {item["edgeId"]: item["fallback"] for item in vector_result["geometry"] if item.get("fallback")},
    }
    selected = copy.deepcopy(vector_result)
    selected_geometries = baseline
    if enabled:
        for budget in DESIGN_BUDGETS_PX:
            proposed = copy.deepcopy(baseline)
            diagnostics, reasons = {}, {}
            for edge in graph["edges"]:
                edge_id = edge["edgeId"]
                if edge_id in protected_edges:
                    reasons[edge_id] = "THIN_REGION_GEOMETRY_PRESERVATION"
                    continue
                try:
                    if edge_id in branch_vertices:
                        segments, detail = _fit_protected_chain(kernel, edge, budget * FIT_BUDGET_FRACTION,
                                                                vector_config, set(branch_vertices[edge_id]))
                    else:
                        segments, detail = kernel.fit_chain(edge, budget * FIT_BUDGET_FRACTION, vector_config["cornerDetection"], vector_config["bezier"])
                except (np.linalg.LinAlgError, FloatingPointError) as error:
                    reasons[edge_id] = "NUMERICAL_FIT_FAILURE:" + type(error).__name__
                    continue
                diagnostics[edge_id] = detail
                # Fewer segments is an explicit geometric complexity proxy,
                # never asserted to be human visual quality by itself.
                if len(segments) < len(baseline[edge_id]):
                    proposed[edge_id] = segments
                else:
                    reasons[edge_id] = "NO_SEGMENT_REDUCTION"
            proposed, embedding_fallbacks, validation = kernel._stabilize(
                graph, labels, proposed, [baseline], flatness, kernel.ROUTE_V2)
            reasons.update(embedding_fallbacks)
            proposed, deviation = kernel._enforce_continuous_bound(
                graph, proposed, [baseline], budget, flatness, reasons, kernel.ROUTE_V2)
            proposed, extra, validation = kernel._stabilize(
                graph, labels, proposed, [baseline], flatness, kernel.ROUTE_V2)
            reasons.update(extra)
            deviation = kernel.aggregate_deviation(graph, proposed, flatness)
            # Retained baseline edges may have a larger approved baseline
            # budget than this particular trial. The result must declare both.
            effective_budget = max(budget, float(vector_result.get("tolerancePx") or 0.0))
            result, raster = kernel._result(
                vector_result["caseId"], vector_result["profile"], kernel.ROUTE_V2,
                effective_budget, vector_result["inputSha256"], graph, labels,
                proposed, diagnostics, reasons, copy.deepcopy(validation), flatness, deviation)
            legal = bool(result["hardGate"]["pass"])
            count = _complexity(proposed)
            report["trials"].append({"designBudgetPx": budget, "effectiveMaxBudgetPx": effective_budget,
                                     "fitTolerancePx": budget * FIT_BUDGET_FRACTION,
                                     "segmentCount": count, "legal": legal,
                                     "baselineRasterIdentical": bool(np.array_equal(raster, baseline_raster)),
                                     "changedRasterPixelCount": int(np.count_nonzero(raster != baseline_raster)),
                                     "hardGate": result["hardGate"], "edgeReasons": reasons,
                                     "symmetricMaxBoundaryDeviation": deviation["symmetricMaxBoundaryDeviation"]})
            if legal and count < _complexity(selected_geometries):
                selected, selected_geometries = result, proposed
                report["selectedDesignBudgetPx"] = budget
                report["status"] = "LEGAL_SEGMENT_REDUCTION_PENDING_VISUAL_REVIEW"
    for edge in graph["edges"]:
        edge_id = edge["edgeId"]
        before, after = baseline[edge_id], selected_geometries[edge_id]
        if before == after:
            continue
        points = np.asarray(edge["geometry"])
        original = kernel.flatten_segments(before, flatness)
        report["changedEdges"].append({
            "edgeId": edge_id, "leftRegionId": edge["leftRegionId"], "rightRegionId": edge["rightRegionId"],
            "bbox": [*points.min(axis=0).tolist(), *points.max(axis=0).tolist()],
            "beforeSegmentCount": len(before), "afterSegmentCount": len(after),
            "baselineToSelectedDeviation": geometry_deviation(original, after, flatness),
            "beforeGeometrySha256": _sha(before), "afterGeometrySha256": _sha(after),
            "beforeSegments": before, "afterSegments": after,
        })
    report["selectedSegmentCount"] = _complexity(selected_geometries)
    final_validation = kernel.validate_embedding(graph, labels, selected_geometries, flatness)
    changed = final_validation["raster"] != baseline_raster
    yy, xx = np.where(changed)
    report["changedRasterPixelCount"] = int(len(xx))
    report["changedRasterBbox"] = [int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1] if len(xx) else None
    report["selectedVectorSha256"] = _sha(selected)
    report["humanVisualAcceptance"] = "PENDING"
    return selected, report
