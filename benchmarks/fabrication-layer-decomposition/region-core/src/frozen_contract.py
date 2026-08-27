"""Raw-only Region Core frozen contract derivation and validation helpers.

This module deliberately does not import the color-purification implementation.
It audits immutable CP-B/RC-A artifacts and derives additive 4-connected metadata.
"""

from __future__ import annotations

from collections import defaultdict, deque
import gzip
import json
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image

from region_core import RegionCoreError, sha256, write_json


CONTRACT_VERSION = "1.0.0"
PRIMARY_FROZEN_PROFILE = "cp-b-aggressive_rc-a"
BALANCED_REGRESSION_PROFILE = "cp-b-balanced_rc-a"
CASE_IDS = tuple(f"FLD-{index:03d}" for index in range(1, 9))
FORBIDDEN_FROZEN_KEYS = {
    "appearanceLabelMap",
    "appearance_label_map",
    "colorGroupId",
    "colorGroupStatus",
    "groupConfidence",
    "layer",
    "material",
    "mergedRegionIds",
    "piece",
    "repairAudit",
    "repairPolicy",
    "safeMerge",
    "SAFE_MERGE",
    "vector",
}


def load_npz_labels(path: Path) -> np.ndarray:
    with np.load(path, allow_pickle=False) as archive:
        if set(archive.files) != {"labels"}:
            raise RegionCoreError(f"{path.name} must contain only a labels array")
        labels = np.asarray(archive["labels"])
    if labels.ndim != 2 or labels.dtype.kind not in "iu":
        raise RegionCoreError(f"{path.name} labels must be a 2-D integer array")
    return labels.astype(np.int32, copy=False)


def load_legacy_regions(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, list):
        raise RegionCoreError("legacy regions artifact must contain an array")
    return value


