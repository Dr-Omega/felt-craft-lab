"""Local, alpha-preserving color-region purification candidates for P0-04B1."""

from __future__ import annotations

from dataclasses import dataclass
import math
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
    structural_label_map: np.ndarray
    pixel_label_map: np.ndarray
    fringe_metrics: dict[str, int]

    @property
    def label_map(self) -> np.ndarray:
        """Legacy alias for callers that consume the all-pixel assignment map."""
        return self.pixel_label_map


class ColorPurificationCandidate(Protocol):
    candidate_id: str

    def propose(self, rgba: np.ndarray, config: dict[str, Any]) -> CandidateOutput: ...


def validate_rgba(rgba: np.ndarray) -> None:
    if not isinstance(rgba, np.ndarray) or rgba.ndim != 3 or rgba.shape[2] != 4 or rgba.dtype != np.uint8:
        raise ColorPurificationError("input must be a uint8 RGBA array")
    if not np.any(rgba[..., 3] > 0):
        raise ColorPurificationError("input is completely transparent")


def structural_active_mask(alpha: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    """Mask used solely for structural topology and region proposal, never alpha output."""
    threshold = int(config.get("structuralAlphaThreshold", 1))
    if not 1 <= threshold <= 255:
        raise ColorPurificationError("structuralAlphaThreshold must be in [1, 255]")
    return alpha >= threshold


def _component_summary(mask: np.ndarray) -> dict[str, int | float]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA].astype(np.int64)
    return {
        "component_count": int(count - 1),
        "largest_component_area": int(areas.max()) if len(areas) else 0,
        "median_component_area": float(np.median(areas)) if len(areas) else 0.0,
        "components_under_4px": int(np.count_nonzero(areas < 4)),
        "components_under_16px": int(np.count_nonzero(areas < 16)),
        "components_under_64px": int(np.count_nonzero(areas < 64)),
    }


def alpha_topology_diagnostics(alpha: np.ndarray) -> dict[str, dict[str, int | float]]:
    """Audit alpha topology at fixed thresholds without changing any source pixels."""
    return {f"alpha_ge_{threshold}": _component_summary(alpha >= threshold) for threshold in (1, 32, 64, 128, 192, 224)}


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


def _ciede2000_single(first: np.ndarray, second: np.ndarray) -> float:
    """Scalar CIEDE2000 for CP-B's sequential running-mean admission check."""
    l1, a1, b1 = (float(value) for value in first)
    l2, a2, b2 = (float(value) for value in second)
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    mean_c = (c1 + c2) / 2.0
    factor = 0.5 * (1.0 - math.sqrt(mean_c ** 7 / (mean_c ** 7 + 25.0 ** 7)))
    a1p, a2p = (1.0 + factor) * a1, (1.0 + factor) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360.0 if c1p else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360.0 if c2p else 0.0
    delta_l = l2 - l1
    delta_c = c2p - c1p
    hue_delta = h2p - h1p
    if c1p * c2p == 0.0:
        delta_h = 0.0
    elif hue_delta > 180.0:
        delta_h = hue_delta - 360.0
    elif hue_delta < -180.0:
        delta_h = hue_delta + 360.0
    else:
        delta_h = hue_delta
    delta_h_term = 2.0 * math.sqrt(c1p * c2p) * math.sin(math.radians(delta_h / 2.0))
    mean_l, mean_cp = (l1 + l2) / 2.0, (c1p + c2p) / 2.0
    if c1p * c2p == 0.0:
        mean_h = h1p + h2p
    elif abs(hue_delta) <= 180.0:
        mean_h = (h1p + h2p) / 2.0
    elif h1p + h2p < 360.0:
        mean_h = (h1p + h2p + 360.0) / 2.0
    else:
        mean_h = (h1p + h2p - 360.0) / 2.0
    chroma_term = (
        1.0
        - 0.17 * math.cos(math.radians(mean_h - 30.0))
        + 0.24 * math.cos(math.radians(2.0 * mean_h))
        + 0.32 * math.cos(math.radians(3.0 * mean_h + 6.0))
        - 0.20 * math.cos(math.radians(4.0 * mean_h - 63.0))
    )
    rotation = 30.0 * math.exp(-((mean_h - 275.0) / 25.0) ** 2)
    response = 2.0 * math.sqrt(mean_cp ** 7 / (mean_cp ** 7 + 25.0 ** 7))
    scale_l = 1.0 + 0.015 * (mean_l - 50.0) ** 2 / math.sqrt(20.0 + (mean_l - 50.0) ** 2)
    scale_c = 1.0 + 0.045 * mean_cp
    scale_h = 1.0 + 0.015 * mean_cp * chroma_term
    interaction = -math.sin(math.radians(2.0 * rotation)) * response
    return math.sqrt(
        (delta_l / scale_l) ** 2
        + (delta_c / scale_c) ** 2
        + (delta_h_term / scale_h) ** 2
        + interaction * (delta_c / scale_c) * (delta_h_term / scale_h)
    )


