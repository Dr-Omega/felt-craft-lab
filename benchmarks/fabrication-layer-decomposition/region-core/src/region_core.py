"""Sidecar-only Region Core IO, topology, and immutable-artifact helpers."""

from __future__ import annotations

from collections import deque
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np


class RegionCoreError(ValueError):
    pass


RELATION_TYPES = {"MUST_MERGE", "MUST_SEPARATE", "PROTECTED_BOUNDARY", "HOLE", "UNCERTAIN"}
REPOSITORY_TEXT_SUFFIXES = {".json", ".md", ".py", ".txt"}


def artifact_identity_mode(path: Path) -> str:
    """Return the frozen byte-identity contract for a repository artifact."""
    return "GIT_BLOB_CANONICAL_LF" if path.suffix.lower() in REPOSITORY_TEXT_SUFFIXES else "EXACT_BYTES"


def canonical_artifact_bytes(path: Path) -> bytes:
    """Return checkout-independent bytes for text and exact bytes for binary artifacts."""
    value = path.read_bytes()
    if artifact_identity_mode(path) == "GIT_BLOB_CANONICAL_LF":
        return value.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return value


def artifact_size(path: Path) -> int:
    return len(canonical_artifact_bytes(path))


def sha256(path: Path) -> str:
    return hashlib.sha256(canonical_artifact_bytes(path)).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def transparent_components(alpha: np.ndarray) -> list[dict[str, Any]]:
    """Return 4-connected transparent components; `isGlobalVoid` excludes exterior."""
    transparent = alpha == 0
    seen = np.zeros(transparent.shape, dtype=bool)
    height, width = transparent.shape
    result: list[dict[str, Any]] = []
    for y, x in zip(*np.where(transparent), strict=True):
        if seen[y, x]:
            continue
        queue = deque([(int(y), int(x))]); seen[y, x] = True; pixels: list[tuple[int, int]] = []
        touches_edge = False
        while queue:
            cy, cx = queue.popleft(); pixels.append((cy, cx))
            touches_edge |= cy in (0, height - 1) or cx in (0, width - 1)
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < height and 0 <= nx < width and transparent[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; queue.append((ny, nx))
        ys, xs = zip(*pixels, strict=True)
        result.append({"area": len(pixels), "bbox": [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1], "touchesCanvasEdge": touches_edge, "isGlobalVoid": not touches_edge, "pixels": pixels})
    return result


def validate_relation_gt(data: dict[str, Any], alpha: np.ndarray) -> None:
    keys = [entry.get("regionKey") for entry in data.get("regions", [])]
    if not keys or len(keys) != len(set(keys)):
        raise RegionCoreError("relation GT regionKey values must be present and unique")
    relations = data.get("relations", [])
    relation_ids = [entry.get("relationId") for entry in relations]
    if len(relation_ids) != len(set(relation_ids)):
        raise RegionCoreError("relation IDs must be unique")
    holes = transparent_components(alpha)
    for region in data["regions"]:
        if region["kind"] not in {"SUBJECT_REGION", "HOLE"}:
            raise RegionCoreError("unknown region kind")
        for x, y in region["anchors"]:
            if not (0 <= x < alpha.shape[1] and 0 <= y < alpha.shape[0]):
                raise RegionCoreError("relation anchor is outside source")
            if region["kind"] == "SUBJECT_REGION" and alpha[y, x] == 0:
                raise RegionCoreError("subject anchor must be opaque")
            if region["kind"] == "HOLE" and not any(item["isGlobalVoid"] and (y, x) in item["pixels"] for item in holes):
                raise RegionCoreError("HOLE anchor must be in an interior transparent component")
    for relation in relations:
        if relation["type"] not in RELATION_TYPES:
            raise RegionCoreError("unknown relation type")
        if any(key not in keys for key in relation["regionKeys"]):
            raise RegionCoreError("relation refers to an unknown region")
        if relation["type"] in {"MUST_MERGE", "MUST_SEPARATE", "PROTECTED_BOUNDARY"} and len(relation["regionKeys"]) != 2:
            raise RegionCoreError("pair relation must have exactly two region keys")


def relation_anchor_labels(labels: np.ndarray, relation_gt: dict[str, Any]) -> dict[str, set[int]]:
    result: dict[str, set[int]] = {}
    for region in relation_gt["regions"]:
        result[region["regionKey"]] = {int(labels[y, x]) for x, y in region["anchors"] if labels[y, x] > 0}
    return result
