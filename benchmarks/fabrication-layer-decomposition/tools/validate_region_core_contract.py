"""Fail closed if a Region Core freeze-candidate artifact is incomplete or altered."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / "region-core" / "src"))
from region_core import sha256  # noqa:E402
FORBIDDEN={"colorGroupId","materialPalette","materialGroup","piece","layer","stacking","vectorPath"}
def validate(root: Path) -> None:
    for contract_file in root.rglob("region-core.json"):
        data=json.loads(contract_file.read_text(encoding="utf-8")); artifacts=data["artifactSha256"]
        for name, expected in artifacts.items():
            if sha256(contract_file.parent / name) != expected: raise ValueError(f"artifact SHA mismatch: {name}")
        if any(key in data for key in FORBIDDEN): raise ValueError("forbidden B2/material contract field")
def main() -> int:
    args=argparse.ArgumentParser(); args.add_argument("--root", default=str(ROOT / "region-core" / "outputs")); parsed=args.parse_args(); validate(Path(parsed.root)); print("Region Core contract validation: PASS"); return 0
if __name__=="__main__": raise SystemExit(main())