def _ciede2000_region_grow_labels(
    lab: np.ndarray,
    active: np.ndarray,
    local_edge_threshold: float,
    region_mean_threshold: float,
) -> np.ndarray:
    """CP-B row-major seeded, running-mean CIEDE2000 8-connected region grower."""
    if local_edge_threshold <= 0 or region_mean_threshold <= 0:
        raise ColorPurificationError("CP-B DeltaE thresholds must be positive")
    height, width = active.shape
    labels = np.zeros(active.shape, dtype=np.int32)
    # Precompute only the local-edge condition in vector form. The second,
    # running-statistic condition remains sequential by design.
    local_edges: dict[tuple[int, int], np.ndarray] = {
        (0, 1): active[:, :-1] & active[:, 1:] & (deltaE_ciede2000(lab[:, :-1], lab[:, 1:]) <= local_edge_threshold),
        (1, 0): active[:-1, :] & active[1:, :] & (deltaE_ciede2000(lab[:-1, :], lab[1:, :]) <= local_edge_threshold),
        (1, 1): active[:-1, :-1] & active[1:, 1:] & (deltaE_ciede2000(lab[:-1, :-1], lab[1:, 1:]) <= local_edge_threshold),
        (1, -1): active[:-1, 1:] & active[1:, :-1] & (deltaE_ciede2000(lab[:-1, 1:], lab[1:, :-1]) <= local_edge_threshold),
    }

    def edge_allowed(y: int, x: int, ny: int, nx: int) -> bool:
        dy, dx = ny - y, nx - x
        if dy < 0 or (dy == 0 and dx < 0):
            return edge_allowed(ny, nx, y, x)
        if (dy, dx) == (0, 1):
            return bool(local_edges[(0, 1)][y, x])
        if (dy, dx) == (1, 0):
            return bool(local_edges[(1, 0)][y, x])
        if (dy, dx) == (1, 1):
            return bool(local_edges[(1, 1)][y, x])
        return bool(local_edges[(1, -1)][y, nx])

    next_label = 0
    neighbours = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
    for y in range(height):
        for x in range(width):
            if not active[y, x] or labels[y, x]:
                continue
            next_label += 1
            labels[y, x] = next_label
            queue: list[tuple[int, int]] = [(y, x)]
            cursor = 0
            running_sum = lab[y, x].astype(np.float64).copy()
            count = 1
            while cursor < len(queue):
                cy, cx = queue[cursor]
                cursor += 1
                mean = running_sum / count
                for dy, dx in neighbours:
                    ny, nx = cy + dy, cx + dx
                    if ny < 0 or ny >= height or nx < 0 or nx >= width or not active[ny, nx] or labels[ny, nx]:
                        continue
                    if edge_allowed(cy, cx, ny, nx) and _ciede2000_single(lab[ny, nx], mean) <= region_mean_threshold:
                        labels[ny, nx] = next_label
                        queue.append((ny, nx))
                        running_sum += lab[ny, nx]
                        count += 1
    return labels


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
        _ciede2000_region_grow_labels(
            lab,
            active,
            float(config["localEdgeThreshold"]),
            float(config["regionMeanThreshold"]),
        ),
        lab,
        config,
    )


def raw_local_fragmentation_baseline(lab: np.ndarray, active: np.ndarray) -> np.ndarray:
    """Fixed candidate-independent pre-purification local fragmentation diagnostic."""
    return _neighbor_component_labels(lab, active, RAW_FRAGMENTATION_DELTA_E)


