"""Versioned Region Core contract writer; contains no B2/material semantics."""
from __future__ import annotations
import gzip
import json
from pathlib import Path
from typing import Any
import numpy as np
from PIL import Image
from region_core import sha256, write_json

CONTRACT_VERSION = "1.0.0-freeze-candidate"
PRODUCTION_REPRESENTATIVE_METHOD = "RC-A"
FORBIDDEN_FIELDS = {"colorGroupId", "materialPalette", "materialGroup", "piece", "layer", "stacking", "vectorPath"}


def _save_labels(path: Path, labels: np.ndarray) -> None:
    np.savez_compressed(path, labels=labels)


def write_contract(output: Path, source_rgba: np.ndarray, raw_structural: np.ndarray, raw_pixel: np.ndarray, appearance: np.ndarray, regions: list[dict[str, Any]], adjacency: list[dict[str, Any]], topology: dict[str, Any], lineage: dict[int, list[int]], audit: list[dict[str, Any]], profile: str, representative_method: str, policy_id: str) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    if representative_method != PRODUCTION_REPRESENTATIVE_METHOD: raise ValueError("Region Core Production representative method is frozen to RC-A; RC-B/C/D are benchmark-only")
    if any(field in region for region in regions for field in FORBIDDEN_FIELDS): raise ValueError("Region Core contract must not contain B2/material semantics")
    _save_labels(output / "raw_structural_label_map.npz", raw_structural)
    _save_labels(output / "raw_pixel_label_map.npz", raw_pixel)
    _save_labels(output / "appearance_label_map.npz", appearance)
    Image.fromarray(source_rgba, mode="RGBA").save(output / "repaired_purified.png", format="PNG")
    with gzip.open(output / "regions.json.gz", "wt", encoding="utf-8") as handle: json.dump(regions, handle, ensure_ascii=False, sort_keys=True)
    with gzip.open(output / "adjacency.json.gz", "wt", encoding="utf-8") as handle: json.dump(adjacency, handle, ensure_ascii=False, sort_keys=True)
    write_json(output / "topology.json", topology); write_json(output / "repair_apply_audit.json", audit)
    with gzip.open(output / "raw_to_appearance_lineage.json.gz", "wt", encoding="utf-8") as handle: json.dump({str(key): value for key, value in lineage.items()}, handle, sort_keys=True)
    artifacts = {path.name: sha256(path) for path in sorted(output.iterdir()) if path.is_file()}
    contract = {"contractVersion": CONTRACT_VERSION, "profile": profile, "representativeMethod": representative_method, "repairPolicy": policy_id, "freezeStatus": ["IMPLEMENTATION_COMPLETE", "FREEZE_CANDIDATE", "BLOCKED_DATA_G02_SHADOW"], "width": int(source_rgba.shape[1]), "height": int(source_rgba.shape[0]), "artifactSha256": artifacts}
    write_json(output / "region-core.json", contract)
    return contract
