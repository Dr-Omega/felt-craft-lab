"""Gate-2 RAG evidence and deterministic, high-precision SAFE_MERGE apply."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any
import cv2
import numpy as np
from skimage.color import deltaE_ciede2000
from color_purification import _adjacency_graph, rgb_to_lab

POLICIES_V2: dict[str, dict[str, Any]] = {
    "STRICT": {
        "derivation": "semantic evidence-separation policy; no GT grid search",
        "coherent": {"representativeDeltaEMax": 14.0, "sourceBoundaryP90Max": 2.0, "persistenceMax": 0.10, "sharedBoundaryCoverageMin": 0.25},
        "tiny": {"representativeDeltaEMax": 8.0, "sourceBoundaryP90Max": 4.0, "persistenceMax": 0.25, "sharedBoundaryCoverageMin": 0.05, "areaRatioMax": 0.02, "smallerAreaMax": 16},
    },
    "CONSERVATIVE": {
        "derivation": "semantic evidence-separation policy; no GT grid search",
        "coherent": {"representativeDeltaEMax": 16.0, "sourceBoundaryP90Max": 3.0, "persistenceMax": 0.25, "sharedBoundaryCoverageMin": 0.20},
        "tiny": {"representativeDeltaEMax": 12.0, "sourceBoundaryP90Max": 6.0, "persistenceMax": 0.50, "sharedBoundaryCoverageMin": 0.03, "areaRatioMax": 0.04, "smallerAreaMax": 64},
    },
    "MODERATE": {
        "derivation": "semantic evidence-separation policy; no GT grid search",
        "coherent": {"representativeDeltaEMax": 18.0, "sourceBoundaryP90Max": 5.0, "persistenceMax": 0.50, "sharedBoundaryCoverageMin": 0.15},
        "tiny": {"representativeDeltaEMax": 16.0, "sourceBoundaryP90Max": 10.0, "persistenceMax": 0.75, "sharedBoundaryCoverageMin": 0.01, "areaRatioMax": 0.08, "smallerAreaMax": 256},
    },
}

def _boundary_samples(labels: np.ndarray, lab: np.ndarray, first: int, second: int) -> np.ndarray:
    values: list[float] = []
    for left, right, l_lab, r_lab in ((labels[:, :-1], labels[:, 1:], lab[:, :-1], lab[:, 1:]), (labels[:-1, :], labels[1:, :], lab[:-1, :], lab[1:, :])):
        mask = ((left == first) & (right == second)) | ((left == second) & (right == first))
        if np.any(mask): values.extend(deltaE_ciede2000(l_lab[mask], r_lab[mask]).astype(float).tolist())
    return np.asarray(values, dtype=np.float32)


def _boundary_mask(labels: np.ndarray) -> np.ndarray:
    result = np.zeros(labels.shape, dtype=bool)
    horizontal = (labels[:, :-1] > 0) & (labels[:, 1:] > 0) & (labels[:, :-1] != labels[:, 1:])
    vertical = (labels[:-1, :] > 0) & (labels[1:, :] > 0) & (labels[:-1, :] != labels[1:, :])
    result[:, :-1] |= horizontal; result[:, 1:] |= horizontal; result[:-1, :] |= vertical; result[1:, :] |= vertical
    return result


def _pair_boundary_mask(labels: np.ndarray, first: int, second: int) -> np.ndarray:
    """Pixel support for unique 4-connected grid edges shared by one label pair."""
    result = np.zeros(labels.shape, dtype=bool)
    horizontal = ((labels[:, :-1] == first) & (labels[:, 1:] == second)) | ((labels[:, :-1] == second) & (labels[:, 1:] == first))
    vertical = ((labels[:-1, :] == first) & (labels[1:, :] == second)) | ((labels[:-1, :] == second) & (labels[1:, :] == first))
    result[:, :-1] |= horizontal; result[:, 1:] |= horizontal
    result[:-1, :] |= vertical; result[1:, :] |= vertical
    return result


def region_perimeter_edge_counts(labels: np.ndarray) -> np.ndarray:
    """Count exposed 4-connected grid edges per positive region label."""
    result = np.zeros(int(labels.max()) + 1, dtype=np.int64)
    padded = np.pad(labels, 1, mode="constant")
    center = padded[1:-1, 1:-1]
    for region_id in range(1, len(result)):
        mask = center == region_id
        result[region_id] = sum(int(np.count_nonzero(mask & (neighbor != region_id))) for neighbor in (padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:]))
    return result


def shared_boundary_coverage(shared_edge_count: int, perimeter_a: int, perimeter_b: int) -> float:
    """Unique shared grid edges / smaller 4-connected perimeter, always [0, 1]."""
    coverage = float(shared_edge_count / max(1, min(perimeter_a, perimeter_b)))
    if not 0.0 <= coverage <= 1.0 + 1e-12:
        raise ValueError("sharedBoundaryCoverage invariant violated")
    return min(1.0, coverage)


def _regions_touching_global_void(alpha: np.ndarray, labels: np.ndarray) -> set[int]:
    """Return structural labels bordering transparent components not touching canvas."""
    transparent = (alpha == 0).astype(np.uint8)
    component_count, components = cv2.connectedComponents(transparent, connectivity=4)
    touching: set[int] = set()
    cross = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    for component_id in range(1, component_count):
        component = components == component_id
        if np.any(component[0]) or np.any(component[-1]) or np.any(component[:, 0]) or np.any(component[:, -1]):
            continue
        border = cv2.dilate(component.astype(np.uint8), cross, iterations=1).astype(bool) & ~component
        touching.update(int(value) for value in np.unique(labels[border]) if value > 0)
    return touching


def boundary_persistence(labels: np.ndarray, comparison: np.ndarray, first: int | None = None, second: int | None = None) -> dict[str, float]:
    current = _boundary_mask(labels) if first is None or second is None else _pair_boundary_mask(labels, first, second)
    other = _boundary_mask(comparison)
    if not np.any(current): return {"exact": 1.0, "tolerance1px": 1.0}
    padded = np.pad(other, 1); dilated = np.zeros_like(other)
    for dy in range(3):
        for dx in range(3): dilated |= padded[dy:dy + other.shape[0], dx:dx + other.shape[1]]
    return {"exact": float(np.mean(other[current])), "tolerance1px": float(np.mean(dilated[current]))}


def rag_evidence(labels: np.ndarray, rgba: np.ndarray, representative_labs: dict[int, list[float]], comparison_labels: np.ndarray | None = None) -> list[dict[str, Any]]:
    lab = rgb_to_lab(rgba[..., :3]); graph = _adjacency_graph(labels); areas = np.bincount(labels.ravel(), minlength=int(labels.max()) + 1); perimeters = region_perimeter_edge_counts(labels); void_labels = _regions_touching_global_void(rgba[..., 3], labels)
    edges = []
    for (first, second), shared in sorted(graph.items()):
        values = _boundary_samples(labels, lab, first, second); first_lab, second_lab = np.asarray(representative_labs[first]), np.asarray(representative_labs[second])
        persistence = boundary_persistence(labels, comparison_labels, first, second) if comparison_labels is not None else {"exact": None, "tolerance1px": None}
        edges.append({"regionA": first, "regionB": second, "sharedBoundaryEdgeCount": shared, "regionAPerimeterEdgeCount": int(perimeters[first]), "regionBPerimeterEdgeCount": int(perimeters[second]), "sharedBoundaryCoverage": shared_boundary_coverage(shared, int(perimeters[first]), int(perimeters[second])), "representativeDeltaE": float(deltaE_ciede2000(first_lab.reshape(1, 3), second_lab.reshape(1, 3))[0]), "sourceBoundaryDeltaE": {"mean": float(np.mean(values)), "median": float(np.median(values)), "p90": float(np.percentile(values, 90))}, "areaA": int(areas[first]), "areaB": int(areas[second]), "areaRatio": float(min(areas[first], areas[second]) / max(areas[first], areas[second])), "boundaryPersistence": persistence, "touchesGlobalVoid": first in void_labels or second in void_labels, "lineageAmbiguous": False})
    return edges


def policy_definitions() -> dict[str, dict[str, Any]]:
    """Return semantic V2 policies without consulting labeled relations or edge quantiles."""
    import copy
    return copy.deepcopy(POLICIES_V2)


def _route_checks(edge: dict[str, Any], thresholds: dict[str, Any], tiny: bool) -> dict[str, bool]:
    checks = {
        "nearRepresentativeColor": edge["representativeDeltaE"] <= thresholds["representativeDeltaEMax"],
        "weakOriginalBoundary": edge["sourceBoundaryDeltaE"]["p90"] <= thresholds["sourceBoundaryP90Max"],
        "lowBoundaryPersistence": (edge["boundaryPersistence"]["tolerance1px"] or 0.0) <= thresholds["persistenceMax"],
        "sufficientSharedBoundaryCoverage": edge["sharedBoundaryCoverage"] >= thresholds["sharedBoundaryCoverageMin"],
    }
    if tiny:
        checks["smallAreaRatio"] = edge["areaRatio"] <= thresholds["areaRatioMax"]
        checks["smallAbsoluteArea"] = min(edge["areaA"], edge["areaB"]) <= thresholds["smallerAreaMax"]
    return checks


def evaluate_edge(edge: dict[str, Any], policy: dict[str, Any], veto_reasons: list[str] | None = None) -> dict[str, Any]:
    vetoes = set(veto_reasons or [])
    if edge.get("lineageAmbiguous"):
        vetoes.add("AMBIGUOUS_LINEAGE")
    if edge.get("touchesGlobalVoid"):
        vetoes.add("TOPOLOGY_GLOBAL_VOID")
    coherent = _route_checks(edge, policy["coherent"], tiny=False)
    tiny = _route_checks(edge, policy["tiny"], tiny=True)
    routes = []
    if all(coherent.values()): routes.append("COHERENT_SPLIT_REPAIR")
    if all(tiny.values()): routes.append("TINY_FRAGMENT_REPAIR")
    if vetoes:
        decision = "PRESERVE"
    elif routes:
        decision = "SAFE_MERGE"
    else:
        decision = "UNCERTAIN"
    return {"decision": decision, "triggeredRoutes": routes, "vetoes": sorted(vetoes), "routeChecks": {"COHERENT_SPLIT_REPAIR": coherent, "TINY_FRAGMENT_REPAIR": tiny}}


def decide_edge(edge: dict[str, Any], policy: dict[str, Any], veto_reasons: list[str] | None = None) -> tuple[str, list[str]]:
    result = evaluate_edge(edge, policy, veto_reasons)
    return result["decision"], result["vetoes"]


@dataclass
class UnionFind:
    parent: dict[int, int]
    def find(self, value: int) -> int:
        if self.parent[value] != value: self.parent[value] = self.find(self.parent[value])
        return self.parent[value]
    def union(self, first: int, second: int) -> None:
        first, second = self.find(first), self.find(second)
        if first != second: self.parent[max(first, second)] = min(first, second)


def apply_safe_merges(structural: np.ndarray, pixel: np.ndarray, safe_edges: list[dict[str, Any]], prohibited_pairs: set[tuple[int, int]] | None = None) -> tuple[np.ndarray, dict[int, list[int]], list[dict[str, Any]]]:
    prohibited_pairs = prohibited_pairs or set(); ids = [int(value) for value in np.unique(structural) if value > 0]; union = UnionFind({value: value for value in ids}); audit = []
    for edge in sorted(safe_edges, key=lambda item: (item["representativeDeltaE"], item["sourceBoundaryDeltaE"]["p90"], -item["sharedBoundaryEdgeCount"], item["regionA"], item["regionB"])):
        first, second = union.find(edge["regionA"]), union.find(edge["regionB"])
        first_members = [value for value in ids if union.find(value) == first]
        second_members = [value for value in ids if union.find(value) == second]
        conflict = any(tuple(sorted((left, right))) in prohibited_pairs for left in first_members for right in second_members)
        if conflict: audit.append({**edge, "decision": "PRESERVE_BY_TRANSITIVE_VETO"})
        else: union.union(first, second); audit.append({**edge, "decision": "SAFE_MERGE_APPLIED"})
    groups: dict[int, list[int]] = {}
    for value in ids: groups.setdefault(union.find(value), []).append(value)
    ordered = sorted((sorted(values) for values in groups.values()), key=lambda values: values[0]); mapping = {raw: index + 1 for index, values in enumerate(ordered) for raw in values}
    appearance = np.zeros_like(structural)
    for raw, appearance_id in mapping.items(): appearance[structural == raw] = appearance_id
    appearance[pixel == -1] = -1
    return appearance, {index + 1: values for index, values in enumerate(ordered)}, audit
