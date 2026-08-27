"""Gate-1 representative evaluation over frozen CP-B maps; never proposes labels."""

from __future__ import annotations
import hashlib
import time
from pathlib import Path
from typing import Any
import numpy as np
from skimage.color import deltaE_ciede2000

from color_purification import representative_details, rgb_to_lab
from region_core import write_json

METHODS = ("RC-A", "RC-B", "RC-C", "RC-D")


def _core_metrics(lab: np.ndarray, mask: np.ndarray, rep: np.ndarray) -> dict[str, float]:
    distances = deltaE_ciede2000(lab[mask], rep.reshape(1, 3))
    return {"mean": float(np.mean(distances)), "median": float(np.median(distances)), "p95": float(np.percentile(distances, 95))}


def _contaminate(rgba: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fixed row-major 5% contamination for reproducible robustness evidence."""
    altered = rgba.copy(); positions = np.flatnonzero(mask.ravel()); count = max(1, len(positions) // 20)
    chosen = positions[np.linspace(0, len(positions) - 1, count, dtype=np.int32)]
    altered[..., :3].reshape(-1, 3)[chosen] = np.array([255, 0, 255], dtype=np.uint8)
    return altered, chosen


def evaluate_case(rgba: np.ndarray, structural: np.ndarray, config: dict[str, Any]) -> dict[str, Any]:
    """Evaluate fixed maps; this module intentionally contains no Candidate.propose call."""
    lab = rgb_to_lab(rgba[..., :3]); records: list[dict[str, Any]] = []
    region_ids = [int(value) for value in np.unique(structural) if value > 0]
    sentinel = max(region_ids, key=lambda value: int(np.count_nonzero(structural == value)))
    for region_id in region_ids:
        mask = structural == region_id
        for method in METHODS:
            started = time.perf_counter(); selected = representative_details(rgba, mask, method, config, lab); rep = np.asarray(selected["representativeLab"], dtype=np.float32)
            determinism = None
            if region_id == sentinel:
                runs = [representative_details(rgba, mask, method, config, lab) for _ in range(3)]
                determinism = len({str(item) for item in runs}) == 1
            contaminated_rgba, changed = _contaminate(rgba, mask)
            contaminated_lab = lab.copy()
            contaminated_lab.reshape(-1, 3)[changed] = rgb_to_lab(np.full((1, len(changed), 3), [255, 0, 255], dtype=np.uint8)).reshape(-1, 3)
            contaminated = representative_details(contaminated_rgba, mask, method, config, contaminated_lab)
            drift = float(deltaE_ciede2000(rep.reshape(1, 3), np.asarray(contaminated["representativeLab"], dtype=np.float32).reshape(1, 3))[0])
            records.append({"regionId": region_id, "method": method, "coreDistance": _core_metrics(lab, mask, rep), "contaminationDrift": drift, "byteIdenticalDeterminism": determinism, "runtimeMs": round((time.perf_counter() - started) * 1000, 4), **selected})
    return {"regions": records, "determinismScope": "three real evaluations of the largest structural region per method"}


def write_case_report(output: Path, case_id: str, result: dict[str, Any]) -> None:
    write_json(output / f"{case_id}.json", {"caseId": case_id, **result})


def artifact_digest(value: Any) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()
