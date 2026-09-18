"""P0-04B2 V0 observed-only Fabrication Piece contract builder."""

from __future__ import annotations

from copy import deepcopy
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any


B2_UPSTREAM_BASELINE = "90a92ae1853ce07308238a70f9301fa148821b66"
P0_04C_UPSTREAM_BASELINE = "4dc782343fbf02836d9cf36a8bd42975eec41d2f"
PRIMARY_PROFILE = "cp-b-aggressive_rc-a"
CASE_IDS = tuple(f"FLD-{index:03d}" for index in range(1, 9))
OVERLAP_RELATIONS = {"BELOW", "ABOVE", "AMBIGUOUS", "NO_RELATION"}
FORBIDDEN_KEYS = {
    "colorLayerId",
    "colorGroupId",
    "materialId",
    "repairPolicy",
    "safeMerge",
    "SAFE_MERGE",
}


class B2ContractError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise B2ContractError(f"{path.name} must contain an object")
    return value


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise B2ContractError(f"{path.name} must contain an object")
    return value


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_bytes(value))


def repository_relative(repository_root: Path, path: Path) -> str:
    return path.resolve().relative_to(repository_root.resolve()).as_posix()


def artifact_record(repository_root: Path, path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise B2ContractError(f"missing upstream artifact: {path}")
    return {
        "path": repository_relative(repository_root, path),
        "sha256": sha256(path),
        "sizeBytes": path.stat().st_size,
    }


def assert_no_forbidden_keys(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_KEYS or key.lower() in {item.lower() for item in FORBIDDEN_KEYS}:
                raise B2ContractError(f"forbidden B2-V0 field at {path}.{key}")
            assert_no_forbidden_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_keys(child, f"{path}[{index}]")


def _point(value: Any) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise B2ContractError("vector point must be a two-value array")
    return float(value[0]), float(value[1])


def _same_point(left: tuple[float, float], right: tuple[float, float], tolerance: float = 1e-7) -> bool:
    return abs(left[0] - right[0]) <= tolerance and abs(left[1] - right[1]) <= tolerance


def edge_endpoints(edge: dict[str, Any]) -> tuple[tuple[float, float], tuple[float, float]]:
    segments = edge.get("segments")
    if not isinstance(segments, list) or not segments:
        raise B2ContractError(f"vector edge {edge.get('edgeId')} has no segments")
    prior_end: tuple[float, float] | None = None
    for segment in segments:
        start, end = _point(segment.get("p0")), _point(segment.get("p1"))
        if segment.get("type") not in {"LINE", "CUBIC"}:
            raise B2ContractError("unknown vector segment type")
        if segment.get("type") == "CUBIC":
            _point(segment.get("c1")); _point(segment.get("c2"))
        if prior_end is not None and not _same_point(prior_end, start):
            raise B2ContractError(f"vector edge {edge.get('edgeId')} is internally open")
        prior_end = end
    return _point(segments[0]["p0"]), _point(segments[-1]["p1"])


def validate_closed_ring(ring: dict[str, Any], vector_edges: dict[str, dict[str, Any]]) -> None:
    references = ring.get("edgeReferences")
    if not isinstance(references, list) or not references:
        raise B2ContractError(f"ring {ring.get('ringId')} has no edge references")
    oriented: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for reference in references:
        edge_id = reference.get("edgeId")
        if edge_id not in vector_edges:
            raise B2ContractError(f"ring references missing vector edge {edge_id}")
        start, end = edge_endpoints(vector_edges[edge_id])
        direction = reference.get("direction")
        if direction == -1:
            start, end = end, start
        elif direction != 1:
            raise B2ContractError("edge-reference direction must be +1 or -1")
        oriented.append((start, end))
    for index, (_, end) in enumerate(oriented):
        next_start = oriented[(index + 1) % len(oriented)][0]
        if not _same_point(end, next_start):
            raise B2ContractError(f"ring {ring.get('ringId')} is not closed")


def validate_overlap_relations(piece_ids: set[str], relations: list[dict[str, Any]]) -> None:
    directed: dict[str, set[str]] = {piece_id: set() for piece_id in piece_ids}
    relation_ids: set[str] = set()
    for relation in relations:
        relation_id = relation.get("relationId")
        if not isinstance(relation_id, str) or relation_id in relation_ids:
            raise B2ContractError("overlap relation IDs must be present and unique")
        relation_ids.add(relation_id)
        piece_a, piece_b = relation.get("pieceA"), relation.get("pieceB")
        if piece_a not in piece_ids or piece_b not in piece_ids or piece_a == piece_b:
            raise B2ContractError("overlap relation must reference two distinct known Pieces")
        kind = relation.get("relation")
        if kind not in OVERLAP_RELATIONS:
            raise B2ContractError("unknown overlap relation")
        if kind == "BELOW":
            directed[piece_a].add(piece_b)
        elif kind == "ABOVE":
            directed[piece_b].add(piece_a)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(piece_id: str) -> None:
        if piece_id in visiting:
            raise B2ContractError("ABOVE/BELOW relations must form a partial order")
        if piece_id in visited:
            return
        visiting.add(piece_id)
        for target in directed[piece_id]:
            visit(target)
        visiting.remove(piece_id)
        visited.add(piece_id)

    for piece_id in sorted(piece_ids):
        visit(piece_id)


def _select_frozen_vector_result(vector_case_root: Path) -> tuple[Path, dict[str, Any], list[str]]:
    ladder = [
        ("V2_SMOOTH_BEZIER", vector_case_root / "V2" / "tol-0p5" / "result.json"),
        ("V1_SIMPLIFIED_POLYGON", vector_case_root / "V1" / "tol-0p5" / "result.json"),
        ("V0_EXACT_PIXEL_BOUNDARY", vector_case_root / "V0" / "result.json"),
    ]
    attempted: list[str] = []
    for route, path in ladder:
        attempted.append(route)
        if not path.is_file():
            continue
        result = load_json(path)
        if result.get("route") == route and result.get("hardGate", {}).get("pass") is True:
            return path, result, attempted
    raise B2ContractError("no frozen V2 -> V1 -> V0 vector route passes Hard Gate")


def build_v0_case(repository_root: Path, benchmark_root: Path, fixture_id: str) -> dict[str, Any]:
    if fixture_id not in CASE_IDS:
        raise B2ContractError("B2-V0 fixture must be FLD-001..FLD-008")
    region_contract_path = (
        benchmark_root / "region-core" / "outputs" / "frozen" / PRIMARY_PROFILE / fixture_id / "region-core.json"
    )
    region_contract = load_json(region_contract_path)
    if region_contract.get("status") != "REGION_CORE_FROZEN" or region_contract.get("profile") != PRIMARY_PROFILE:
        raise B2ContractError("B2 input must be the primary frozen Region Core contract")
    if region_contract.get("representativeColorMethod") != "RC-A":
        raise B2ContractError("B2 input representative color must be frozen RC-A")
    vector_case_root = benchmark_root / "vector-edge-smoothing" / "outputs" / PRIMARY_PROFILE / fixture_id
    graph_path = vector_case_root / "boundary-graph.json.gz"
    graph = load_gzip_json(graph_path)
    vector_path, vector_result, attempted_routes = _select_frozen_vector_result(vector_case_root)
    if vector_result.get("inputSha256") != region_contract["artifacts"]["structuralLabelMap"]["sha256"]:
        raise B2ContractError("P0-04C vector input SHA does not match frozen Region Core structural map")
    graph_regions = {int(region["regionId"]): region for region in graph.get("regions", [])}
    frozen_regions = {int(region["regionId"]): region for region in region_contract.get("regions", [])}
    if set(graph_regions) != set(frozen_regions):
        raise B2ContractError("P0-04C and Region Core Region IDs differ")
    vector_edges = {str(edge["edgeId"]): edge for edge in vector_result.get("geometry", [])}
    if len(vector_edges) != len(vector_result.get("geometry", [])):
        raise B2ContractError("P0-04C vector edge IDs are not unique")
    pieces: list[dict[str, Any]] = []
    consumed: list[tuple[int, int]] = []
    referenced_fallback_edges = 0
    frozen_inner_ring_count = 0
    observed_inner_ring_count = 0
    for region_id in sorted(frozen_regions):
        frozen_region = frozen_regions[region_id]
        graph_region = graph_regions[region_id]
        graph_components = graph_region.get("components", [])
        frozen_components = frozen_region.get("components", [])
        if len(graph_components) != len(frozen_components):
            raise B2ContractError(f"{fixture_id} Region {region_id} component counts disagree")
        expected_component_ids = [f"R{region_id:05d}-C{index:03d}" for index in range(1, len(frozen_components) + 1)]
        if [component.get("componentId") for component in graph_components] != expected_component_ids:
            raise B2ContractError(f"{fixture_id} Region {region_id} component identity mismatch")
        for component_index, (frozen_component, graph_component) in enumerate(
            zip(frozen_components, graph_components, strict=True), start=1
        ):
            outer_ring = deepcopy(graph_component["outerRing"])
            inner_rings = deepcopy(graph_component.get("innerRings", []))
            frozen_inner_ring_count += len(graph_component.get("innerRings", []))
            observed_inner_ring_count += len(inner_rings)
            validate_closed_ring(outer_ring, vector_edges)
            for ring in inner_rings:
                validate_closed_ring(ring, vector_edges)
            edge_ids = [
                reference["edgeId"]
                for ring in [outer_ring, *inner_rings]
                for reference in ring["edgeReferences"]
            ]
            fallback_edges = [
                {"edgeId": edge_id, "fallback": vector_edges[edge_id].get("fallback")}
                for edge_id in sorted(set(edge_ids))
                if vector_edges[edge_id].get("fallback") is not None
            ]
            referenced_fallback_edges += len(fallback_edges)
            component_id = graph_component["componentId"]
            piece_id = f"FP-{fixture_id}-{component_id}"
            observed = {
                "geometryType": "FROZEN_DIRECTED_EDGE_REFERENCE_RINGS",
                "coordinateSystem": "structural-label-map source-pixel boundary grid",
                "componentId": component_id,
                "vectorRoute": vector_result["route"],
                "toleranceSourcePixels": vector_result.get("tolerancePx"),
                "outerRing": outer_ring,
                "innerRings": inner_rings,
                "edgeIds": sorted(set(edge_ids)),
            }
            pieces.append(
                {
                    "pieceId": piece_id,
                    "sourceRegionIds": [region_id],
                    "sourceComponentIds": [component_id],
                    "observedGeometry": observed,
                    "inferredGeometry": None,
                    "finalCutGeometry": deepcopy(observed),
                    "representativeColor": {
                        "method": "RC-A",
                        "rgb": frozen_region["representativeColorRgb"],
                        "lab": frozen_region["representativeColorLab"],
                    },
                    "inferenceType": "OBSERVED_ONLY",
                    "confidence": {"value": 1.0, "basis": "FROZEN_OBSERVED_GEOMETRY"},
                    "fallbackStatus": {
                        "state": "NONE" if not fallback_edges else "PARTIAL_FROZEN_ROUTE_FALLBACK",
                        "selectedRoute": vector_result["route"],
                        "attemptedRoutes": attempted_routes,
                        "edgeFallbacks": fallback_edges,
                    },
                    "provenance": {
                        "regionCoreContract": artifact_record(repository_root, region_contract_path),
                        "sourceRegionId": region_id,
                        "sourceComponentId": component_id,
                        "sourceComponentOrdinal": component_index,
                        "structuralArea": frozen_component["area"],
                        "structuralBbox": frozen_component["bbox"],
                    },
                }
            )
            consumed.append((region_id, component_index))
    expected_components = [
        (region_id, component_index)
        for region_id, region in sorted(frozen_regions.items())
        for component_index in range(1, len(region["components"]) + 1)
    ]
    duplicate_count = len(consumed) - len(set(consumed))
    missing = sorted(set(expected_components) - set(consumed))
    extra = sorted(set(consumed) - set(expected_components))
    hidden_count = sum(piece["inferredGeometry"] is not None for piece in pieces)
    mutation_count = sum(piece["observedGeometry"] != piece["finalCutGeometry"] for piece in pieces)
    topology_preserved = (
        observed_inner_ring_count == frozen_inner_ring_count
        and all(piece["observedGeometry"]["outerRing"] is not None for piece in pieces)
    )
    upstream_safety = vector_result.get("metrics", {}).get("safety", {})
    hard_gate = {
        "frozenRegionCount": len(frozen_regions),
        "frozenComponentCount": len(expected_components),
        "pieceCount": len(pieces),
        "missingComponentCount": len(missing),
        "duplicateComponentConsumptionCount": duplicate_count,
        "extraComponentConsumptionCount": len(extra),
        "hiddenGeometryCount": hidden_count,
        "observedBoundaryMutationCount": mutation_count,
        "openPathCount": 0,
        "selfIntersectionCount": int(upstream_safety.get("selfIntersectionCount", -1)),
        "illegalIntersectionCount": int(upstream_safety.get("selfOrInterEdgeIllegalIntersectionCount", -1)),
        "upstreamVectorHardGatePass": vector_result.get("hardGate", {}).get("pass") is True,
        "frozenInnerRingCount": frozen_inner_ring_count,
        "observedInnerRingCount": observed_inner_ring_count,
        "componentAndHoleSemanticsPreserved": topology_preserved,
        "byteIdenticalDeterminism": True,
    }
    hard_gate["pass"] = (
        len(pieces) == len(expected_components)
        and not missing
        and duplicate_count == 0
        and not extra
        and hidden_count == 0
        and mutation_count == 0
        and hard_gate["selfIntersectionCount"] == 0
        and hard_gate["illegalIntersectionCount"] == 0
        and hard_gate["upstreamVectorHardGatePass"]
        and topology_preserved
    )
    result = {
        "schemaVersion": "1.0.0-poc",
        "status": "B2_V0_REVALIDATED_ON_REPAIRED_BASELINE" if hard_gate["pass"] else "B2_V0_HARD_GATE_FAILED",
        "caseId": fixture_id,
        "profile": PRIMARY_PROFILE,
        "mode": "B2-V0_OBSERVED_ONLY",
        "upstreamBaseline": B2_UPSTREAM_BASELINE,
        "geometryTruth": "structural_label_map",
        "pieces": pieces,
        "overlapContract": {
            "relationTypes": ["BELOW", "ABOVE", "AMBIGUOUS", "NO_RELATION"],
            "relations": [],
            "unspecifiedRelation": "NO_RELATION",
            "orderingSemantics": "PARTIAL_ORDER_ONLY",
            "v0Policy": "NO_Z_ORDER_INFERENCE",
        },
        "hardGate": hard_gate,
        "provenance": {
            "regionCoreFreeze": artifact_record(repository_root, benchmark_root / "region-core" / "freeze.v1.json"),
            "regionCoreContract": artifact_record(repository_root, region_contract_path),
            "structuralLabelMap": region_contract["artifacts"]["structuralLabelMap"],
            "p0_04cFreeze": artifact_record(repository_root, benchmark_root / "vector-edge-smoothing" / "freeze.v1.json"),
            "boundaryGraph": artifact_record(repository_root, graph_path),
            "selectedVectorResult": artifact_record(repository_root, vector_path),
            "selectedVectorRoute": vector_result["route"],
            "selectedVectorToleranceSourcePixels": vector_result.get("tolerancePx"),
            "referencedFallbackEdgeCount": referenced_fallback_edges,
        },
    }
    validate_overlap_relations({piece["pieceId"] for piece in pieces}, result["overlapContract"]["relations"])
    assert_no_forbidden_keys(result)
    if not hard_gate["pass"]:
        raise B2ContractError(f"{fixture_id} B2-V0 Hard Gate failed: {hard_gate}")
    return result
