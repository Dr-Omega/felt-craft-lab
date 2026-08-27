"""Three-run RC-A determinism validation for every existing Region Core region."""
from __future__ import annotations
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT / "region-core" / "src"),str(ROOT / "candidates" / "color-purification" / "src")]
from color_purification import representative_details, rgb_to_lab  # noqa:E402
from region_core import load_json, write_json  # noqa:E402

def main() -> int:
    manifest=load_json(ROOT / "region-core" / "manifest.v1.json")
    configs=load_json(ROOT / "candidates" / "color-purification" / "configs" / "profiles.json")
    profiles=("cp-b-balanced_rc-a","cp-b-aggressive_rc-a")
    records=[]; mismatches=[]
    for fixture in manifest["fixtures"]:
        case=fixture["fixtureId"]
        with Image.open((ROOT / "region-core" / fixture["source"]).resolve()) as image: rgba=np.asarray(image.convert("RGBA"))
        source_lab=rgb_to_lab(rgba[...,:3])
        for profile in profiles:
            profile_name=profile.split("_")[0].rsplit("-",1)[1]
            if fixture["kind"] == "project_real": case_dir=ROOT / "outputs" / "color-purification" / profile / case
            else: case_dir=ROOT / "region-core" / "outputs" / "synthetic" / profile / case
            if not case_dir.is_dir(): continue
            labels=np.load(case_dir / "structural_label_map.npz")["labels"]
            checked=0
            for region_id in (int(value) for value in np.unique(labels) if value>0):
                mask=labels==region_id
                runs=[representative_details(rgba,mask,"RC-A",configs[profile_name],source_lab) for _ in range(3)]
                checked+=1
                if not runs[0]==runs[1]==runs[2]: mismatches.append({"fixtureId":case,"profile":profile,"regionId":region_id,"runs":runs})
            records.append({"fixtureId":case,"fixtureKind":fixture["kind"],"profile":profile,"regionCount":checked,"runCountPerRegion":3,"result":"PASS" if not any(item["fixtureId"]==case and item["profile"]==profile for item in mismatches) else "FAIL"})
    result={"representativeMethod":"RC-A","scope":"every existing project-real and synthetic structural region; no proposal rerun","status":"PASS" if not mismatches else "FAIL","evaluatedRegionCount":sum(row["regionCount"] for row in records),"records":records,"mismatches":mismatches}
    write_json(ROOT / "region-core" / "reports" / "representative-color" / "RC-A_FULL_DETERMINISM.json",result)
    print(json.dumps({"status":result["status"],"evaluatedRegionCount":result["evaluatedRegionCount"]},indent=2)); return 0 if not mismatches else 1
if __name__=="__main__": raise SystemExit(main())
