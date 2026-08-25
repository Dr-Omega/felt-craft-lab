"""Local, alpha-preserving color-region purification candidates for P0-04B1."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import cv2
import numpy as np
from skimage.segmentation import felzenszwalb


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


def _quantized_color_codes(lab: np.ndarray, delta_e_cell: float) -> np.ndarray:
    if delta_e_cell <= 0:
        raise ColorPurificationError("labDeltaECell must be positive")
    shifted = lab + np.array([0.0, 128.0, 128.0], dtype=np.float32)
    bins = np.floor(shifted / float(delta_e_cell)).astype(np.int32)
    return (bins[..., 0].astype(np.int64) << 32) + (bins[..., 1].astype(np.int64) << 16) + bins[..., 2].astype(np.int64)


def local_component_labels(lab: np.ndarray, active: np.ndarray, delta_e_cell: float, min_region_area: int) -> np.ndarray:
    """Assign one label per connected local Lab graph component, never per global color."""
    if delta_e_cell <= 0:
        raise ColorPurificationError("labDeltaECell must be positive")
    features = np.asarray(lab, dtype=np.float32).copy()
    # Transparent pixels are a hard graph barrier, never a color bridge.
    features[~active] = np.array([-1000.0, -1000.0, -1000.0], dtype=np.float32)
    proposals = felzenszwalb(
        features,
        scale=float(delta_e_cell) ** 2,
        sigma=0.0,
        min_size=max(1, int(min_region_area)),
        channel_axis=-1,
    )
    # Felzenszwalb labels are connected graph segments. Its alpha sentinel makes
    # transparent pixels a hard separator, so disconnected foreground pieces
    # cannot inherit a shared label merely from a similar global color.
    labels = np.zeros(active.shape, dtype=np.int32)
    foreground_segments = proposals[active]
    _, compact = np.unique(foreground_segments, return_inverse=True)
    labels[active] = compact.astype(np.int32) + 1
    return labels


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
        labels = local_component_labels(
            rgb_to_lab(proposal_rgb),
            rgba[..., 3] > 0,
            float(config["labDeltaECell"]),
            int(config["proposalMinRegionArea"]),
        )
        return CandidateOutput(self.candidate_id, proposal_rgb, labels)


class LabSpatialRegionGrowingCandidate:
    candidate_id = "CP-B"

    def propose(self, rgba: np.ndarray, config: dict[str, Any]) -> CandidateOutput:
        validate_rgba(rgba)
        # Deterministic Lab ΔE-grid proposals followed by 8-connected local component growth.
        rgb = rgba[..., :3]
        labels = local_component_labels(
            rgb_to_lab(rgb),
            rgba[..., 3] > 0,
            float(config["labDeltaECell"]),
            int(config["proposalMinRegionArea"]),
        )
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


def metrics_for_run(source_rgba: np.ndarray, label_map: np.ndarray, purified_rgba: np.ndarray, config: dict[str, Any]) -> dict[str, Any]:
    active = source_rgba[..., 3] > 0
    before = local_component_labels(
        rgb_to_lab(source_rgba[..., :3]),
        active,
        float(config["strongEdgeDeltaE"]),
        int(config["proposalMinRegionArea"]),
    )
    source_lab = rgb_to_lab(source_rgba[..., :3])
    output_lab = rgb_to_lab(purified_rgba[..., :3])
    after_variances = []
    before_variances = []
    for region_id in np.unique(label_map[active]):
        region = label_map == region_id
        before_variances.append(float(np.mean(np.var(source_lab[region], axis=0))))
        after_variances.append(float(np.mean(np.var(output_lab[region], axis=0))))
    small_limit = int(config["smallRegionArea"])
    return {
        "region_count_before": int(np.max(before)),
        "region_count_after": int(np.max(label_map)),
        "small_component_count_before": int(sum(np.count_nonzero(before == label) < small_limit for label in np.unique(before[before > 0]))),
        "small_component_count_after": int(sum(np.count_nonzero(label_map == label) < small_limit for label in np.unique(label_map[label_map > 0]))),
        "within_region_color_variance_before": round(float(np.mean(before_variances)) if before_variances else 0.0, 8),
        "within_region_color_variance_after": round(float(np.mean(after_variances)) if after_variances else 0.0, 8),
        "boundary_shift": round(boundary_shift(label_map, source_rgba, float(config["strongEdgeDeltaE"])), 8),
        "false_merge_count": None,
        "false_split_count": None,
        "manual_quality_grade": "PENDING_MANUAL_REVIEW",
        "small_region_strategy": config["smallRegionStrategy"],
        "boundary_shift_definition": "normalized symmetric Chamfer-like distance between internal candidate label boundaries and original Lab strong-color edges",
    }