def assign_fringe_pixels(
    rgba: np.ndarray,
    structural_labels: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, dict[str, int]]:
    """Assign non-structural alpha pixels locally without allowing new structure IDs.

    Positive labels inherit a nearest structural region through deterministic
    8-neighbour waves. `-1` is an explicit ORPHAN_FRINGE pixel: it stays in the
    pixel assignment map and preserves its input RGB/alpha, but is never treated
    as a structural region or silently discarded.
    """
    active = rgba[..., 3] > 0
    structural = structural_labels > 0
    pixel_labels = structural_labels.astype(np.int32, copy=True)
    fringe = active & ~structural
    max_distance = int(config.get("fringeMaxPropagationDistancePx", 4))
    if max_distance < 0:
        raise ColorPurificationError("fringeMaxPropagationDistancePx must not be negative")
    for _ in range(max_distance):
        pending = fringe & (pixel_labels == 0)
        if not np.any(pending):
            break
        candidates: list[np.ndarray] = []
        padded = np.pad(pixel_labels, 1, mode="constant")
        for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
            candidates.append(padded[1 + dy:1 + dy + pixel_labels.shape[0], 1 + dx:1 + dx + pixel_labels.shape[1]])
        stacked = np.stack(candidates, axis=0)
        positive = np.where(stacked > 0, stacked, np.iinfo(np.int32).max)
        nearest = positive.min(axis=0)
        assignable = pending & (nearest != np.iinfo(np.int32).max)
        pixel_labels[assignable] = nearest[assignable]
    orphan = fringe & (pixel_labels == 0)
    pixel_labels[orphan] = -1
    if np.any(pixel_labels[~active] != 0):
        raise AssertionError("transparent pixels must remain pixel label 0")
    if np.any((pixel_labels[active] == 0)):
        raise AssertionError("every non-transparent pixel must have an assignment label")
    return pixel_labels, {
        "fringe_pixel_count": int(np.count_nonzero(fringe)),
        "fringe_assigned_count": int(np.count_nonzero(fringe & (pixel_labels > 0))),
        "orphan_fringe_count": int(np.count_nonzero(orphan)),
    }


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
        structural_labels = _candidate_labels_cp_a(
            rgb_to_lab(proposal_rgb), structural_active_mask(rgba[..., 3], config), config,
        )
        pixel_labels, fringe_metrics = assign_fringe_pixels(rgba, structural_labels, config)
        return CandidateOutput(self.candidate_id, proposal_rgb, structural_labels, pixel_labels, fringe_metrics)


class LabSpatialRegionGrowingCandidate:
    candidate_id = "CP-B"

    def propose(self, rgba: np.ndarray, config: dict[str, Any]) -> CandidateOutput:
        validate_rgba(rgba)
        # Deterministic CIEDE2000 local-edge + running-mean spatial region growing.
        rgb = rgba[..., :3]
        structural_labels = _candidate_labels_cp_b(
            rgb_to_lab(rgb), structural_active_mask(rgba[..., 3], config), config,
        )
        pixel_labels, fringe_metrics = assign_fringe_pixels(rgba, structural_labels, config)
        return CandidateOutput(self.candidate_id, rgb.copy(), structural_labels, pixel_labels, fringe_metrics)


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
    local_rgb = rgba[y0:y1, x0:x1, :3]
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
    elif method == "RC-D":
        # Benchmark-only deterministic CIEDE2000 medoid. Region Core rejects
        # RC-D as a Frozen/Production representative method.
        sample_indices = np.arange(len(values), dtype=np.int32)
        if len(values) > 512:
            sample_indices = np.linspace(0, len(values) - 1, num=512, dtype=np.int32)
        sample = values[sample_indices]
        distances = deltaE_ciede2000(sample[:, None, :], sample[None, :, :])
        source_index = int(sample_indices[int(np.argmin(np.sum(distances, axis=1)))])
        representative_lab = values[source_index]
        representative_rgb = local_rgb[core][source_index].copy()
    else:
        raise ColorPurificationError(f"unknown representative color method {method}")
    if method != "RC-D":
        representative_rgb = lab_to_rgb(np.asarray(representative_lab, dtype=np.float32).reshape(1, 1, 3))[0, 0]
    return representative_rgb, representative_lab.astype(np.float32), int(np.count_nonzero(core))


def representative_details(
    rgba: np.ndarray,
    region_mask: np.ndarray,
    method: str,
    config: dict[str, Any],
    source_lab: np.ndarray | None = None,
) -> dict[str, Any]:
    """Return deterministic representative diagnostics without proposing labels."""
    validate_rgba(rgba)
    lab = rgb_to_lab(rgba[..., :3]) if source_lab is None else source_lab
    if lab.shape != rgba.shape[:2] + (3,):
        raise ColorPurificationError("source_lab must match RGBA dimensions")
    rgb, representative_lab, core_count = _representative_from_lab(rgba, lab, region_mask, method, config)
    sample_count = core_count
    return {
        "representativeRgb": [int(channel) for channel in rgb],
        "representativeLab": [float(channel) for channel in representative_lab],
        "corePixelCount": core_count,
        "medoidSampleCount": min(sample_count, 512) if method == "RC-D" else None,
        "approximateMedoid": bool(method == "RC-D" and sample_count > 512),
    }