def load_rgba(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        if image.mode != "RGBA":
            raise RegionCoreError(f"{path.name} must decode as RGBA")
        return np.asarray(image, dtype=np.uint8).copy()


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab[..., 0] *= 100.0 / 255.0
    lab[..., 1:] -= 128.0
    return lab


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    converted = np.asarray(lab, dtype=np.float32).copy()
    converted[..., 0] *= 255.0 / 100.0
    converted[..., 1:] += 128.0
    encoded = np.clip(np.rint(converted), 0, 255).astype(np.uint8)
    return cv2.cvtColor(encoded, cv2.COLOR_LAB2RGB)


def rc_a_representative(
    rgba: np.ndarray, region_mask: np.ndarray, config: dict[str, Any], source_lab: np.ndarray | None = None
) -> tuple[list[int], list[float], int]:
    """Recompute the frozen RC-A Lab median without importing mutable candidate code."""
    if region_mask.shape != rgba.shape[:2] or not np.any(region_mask):
        raise RegionCoreError("RC-A region mask must match the source and be non-empty")
    source_lab = rgb_to_lab(rgba[..., :3]) if source_lab is None else source_lab
    ys, xs = np.where(region_mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    local_mask = region_mask[y0:y1, x0:x1]
    local_alpha = rgba[y0:y1, x0:x1, 3]
    distance = cv2.distanceTransform(local_mask.astype(np.uint8), cv2.DIST_L2, 3)
    alpha_ok = local_alpha >= int(config["coreAlphaMin"])
    core = local_mask & alpha_ok & (distance >= float(config["coreDistancePx"]))
    if not np.any(core):
        core = local_mask & alpha_ok
    if not np.any(core):
        core = local_mask
    representative_lab = np.median(source_lab[y0:y1, x0:x1][core], axis=0).astype(np.float32)
    representative_rgb = lab_to_rgb(representative_lab.reshape(1, 1, 3))[0, 0]
    return (
        [int(channel) for channel in representative_rgb],
        [round(float(channel), 6) for channel in representative_lab],
        int(np.count_nonzero(core)),
    )


def four_connected_components(labels: np.ndarray) -> dict[int, list[dict[str, Any]]]:
    """Derive deterministic 4-connected components for every positive Region ID."""
    height, width = labels.shape
    seen = np.zeros(labels.shape, dtype=bool)
    components: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for y, x in zip(*np.where(labels > 0), strict=True):
        if seen[y, x]:
            continue
        region_id = int(labels[y, x])
        queue = deque([(int(y), int(x))])
        seen[y, x] = True
        area = 0
        min_x = max_x = int(x)
        min_y = max_y = int(y)
        while queue:
            current_y, current_x = queue.popleft()
            area += 1
            min_x, max_x = min(min_x, current_x), max(max_x, current_x)
            min_y, max_y = min(min_y, current_y), max(max_y, current_y)
            for delta_y, delta_x in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                next_y, next_x = current_y + delta_y, current_x + delta_x
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and not seen[next_y, next_x]
                    and int(labels[next_y, next_x]) == region_id
                ):
                    seen[next_y, next_x] = True
                    queue.append((next_y, next_x))
        component_id = len(components[region_id]) + 1
        components[region_id].append(
            {
                "componentId": component_id,
                "area": area,
                "bbox": [min_x, min_y, max_x - min_x + 1, max_y - min_y + 1],
            }
        )
    return dict(components)


def perimeter_and_adjacency(labels: np.ndarray) -> tuple[dict[int, int], list[dict[str, int]]]:
    """Count unique 4-neighbour grid edges and per-region perimeter grid edges."""
    region_ids = [int(value) for value in np.unique(labels) if value > 0]
    perimeter = {region_id: 0 for region_id in region_ids}
    shared: dict[tuple[int, int], int] = defaultdict(int)
    height, width = labels.shape
    for y in range(height):
        for x in range(width):
            current = int(labels[y, x])
            if current <= 0:
                continue
            for delta_y, delta_x in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                next_y, next_x = y + delta_y, x + delta_x
                if not (0 <= next_y < height and 0 <= next_x < width) or int(labels[next_y, next_x]) != current:
                    perimeter[current] += 1
            for delta_y, delta_x in ((1, 0), (0, 1)):
                next_y, next_x = y + delta_y, x + delta_x
                if 0 <= next_y < height and 0 <= next_x < width:
                    other = int(labels[next_y, next_x])
                    if other > 0 and other != current:
                        shared[tuple(sorted((current, other)))] += 1
    adjacency = [
        {
            "regionA": region_a,
            "regionB": region_b,
            "uniqueSharedEdgeCount": count,
            "sharedBoundaryCoverage": round(count / min(perimeter[region_a], perimeter[region_b]), 8),
        }
        for (region_a, region_b), count in sorted(shared.items())
    ]
    return perimeter, adjacency


def void_topology(alpha: np.ndarray) -> dict[str, Any]:
    """Summarize 4-connected transparent components without storing pixel coordinates."""
    transparent = alpha == 0
    seen = np.zeros(alpha.shape, dtype=bool)
    height, width = alpha.shape
    voids: list[dict[str, Any]] = []
    for y, x in zip(*np.where(transparent), strict=True):
        if seen[y, x]:
            continue
        queue = deque([(int(y), int(x))])
        seen[y, x] = True
        area = 0
        min_x = max_x = int(x)
        min_y = max_y = int(y)
        touches_edge = False
        while queue:
            current_y, current_x = queue.popleft()
            area += 1
            min_x, max_x = min(min_x, current_x), max(max_x, current_x)
            min_y, max_y = min(min_y, current_y), max(max_y, current_y)
            touches_edge |= current_y in (0, height - 1) or current_x in (0, width - 1)
            for delta_y, delta_x in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                next_y, next_x = current_y + delta_y, current_x + delta_x
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and transparent[next_y, next_x]
                    and not seen[next_y, next_x]
                ):
                    seen[next_y, next_x] = True
                    queue.append((next_y, next_x))
        voids.append(
            {
                "voidId": len(voids) + 1,
                "area": area,
                "bbox": [min_x, min_y, max_x - min_x + 1, max_y - min_y + 1],
                "touchesCanvasEdge": bool(touches_edge),
                "kind": "EXTERIOR_BACKGROUND" if touches_edge else "HOLE",
            }
        )
    return {
        "voidConnectivity": 4,
        "transparentComponentCount": len(voids),
        "holeCount": sum(item["kind"] == "HOLE" for item in voids),
        "voids": voids,
    }


def repository_relative(repository_root: Path, path: Path) -> str:
    return path.resolve().relative_to(repository_root.resolve()).as_posix()


