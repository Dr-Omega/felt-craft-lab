"""Local, alpha-preserving color-region purification candidates for P0-04B1."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import cv2
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from skimage.color import deltaE_ciede2000


class ColorPurificationError(ValueError):
    """Raised for fail-closed invalid PoC inputs or unsupported candidate IDs."""


@dataclass(frozen=True)
class CandidateOutput:
    candidate_id: str
    proposal_rgb: np.ndarray
    label_map: np.ndarray


class ColorPurificationCandidate(Protocol):
    candidate_id: str

    def propose(self, rgba: np.ndarray, config: dict[str, Any]) -> CandidateOutput: ...


def validate_rgba(rgba: np.ndarray) -> None:
    if not isinstance(rgba, np.ndarray) or rgba.ndim != 3 or rgba.shape[2] != 4 or rgba.dtype != np.uint8:
        raise ColorPurificationError("input must be a uint8 RGBA array")
    if not np.any(rgba[..., 3] > 0):
        raise ColorPurificationError("input is completely transparent")


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab[..., 0] *= 100.0 / 255.0
    lab[..., 1:] -= 128.0
    return lab


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    converted = np.array(lab, dtype=np.float32, copy=True)
    converted[..., 0] *= 255.0 / 100.0
    converted[..., 1:] += 128.0
    return cv2.cvtColor(np.clip(np.rint(converted), 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


RAW_FRAGMENTATION_DELTA_E = 5.0


def _compact_labels(labels: np.ndarray) -> np.ndarray:
    """Keep background at zero while making positive local labels consecutive."""
    compact = np.zeros(labels.shape, dtype=np.int32)
    foreground = labels > 0
    if not np.any(foreground):
        return compact
    _, inverse = np.unique(labels[foreground], return_inverse=True)
    compact[foreground] = inverse.astype(np.int32) + 1
    return compact


def _labels_from_local_edges(active: np.ndarray, local_edges: list[np.ndarray]) -> np.ndarray:
    """Build deterministic labels from explicit 8-connected local edges only."""
    height, width = active.shape
    active_flat = np.flatnonzero(active.ravel())
    labels = np.zeros(active.shape, dtype=np.int32)
    if not len(active_flat):
        return labels
    index = np.full(active.size, -1, dtype=np.int32)
    index[active_flat] = np.arange(len(active_flat), dtype=np.int32)
    row_indices: list[np.ndarray] = []
    col_indices: list[np.ndarray] = []
    # Edges are provided in the fixed right, down, down-right, down-left order.
    offsets = ((0, 1), (1, 0), (1, 1), (1, -1))
    for edge_mask, (dy, dx) in zip(local_edges, offsets, strict=True):
        if dy == 0:
            ys, xs = np.where(edge_mask)
            source_flat = ys * width + xs
            target_flat = ys * width + (xs + dx)
        elif dx >= 0:
            ys, xs = np.where(edge_mask)
            source_flat = ys * width + xs
            target_flat = (ys + dy) * width + (xs + dx)
        else:
            ys, xs = np.where(edge_mask)
            source_flat = ys * width + (xs + 1)
            target_flat = (ys + dy) * width + xs
        row_indices.extend((index[source_flat], index[target_flat]))
        col_indices.extend((index[target_flat], index[source_flat]))
    if row_indices:
        rows = np.concatenate(row_indices)
        cols = np.concatenate(col_indices)
        graph = coo_matrix((np.ones(len(rows), dtype=np.uint8), (rows, cols)), shape=(len(active_flat), len(active_flat))).tocsr()
        _, components = connected_components(graph, directed=False, return_labels=True)
    else:
        components = np.arange(len(active_flat), dtype=np.int32)
    labels.ravel()[active_flat] = components.astype(np.int32) + 1
    return _compact_labels(labels)


def _neighbor_component_labels(lab: np.ndarray, active: np.ndarray, delta_e_threshold: float) -> np.ndarray:
    """CP-A local extraction by Euclidean-Lab neighbour edges after Mean Shift."""
    if delta_e_threshold <= 0:
        raise ColorPurificationError("Lab DeltaE threshold must be positive")
    threshold_sq = float(delta_e_threshold) ** 2
    right = active[:, :-1] & active[:, 1:] & (np.sum((lab[:, :-1] - lab[:, 1:]) ** 2, axis=2) <= threshold_sq)
    down = active[:-1, :] & active[1:, :] & (np.sum((lab[:-1, :] - lab[1:, :]) ** 2, axis=2) <= threshold_sq)
    down_right = active[:-1, :-1] & active[1:, 1:] & (np.sum((lab[:-1, :-1] - lab[1:, 1:]) ** 2, axis=2) <= threshold_sq)
    down_left = active[:-1, 1:] & active[1:, :-1] & (np.sum((lab[:-1, 1:] - lab[1:, :-1]) ** 2, axis=2) <= threshold_sq)
    return _labels_from_local_edges(active, [right, down, down_right, down_left])


def _ciede2000_region_grow_labels(lab: np.ndarray, active: np.ndarray, delta_e_threshold: float) -> np.ndarray:
    """CP-B deterministic seeded 8-connected CIEDE2000 spatial region growing.

    Its local edge graph is exactly the set a fixed-order seeded grower would be
    permitted to traverse. Components are labelled by the compiled sparse graph
    traversal, avoiding a Python per-pixel queue while retaining the same local,
    alpha-bounded connectivity contract.
    """
    if delta_e_threshold <= 0:
        raise ColorPurificationError("Lab DeltaE threshold must be positive")
    threshold = float(delta_e_threshold)
    right = active[:, :-1] & active[:, 1:] & (deltaE_ciede2000(lab[:, :-1], lab[:, 1:]) <= threshold)
    down = active[:-1, :] & active[1:, :] & (deltaE_ciede2000(lab[:-1, :], lab[1:, :]) <= threshold)
    down_right = active[:-1, :-1] & active[1:, 1:] & (deltaE_ciede2000(lab[:-1, :-1], lab[1:, 1:]) <= threshold)
    down_left = active[:-1, 1:] & active[1:, :-1] & (deltaE_ciede2000(lab[:-1, 1:], lab[1:, :-1]) <= threshold)
    return _labels_from_local_edges(active, [right, down, down_right, down_left])


def _region_statistics(labels: np.ndarray, lab: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    count = int(labels.max())
    if count == 0:
        return np.zeros(1, dtype=np.int64), np.zeros((1, 3), dtype=np.float64)
    flat_labels = labels.ravel()
    areas = np.bincount(flat_labels, minlength=count + 1).astype(np.int64)
    means = np.zeros((count + 1, 3), dtype=np.float64)
    for channel in range(3):
        sums = np.bincount(flat_labels, weights=lab[..., channel].ravel(), minlength=count + 1)
        means[1:, channel] = sums[1:] / np.maximum(areas[1:], 1)
    return areas, means


def _adjacency_graph(labels: np.ndarray) -> dict[tuple[int, int], int]:
    """Return only spatially touching label pairs and their shared-edge counts."""
    graph: dict[tuple[int, int], int] = {}
    for left, right in ((labels[:, :-1], labels[:, 1:]), (labels[:-1, :], labels[1:, :])):
        mask = (left > 0) & (right > 0) & (left != right)
        if not np.any(mask):
            continue
        pairs = np.stack((left[mask], right[mask]), axis=1)
        pairs.sort(axis=1)
        unique, counts = np.unique(pairs, axis=0, return_counts=True)
        for pair, count in zip(unique, counts, strict=True):
            key = (int(pair[0]), int(pair[1]))
            graph[key] = graph.get(key, 0) + int(count)
    return graph


def _merge_local_adjacent_regions(labels: np.ndarray, lab: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    """Merge only genuinely adjacent micro-regions; never delete or globally merge."""
    strategy = str(config["smallRegionStrategy"])
    if strategy not in {"keep", "merge_adjacent_local"}:
        raise ColorPurificationError("smallRegionStrategy must be keep or merge_adjacent_local")
    if strategy == "keep" or int(labels.max()) == 0:
        return _compact_labels(labels)

    small_area = int(config["smallRegionArea"])
    merge_delta_e = float(config.get("smallRegionMergeDeltaE", config["labDeltaECell"]))
    result = labels.copy()
    # A bounded local relaxation is enough for micro-islands.  Each pass applies
    # every selected adjacency at once; never perform one full-image replacement
    # per region.
    for _ in range(4):
        areas, means = _region_statistics(result, lab)
        adjacency = _adjacency_graph(result)
        targets: dict[int, int] = {}
        for region_id in range(1, len(areas)):
            if areas[region_id] >= small_area:
                continue
            neighbours: list[tuple[float, int, int]] = []
            for (first, second), shared_boundary in adjacency.items():
                if first == region_id:
                    neighbour = second
                elif second == region_id:
                    neighbour = first
                else:
                    continue
                # Direct merges toward a strictly larger neighbour, or toward
                # the lower stable ID on an equal-area tie. This prevents two
                # touching small regions from forming a swap cycle.
                if areas[neighbour] < areas[region_id] or (areas[neighbour] == areas[region_id] and neighbour > region_id):
                    continue
                distance = float(np.linalg.norm(means[region_id] - means[neighbour]))
                if distance <= merge_delta_e:
                    # Prefer smallest Lab difference, then a larger true shared edge,
                    # then the stable region ID.
                    neighbours.append((distance, -shared_boundary, neighbour))
            if neighbours:
                targets[region_id] = min(neighbours)[2]
        if not targets:
            break
        remap = np.arange(len(areas), dtype=np.int32)
        for source, target in targets.items():
            remap[source] = target
        # Resolve deterministic source->target chains without permitting any
        # relationship not present in this pass's adjacency graph.
        for _ in range(len(remap)):
            resolved = remap[remap]
            if np.array_equal(resolved, remap):
                break
            remap = resolved
        result = _compact_labels(remap[result])
    return result


def _candidate_labels_cp_a(lab: np.ndarray, active: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    return _merge_local_adjacent_regions(
        _neighbor_component_labels(lab, active, float(config["labDeltaECell"])), lab, config,
    )


def _candidate_labels_cp_b(lab: np.ndarray, active: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    return _merge_local_adjacent_regions(
        _ciede2000_region_grow_labels(lab, active, float(config["labDeltaECell"])), lab, config,
    )


def raw_local_fragmentation_baseline(lab: np.ndarray, active: np.ndarray) -> np.ndarray:
    """Fixed candidate-independent pre-purification local fragmentation diagnostic."""
    return _neighbor_component_labels(lab, active, RAW_FRAGMENTATION_DELTA_E)


class MeanShiftLocalCandidate:
    candidate_id = "CP-A"

    def propose(self, rgba: np.ndarray, config: dict[str, Any]) -> CandidateOutput:
        validate_rgba(rgba)
        rgb = rgba[..., :3]
        filtered_bgr = cv2.pyrMeanShiftFiltering(
            cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR),
            sp=int(config["meanShiftSpatialRadius"]),
            sr=float(config["meanShiftColorRadius"]),
            maxLevel=1,
        )
        proposal_rgb = cv2.cvtColor(filtered_bgr, cv2.COLOR_BGR2RGB)
        labels = _candidate_labels_cp_a(rgb_to_lab(proposal_rgb), rgba[..., 3] > 0, config)
        return CandidateOutput(self.candidate_id, proposal_rgb, labels)


class LabSpatialRegionGrowingCandidate:
    candidate_id = "CP-B"

    def propose(self, rgba: np.ndarray, config: dict[str, Any]) -> CandidateOutput:
        validate_rgba(rgba)
        # Deterministic Lab + DeltaE running-mean spatial region growing.
        rgb = rgba[..., :3]
        labels = _candidate_labels_cp_b(rgb_to_lab(rgb), rgba[..., 3] > 0, config)
        return CandidateOutput(self.candidate_id, rgb.copy(), labels)


def get_candidate(candidate_id: str) -> ColorPurificationCandidate:
    if candidate_id == "CP-A":
        return MeanShiftLocalCandidate()
    if candidate_id == "CP-B":
        return LabSpatialRegionGrowingCandidate()
    if candidate_id == "CP-C":
        raise ColorPurificationError("CP-C_STATUS=DEPENDENCY_UNAVAILABLE: VTracer watershed baseline is unavailable")
    raise ColorPurificationError(f"unknown candidate {candidate_id}")


def core_sampling_mask(region_mask: np.ndarray, alpha: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    if region_mask.dtype != bool:
        region_mask = region_mask.astype(bool)
    alpha_ok = alpha >= int(config["coreAlphaMin"])
    distance = cv2.distanceTransform(region_mask.astype(np.uint8), cv2.DIST_L2, 3)
    core = region_mask & alpha_ok & (distance >= float(config["coreDistancePx"]))
    if np.any(core):
        return core
    fallback = region_mask & alpha_ok
    return fallback if np.any(fallback) else region_mask


def representative_color(
    rgba: np.ndarray,
    region_mask: np.ndarray,
    method: str,
    config: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, int]:
    """Return RGB, Lab, and core-pixel count independently of region proposal candidate."""
    validate_rgba(rgba)
    if region_mask.shape != rgba.shape[:2] or not np.any(region_mask):
        raise ColorPurificationError("region mask must match input and contain pixels")
    return _representative_from_lab(rgba, rgb_to_lab(rgba[..., :3]), region_mask, method, config)


def _representative_from_lab(
    rgba: np.ndarray,
    lab: np.ndarray,
    region_mask: np.ndarray,
    method: str,
    config: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, int]:
    ys, xs = np.where(region_mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    local_mask = region_mask[y0:y1, x0:x1]
    local_alpha = rgba[y0:y1, x0:x1, 3]
    local_lab = lab[y0:y1, x0:x1]
    core = core_sampling_mask(local_mask, local_alpha, config)
    values = local_lab[core]
    if method == "RC-A":
        representative_lab = np.median(values, axis=0)
    elif method == "RC-B":
        width = float(config["histogramBinWidth"])
        bins = np.floor((values + np.array([0.0, 128.0, 128.0])) / width).astype(np.int32)
        _, inverse, counts = np.unique(bins, axis=0, return_inverse=True, return_counts=True)
        winning = int(np.argmax(counts))
        representative_lab = np.median(values[inverse == winning], axis=0)
    elif method == "RC-C":
        radius = float(config["densityRadius"])
        if len(values) > 512:
            values = values[np.linspace(0, len(values) - 1, num=512, dtype=np.int32)]
        distances = np.linalg.norm(values[:, None, :] - values[None, :, :], axis=2)
        center = int(np.argmax(np.sum(distances <= radius, axis=1)))
        representative_lab = np.median(values[distances[center] <= radius], axis=0)
    else:
        raise ColorPurificationError(f"unknown representative color method {method}")
    representative_rgb = lab_to_rgb(np.asarray(representative_lab, dtype=np.float32).reshape(1, 1, 3))[0, 0]
    return representative_rgb, representative_lab.astype(np.float32), int(np.count_nonzero(core))


def apply_representatives(
    rgba: np.ndarray,
    label_map: np.ndarray,
    representative_method: str,
    config: dict[str, Any],
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    validate_rgba(rgba)
    if label_map.shape != rgba.shape[:2] or label_map.dtype.kind not in "iu":
        raise ColorPurificationError("label map must be an integer image matching RGBA dimensions")
    active = rgba[..., 3] > 0
    if np.any(label_map[~active] != 0) or np.any(label_map[active] == 0):
        raise ColorPurificationError("label map must use 0 only for transparent pixels")
    purified = rgba.copy()
    source_lab = rgb_to_lab(rgba[..., :3])
    metadata: list[dict[str, Any]] = []
    for region_id in np.unique(label_map[active]):
        region_mask = label_map == region_id
        representative_rgb, representative_lab, core_count = _representative_from_lab(
            rgba, source_lab, region_mask, representative_method, config,
        )
        purified[region_mask, :3] = representative_rgb
        ys, xs = np.where(region_mask)
        source_variance = float(np.mean(np.var(source_lab[region_mask], axis=0)))
        metadata.append({
            "regionId": int(region_id),
            "pixelCount": int(np.count_nonzero(region_mask)),
            "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
            "representativeColorRgb": [int(channel) for channel in representative_rgb],
            "representativeColorLab": [round(float(channel), 6) for channel in representative_lab],
            "sourceColorVariance": round(source_variance, 8),
            "outputColorVariance": 0.0,
            "componentCount": 1,
            "corePixelCount": core_count,
        })
    if not np.array_equal(purified[..., 3], rgba[..., 3]):
        raise AssertionError("purification must preserve alpha bit-identically")
    return purified, metadata


def label_map_preview(label_map: np.ndarray) -> np.ndarray:
    preview = np.zeros((*label_map.shape, 4), dtype=np.uint8)
    preview[..., 3] = np.where(label_map > 0, 255, 0).astype(np.uint8)
    for region_id in np.unique(label_map[label_map > 0]):
        hue = (int(region_id) * 137) % 180
        color = cv2.cvtColor(np.array([[[hue, 180, 240]]], dtype=np.uint8), cv2.COLOR_HSV2RGB)[0, 0]
        preview[label_map == region_id, :3] = color
    return preview


def _internal_boundary(labels: np.ndarray) -> np.ndarray:
    boundary = np.zeros(labels.shape, dtype=bool)
    horizontal = (labels[:, 1:] > 0) & (labels[:, :-1] > 0) & (labels[:, 1:] != labels[:, :-1])
    vertical = (labels[1:, :] > 0) & (labels[:-1, :] > 0) & (labels[1:, :] != labels[:-1, :])
    boundary[:, 1:] |= horizontal
    boundary[:, :-1] |= horizontal
    boundary[1:, :] |= vertical
    boundary[:-1, :] |= vertical
    return boundary


def _strong_color_edges(lab: np.ndarray, active: np.ndarray, delta_e: float) -> np.ndarray:
    boundary = np.zeros(active.shape, dtype=bool)
    horizontal = active[:, 1:] & active[:, :-1] & (np.linalg.norm(lab[:, 1:] - lab[:, :-1], axis=2) >= delta_e)
    vertical = active[1:, :] & active[:-1, :] & (np.linalg.norm(lab[1:, :] - lab[:-1, :], axis=2) >= delta_e)
    boundary[:, 1:] |= horizontal
    boundary[:, :-1] |= horizontal
    boundary[1:, :] |= vertical
    boundary[:-1, :] |= vertical
    return boundary


def boundary_shift(labels: np.ndarray, source_rgba: np.ndarray, strong_edge_delta_e: float) -> float:
    """Normalized symmetric Chamfer-like distance between label and source strong-color boundaries."""
    active = source_rgba[..., 3] > 0
    candidate = _internal_boundary(labels)
    reference = _strong_color_edges(rgb_to_lab(source_rgba[..., :3]), active, strong_edge_delta_e)
    if not np.any(candidate) and not np.any(reference):
        return 0.0
    if not np.any(candidate) or not np.any(reference):
        return 1.0
    distance_to_reference = cv2.distanceTransform((~reference).astype(np.uint8), cv2.DIST_L2, 3)
    distance_to_candidate = cv2.distanceTransform((~candidate).astype(np.uint8), cv2.DIST_L2, 3)
    diagonal = float(np.hypot(*labels.shape))
    return float((distance_to_reference[candidate].mean() + distance_to_candidate[reference].mean()) / (2.0 * diagonal))


def metrics_for_run(
    source_rgba: np.ndarray,
    label_map: np.ndarray,
    purified_rgba: np.ndarray,
    config: dict[str, Any],
    ground_truth_approx_region_count: int | None = None,
    delta_e_method: str = "LAB_EUCLIDEAN_APPROX",
) -> dict[str, Any]:
    active = source_rgba[..., 3] > 0
    before = raw_local_fragmentation_baseline(rgb_to_lab(source_rgba[..., :3]), active)
    source_lab = rgb_to_lab(source_rgba[..., :3])
    output_lab = rgb_to_lab(purified_rgba[..., :3])
    after_variances = []
    before_variances = []
    for region_id in np.unique(label_map[active]):
        region = label_map == region_id
        before_variances.append(float(np.mean(np.var(source_lab[region], axis=0))))
        after_variances.append(float(np.mean(np.var(output_lab[region], axis=0))))
    small_limit = int(config["smallRegionArea"])
    areas = np.bincount(label_map[active], minlength=int(label_map.max()) + 1)[1:]
    region_count_after = int(len(areas))
    approximate_count = int(ground_truth_approx_region_count) if ground_truth_approx_region_count else None
    ratio = (region_count_after / approximate_count) if approximate_count else None
    if ratio is None:
        order_gate = "NOT_AVAILABLE"
    elif ratio <= 5.0:
        order_gate = "PASS"
    elif ratio <= 15.0:
        order_gate = "WARN"
    else:
        order_gate = "FAIL"
    return {
        "region_count_before": int(np.max(before)),
        "region_count_after": region_count_after,
        "small_component_count_before": int(sum(np.count_nonzero(before == label) < small_limit for label in np.unique(before[before > 0]))),
        "small_component_count_after": int(np.count_nonzero(areas < small_limit)),
        "small_component_ratio_after": round(float(np.count_nonzero(areas < small_limit) / region_count_after) if region_count_after else 0.0, 8),
        "mean_region_area": round(float(np.mean(areas)) if region_count_after else 0.0, 8),
        "median_region_area": round(float(np.median(areas)) if region_count_after else 0.0, 8),
        "p10_region_area": round(float(np.percentile(areas, 10)) if region_count_after else 0.0, 8),
        "ground_truth_approx_region_count": approximate_count,
        "region_count_ratio_to_gt": round(float(ratio), 8) if ratio is not None else None,
        "region_count_order_gate": order_gate,
        "within_region_color_variance_before": round(float(np.mean(before_variances)) if before_variances else 0.0, 8),
        "within_region_color_variance_after": round(float(np.mean(after_variances)) if after_variances else 0.0, 8),
        "boundary_shift": round(boundary_shift(label_map, source_rgba, float(config["strongEdgeDeltaE"])), 8),
        "false_merge_count": None,
        "false_split_count": None,
        "manual_quality_grade": "PENDING_MANUAL_REVIEW",
        "small_region_strategy": config["smallRegionStrategy"],
        "delta_e_method": delta_e_method,
        "raw_fragmentation_baseline": {
            "method": "fixed_lab_local_edge_connected_components",
            "deltaEThreshold": RAW_FRAGMENTATION_DELTA_E,
            "candidateIndependent": True,
        },
        "variance_interpretation": "within_region_color_variance_after verifies that final regions were unified; it does not establish that the proposal partition is correct",
        "boundary_shift_definition": "normalized symmetric Chamfer-like distance between internal candidate label boundaries and original Lab strong-color edges",
    }