def apply_representatives(
    rgba: np.ndarray,
    structural_label_map: np.ndarray,
    representative_method: str,
    config: dict[str, Any],
    pixel_label_map: np.ndarray | None = None,
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    validate_rgba(rgba)
    if structural_label_map.shape != rgba.shape[:2] or structural_label_map.dtype.kind not in "iu":
        raise ColorPurificationError("structural label map must be an integer image matching RGBA dimensions")
    active = rgba[..., 3] > 0
    if np.any(structural_label_map[~active] != 0):
        raise ColorPurificationError("structural background must be label 0")
    pixel_labels = structural_label_map if pixel_label_map is None else pixel_label_map
    if pixel_labels.shape != rgba.shape[:2] or pixel_labels.dtype.kind not in "iu":
        raise ColorPurificationError("pixel label map must be an integer image matching RGBA dimensions")
    if np.any(pixel_labels[~active] != 0) or np.any(pixel_labels[active] == 0):
        raise ColorPurificationError("pixel map must assign every non-transparent pixel and keep transparent pixels at 0")
    purified = rgba.copy()
    source_lab = rgb_to_lab(rgba[..., :3])
    metadata: list[dict[str, Any]] = []
    for region_id in np.unique(structural_label_map[structural_label_map > 0]):
        region_mask = structural_label_map == region_id
        representative_rgb, representative_lab, core_count = _representative_from_lab(
            rgba, source_lab, region_mask, representative_method, config,
        )
        assigned_mask = pixel_labels == region_id
        purified[assigned_mask, :3] = representative_rgb
        ys, xs = np.where(region_mask)
        source_variance = float(np.mean(np.var(source_lab[region_mask], axis=0)))
        metadata.append({
            "regionId": int(region_id),
            "pixelCount": int(np.count_nonzero(region_mask)),
            "structuralPixelCount": int(np.count_nonzero(region_mask)),
            "assignedPixelCount": int(np.count_nonzero(assigned_mask)),
            "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
            "representativeColorRgb": [int(channel) for channel in representative_rgb],
            "representativeColorLab": [round(float(channel), 6) for channel in representative_lab],
            "sourceColorVariance": round(source_variance, 8),
            "outputColorVariance": 0.0,
            "componentCount": 1,
            "corePixelCount": core_count,
        })
    _assign_color_groups(metadata, float(config.get("colorGroupDeltaE", 3.0)))
    if not np.array_equal(purified[..., 3], rgba[..., 3]):
        raise AssertionError("purification must preserve alpha bit-identically")
    return purified, metadata


def _assign_color_groups(metadata: list[dict[str, Any]], threshold: float) -> None:
    """Experimental, conservative color identity grouping; it never changes masks."""
    if threshold <= 0:
        raise ColorPurificationError("colorGroupDeltaE must be positive")
    groups: list[tuple[int, np.ndarray]] = []
    for region in metadata:
        color = np.asarray(region["representativeColorLab"], dtype=np.float32)
        choices = [(_ciede2000_single(color, prototype), group_id) for group_id, prototype in groups]
        if choices and min(choices)[0] <= threshold:
            distance, group_id = min(choices)
            confidence = max(0.0, 1.0 - distance / threshold)
        else:
            group_id = len(groups) + 1
            groups.append((group_id, color))
            confidence = 1.0
        region.update({
            "colorGroupId": int(group_id),
            "colorGroupStatus": "EXPERIMENTAL",
            "groupConfidence": round(float(confidence), 6),
        })


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


def boundary_shift(
    labels: np.ndarray,
    source_rgba: np.ndarray,
    strong_edge_delta_e: float,
    active: np.ndarray | None = None,
) -> tuple[float, str]:
    """Normalized boundary shift plus absence state; 1.0 is never silently normal."""
    active = source_rgba[..., 3] > 0 if active is None else active
    candidate = _internal_boundary(labels)
    reference = _strong_color_edges(rgb_to_lab(source_rgba[..., :3]), active, strong_edge_delta_e)
    if not np.any(candidate) and not np.any(reference):
        return 0.0, "BOTH_EMPTY"
    if not np.any(candidate):
        return 1.0, "NO_CANDIDATE_BOUNDARY"
    if not np.any(reference):
        return 1.0, "NO_REFERENCE_BOUNDARY"
    distance_to_reference = cv2.distanceTransform((~reference).astype(np.uint8), cv2.DIST_L2, 3)
    distance_to_candidate = cv2.distanceTransform((~candidate).astype(np.uint8), cv2.DIST_L2, 3)
    diagonal = float(np.hypot(*labels.shape))
    return float((distance_to_reference[candidate].mean() + distance_to_candidate[reference].mean()) / (2.0 * diagonal)), "NORMAL"


def metrics_for_run(
    source_rgba: np.ndarray,
    structural_label_map: np.ndarray,
    purified_rgba: np.ndarray,
    config: dict[str, Any],
    ground_truth_approx_region_count: int | None = None,
    delta_e_method: str = "LAB_EUCLIDEAN_APPROX",
    pixel_label_map: np.ndarray | None = None,
    regions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    structural_active = structural_active_mask(source_rgba[..., 3], config)
    before = raw_local_fragmentation_baseline(rgb_to_lab(source_rgba[..., :3]), structural_active)
    source_lab = rgb_to_lab(source_rgba[..., :3])
    output_lab = rgb_to_lab(purified_rgba[..., :3])
    after_variances = []
    before_variances = []
    for region_id in np.unique(structural_label_map[structural_label_map > 0]):
        region = structural_label_map == region_id
        before_variances.append(float(np.mean(np.var(source_lab[region], axis=0))))
        after_variances.append(float(np.mean(np.var(output_lab[region], axis=0))))
    small_limit = int(config["smallRegionArea"])
    areas = np.bincount(structural_label_map[structural_label_map > 0], minlength=int(structural_label_map.max()) + 1)[1:]
    local_region_count = int(len(areas))
    geometry_component_count = int(_component_summary(structural_active)["component_count"])
    group_count = (len({int(region["colorGroupId"]) for region in regions}) if regions is not None else local_region_count)
    approximate_count = int(ground_truth_approx_region_count) if ground_truth_approx_region_count else None
    legacy_ratio = (local_region_count / approximate_count) if approximate_count else None
    color_group_ratio = (group_count / approximate_count) if approximate_count else None
    if color_group_ratio is None:
        order_gate = "NOT_AVAILABLE"
    elif 0.5 <= color_group_ratio <= 5.0:
        order_gate = "PASS"
    elif 0.25 <= color_group_ratio < 0.5 or 5.0 < color_group_ratio <= 15.0:
        order_gate = "WARN"
    else:
        order_gate = "FAIL"
    shift, shift_state = boundary_shift(structural_label_map, source_rgba, float(config["strongEdgeDeltaE"]), structural_active)
    fringe = source_rgba[..., 3] > 0 if pixel_label_map is None else (source_rgba[..., 3] > 0) & (structural_label_map == 0)
    pixel_labels = structural_label_map if pixel_label_map is None else pixel_label_map
    return {
        "region_count_before": int(np.max(before)),
        "region_count_after": local_region_count,
        "region_count_after_semantics": "SEMANTICALLY_APPROXIMATE: local connected color regions are not one-to-one with B0 expectedColorRegions",
        "geometry_component_count": geometry_component_count,
        "local_region_count_after": local_region_count,
        "color_group_count_after": group_count,
        "small_component_count_before": int(sum(np.count_nonzero(before == label) < small_limit for label in np.unique(before[before > 0]))),
        "small_component_count_after": int(np.count_nonzero(areas < small_limit)),
        "small_component_ratio_after": round(float(np.count_nonzero(areas < small_limit) / local_region_count) if local_region_count else 0.0, 8),
        "mean_region_area": round(float(np.mean(areas)) if local_region_count else 0.0, 8),
        "median_region_area": round(float(np.median(areas)) if local_region_count else 0.0, 8),
        "p10_region_area": round(float(np.percentile(areas, 10)) if local_region_count else 0.0, 8),
        "ground_truth_approx_region_count": approximate_count,
        "region_count_ratio_to_gt": round(float(legacy_ratio), 8) if legacy_ratio is not None else None,
        "region_count_ratio_to_gt_semantics": "SEMANTICALLY_APPROXIMATE",
        "color_group_ratio_to_gt": round(float(color_group_ratio), 8) if color_group_ratio is not None else None,
        "region_count_order_gate": order_gate,
        "within_region_color_variance_before": round(float(np.mean(before_variances)) if before_variances else 0.0, 8),
        "within_region_color_variance_after": round(float(np.mean(after_variances)) if after_variances else 0.0, 8),
        "boundary_shift": round(shift, 8),
        "boundary_shift_state": shift_state,
        "fringe_pixel_count": int(np.count_nonzero(fringe)),
        "fringe_assigned_count": int(np.count_nonzero(fringe & (pixel_labels > 0))),
        "orphan_fringe_count": int(np.count_nonzero(fringe & (pixel_labels < 0))),
        "alpha_topology": alpha_topology_diagnostics(source_rgba[..., 3]),
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
        "boundary_shift_definition": "normalized symmetric Chamfer-like distance between structural label boundaries and structural-mask Lab strong-color edges; 1.0 with a non-NORMAL state means one side had no boundary",
    }
