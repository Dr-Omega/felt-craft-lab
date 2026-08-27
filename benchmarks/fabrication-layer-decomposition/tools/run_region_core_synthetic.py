"""Run only the two Region Core synthetic CP-B fixtures with frozen RC-A."""
from __future__ import annotations
import gzip
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "candidates" / "color-purification" / "src"))
from color_purification import apply_representatives, get_candidate  # noqa: E402

CASES = ("RCF-001", "RCF-002")
PROFILES = ("balanced", "aggressive")

def main() -> int:
    configs = json.loads((ROOT / "candidates" / "color-purification" / "configs" / "profiles.json").read_text(encoding="utf-8"))
    for case in CASES:
        with Image.open(ROOT / "region-core" / "fixtures" / "synthetic" / f"{case}.png") as image:
            rgba = np.asarray(image.convert("RGBA"))
        for profile in PROFILES:
            proposal = get_candidate("CP-B").propose(rgba, configs[profile])
            purified, regions = apply_representatives(rgba, proposal.structural_label_map, "RC-A", configs[profile], proposal.pixel_label_map)
            output = ROOT / "region-core" / "outputs" / "synthetic" / f"cp-b-{profile}_rc-a" / case
            output.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(output / "structural_label_map.npz", labels=proposal.structural_label_map)
            np.savez_compressed(output / "pixel_label_map.npz", labels=proposal.pixel_label_map)
            Image.fromarray(purified, mode="RGBA").save(output / "purified.png", format="PNG")
            with gzip.open(output / "regions.json.gz", "wt", encoding="utf-8") as handle:
                json.dump(regions, handle, ensure_ascii=False, sort_keys=True)
            (output / "run_config.json").write_text(json.dumps({"fixtureId":case,"candidate":"CP-B","profile":profile,"representativeMethod":"RC-A","parameters":configs[profile]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Region Core synthetic CP-B runs: 2 cases x 2 profiles, RC-A")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