def artifact_record(repository_root: Path, path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise RegionCoreError(f"missing frozen input artifact: {path}")
    return {"path": repository_relative(repository_root, path), "sha256": sha256(path), "sizeBytes": path.stat().st_size}


def assert_no_forbidden_keys(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_FROZEN_KEYS or key.lower() in {item.lower() for item in FORBIDDEN_FROZEN_KEYS}:
                raise RegionCoreError(f"forbidden frozen contract key at {path}.{key}")
            assert_no_forbidden_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_keys(child, f"{path}[{index}]")


def build_case_contract(
    repository_root: Path,
    benchmark_root: Path,
    profile: str,
    fixture_id: str,
    *,
    allow_regression_evidence: bool = False,
) -> dict[str, Any]:
    allowed_profile = profile == PRIMARY_FROZEN_PROFILE or (
        allow_regression_evidence and profile == BALANCED_REGRESSION_PROFILE
    )
    if not allowed_profile or fixture_id not in CASE_IDS:
        raise RegionCoreError("Contract audit requires an approved profile and FLD-001..FLD-008")
    case_dir = benchmark_root / "outputs" / "color-purification" / profile / fixture_id
    run_config_path = case_dir / "run_config.json"
    run_config = json.loads(run_config_path.read_text(encoding="utf-8"))
    if run_config.get("candidateId") != "CP-B" or run_config.get("representativeColorMethod") != "RC-A":
        raise RegionCoreError(f"{fixture_id} is not a CP-B/RC-A artifact")
    if f"cp-b-{run_config.get('configProfile')}_rc-a" != profile:
        raise RegionCoreError(f"{fixture_id} run profile does not match its frozen profile")
    source_path = benchmark_root / str(run_config["sourceFile"])
    structural_path = case_dir / "structural_label_map.npz"
    pixel_path = case_dir / "pixel_label_map.npz"
    regions_path = case_dir / "regions.json.gz"
    purified_path = case_dir / "purified.png"
    metrics_path = case_dir / "metrics.json"
    rgba = load_rgba(source_path)
    purified = load_rgba(purified_path)
    structural = load_npz_labels(structural_path)
    pixel_labels = load_npz_labels(pixel_path)
    if structural.shape != rgba.shape[:2] or pixel_labels.shape != structural.shape or purified.shape != rgba.shape:
        raise RegionCoreError(f"{fixture_id} artifact dimensions disagree")
    alpha = rgba[..., 3]
    structural_active = alpha >= int(run_config["parameters"]["structuralAlphaThreshold"])
    if np.any(structural[~structural_active] != 0) or np.any(structural[structural_active] <= 0):
        raise RegionCoreError(f"{fixture_id} structural map violates its alpha policy")
    if np.any(pixel_labels[alpha == 0] != 0) or np.any(pixel_labels[alpha > 0] == 0):
        raise RegionCoreError(f"{fixture_id} pixel map violates its alpha policy")
    if not np.array_equal(rgba[..., 3], purified[..., 3]):
        raise RegionCoreError(f"{fixture_id} purified alpha differs from source")
    region_ids = [int(value) for value in np.unique(structural) if value > 0]
    if region_ids != list(range(1, len(region_ids) + 1)):
        raise RegionCoreError(f"{fixture_id} Region IDs must be compact positive integers")
    legacy = load_legacy_regions(regions_path)
    legacy_by_id = {int(region["regionId"]): region for region in legacy}
    if sorted(legacy_by_id) != region_ids:
        raise RegionCoreError(f"{fixture_id} legacy regions do not match structural Region IDs")
    components = four_connected_components(structural)
    perimeter, adjacency = perimeter_and_adjacency(structural)
    source_lab = rgb_to_lab(rgba[..., :3])
    regions: list[dict[str, Any]] = []
    for region_id in region_ids:
        mask = structural == region_id
        ys, xs = np.where(mask)
        rgb, lab, core_count = rc_a_representative(rgba, mask, run_config["parameters"], source_lab)
        stored = legacy_by_id[region_id]
        if stored.get("representativeColorRgb") != rgb:
            raise RegionCoreError(f"{fixture_id} region {region_id} stored RGB differs from RC-A recomputation")
        stored_lab = np.asarray(stored.get("representativeColorLab"), dtype=np.float64)
        if stored_lab.shape != (3,) or not np.allclose(stored_lab, np.asarray(lab), rtol=0.0, atol=0.000001):
            raise RegionCoreError(f"{fixture_id} region {region_id} stored Lab differs from RC-A recomputation")
        if int(stored.get("corePixelCount", -1)) != core_count:
            raise RegionCoreError(f"{fixture_id} region {region_id} stored core count differs from RC-A recomputation")
        assigned = pixel_labels == region_id
        if np.any(purified[assigned, :3] != np.asarray(rgb, dtype=np.uint8)):
            raise RegionCoreError(f"{fixture_id} region {region_id} purified raster differs from RC-A")
        region_components = components[region_id]
        area = int(np.count_nonzero(mask))
        if sum(item["area"] for item in region_components) != area:
            raise RegionCoreError(f"{fixture_id} region {region_id} component areas do not cover the Region")
        regions.append(
            {
                "regionId": region_id,
                "area": area,
                "assignedPixelCount": int(np.count_nonzero(assigned)),
                "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
                "componentCount": len(region_components),
                "components": region_components,
                "perimeterEdgeCount": perimeter[region_id],
                "representativeColorMethod": "RC-A",
                "representativeColorRgb": rgb,
                "representativeColorLab": lab,
                "corePixelCount": core_count,
                "sourceRegionIds": [region_id],
            }
        )
    orphan_mask = pixel_labels == -1
    if np.any(purified[orphan_mask] != rgba[orphan_mask]):
        raise RegionCoreError(f"{fixture_id} orphan fringe pixels differ from source")
    artifacts = {
        "source": artifact_record(repository_root, source_path),
        "structuralLabelMap": artifact_record(repository_root, structural_path),
        "pixelLabelMap": artifact_record(repository_root, pixel_path),
        "legacyRegions": artifact_record(repository_root, regions_path),
        "purifiedRaster": artifact_record(repository_root, purified_path),
        "runConfig": artifact_record(repository_root, run_config_path),
        "metrics": artifact_record(repository_root, metrics_path),
    }
    contract = {
        "contractVersion": CONTRACT_VERSION,
        "status": "REGION_CORE_FROZEN" if profile == PRIMARY_FROZEN_PROFILE else "REGRESSION_EVIDENCE_ONLY",
        "fixtureId": fixture_id,
        "profile": profile,
        "candidateId": "CP-B",
        "representativeColorMethod": "RC-A",
        "productionIntegrationStatus": "NOT_INTEGRATED",
        "dimensions": {"width": int(structural.shape[1]), "height": int(structural.shape[0])},
        "connectivity": {
            "proposalConnectivity": 8,
            "componentConnectivity": 4,
            "adjacencyConnectivity": 4,
            "voidConnectivity": 4,
        },
        "regionIdSemantics": {
            "scope": "fixture-and-profile-local",
            "backgroundId": 0,
            "orphanFringeId": -1,
            "oneRegionMayContainMultipleFourConnectedComponents": True,
            "lineage": "identity-only; no repair or merged Region IDs",
        },
        "legacyMetadataDisposition": "LEGACY_COMPONENT_METADATA_SUPERSEDED",
        "artifacts": artifacts,
        "regions": regions,
        "adjacency": adjacency,
        "topology": void_topology(alpha),
        "provenance": {
            "artifactGenerationCommit": "c18eb15d23357794dd8178b1daae8bf6e0ac74b7",
            "candidateSourceGitBlob": "8945e305be3f0cb309d442da3f352321c7167175",
            "p0_04cUpstreamBaselineCommit": "4dc782343fbf02836d9cf36a8bd42975eec41d2f",
            "runConfigSha256": artifacts["runConfig"]["sha256"],
            "sourceSha256": artifacts["source"]["sha256"],
        },
    }
    assert_no_forbidden_keys(contract)
    return contract


def write_case_contract(path: Path, contract: dict[str, Any]) -> None:
    assert_no_forbidden_keys(contract)
    write_json(path, contract)


def iter_contract_artifact_records(contract: dict[str, Any]) -> Iterable[dict[str, Any]]:
    return contract["artifacts"].values()
