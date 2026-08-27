"""Validate immutable B0 references and the additive Region Core sidecar."""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIDE = ROOT / "region-core"
sys.path.insert(0, str(SIDE / "src"))
from region_core import RegionCoreError, load_json, sha256, validate_relation_gt  # noqa: E402


def validate() -> None:
    manifest = load_json(SIDE / "manifest.v1.json")
    if manifest.get("b0FrozenCommit") != "7ab146b":
        raise RegionCoreError("sidecar must pin B0 frozen commit 7ab146b")
    for relative, expected in manifest.get("b0ContractSha256", {}).items():
        if sha256(ROOT / relative) != expected:
            raise RegionCoreError(f"B0 contract SHA changed: {relative}")
    fixture_ids: set[str] = set()
    for fixture in manifest["fixtures"]:
        fixture_id = fixture["fixtureId"]
        if fixture_id in fixture_ids:
            raise RegionCoreError("sidecar fixture IDs must be unique")
        fixture_ids.add(fixture_id)
        source = (SIDE / fixture["source"]).resolve()
        if not source.is_file():
            raise RegionCoreError(f"missing source {fixture_id}")
        if fixture.get("sourceSha256") and sha256(source) != fixture["sourceSha256"]:
            raise RegionCoreError(f"sidecar source SHA changed: {fixture_id}")
        if fixture["kind"] == "project_real":
            gt = (SIDE / fixture["groundTruth"]).resolve()
            if sha256(gt) != fixture["groundTruthSha256"]:
                raise RegionCoreError(f"B0 GT SHA changed: {fixture_id}")
        relation_path = SIDE / "relation-ground-truth" / f"{fixture_id}.json"
        if relation_path.is_file():
            with Image.open(source) as image:
                alpha = np.asarray(image.convert("RGBA"))[..., 3]
            relation = load_json(relation_path)
            if relation.get("fixtureId") != fixture_id:
                raise RegionCoreError("relation fixtureId mismatch")
            validate_relation_gt(relation, alpha)


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    validate(); print("Region Core sidecar validation: PASS"); return 0


if __name__ == "__main__":
    raise SystemExit(main())
