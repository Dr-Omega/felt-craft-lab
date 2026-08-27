"""Apply an externally approved Region Repair policy; refuses implicit execution."""
from __future__ import annotations
import argparse, gzip, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; CP=ROOT / "candidates" / "color-purification" / "src"; RC=ROOT / "region-core" / "src"; sys.path[:0]=[str(CP),str(RC)]
from color_purification import representative_details, rgb_to_lab  # noqa:E402
from region_repair import apply_safe_merges  # noqa:E402
from region_core_contract import write_contract  # noqa:E402

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("--approved-policy", required=True); parser.add_argument("--approval-file", type=Path, required=True); parser.add_argument("--profile", required=True); parser.add_argument("--case", required=True); parser.add_argument("--representative", required=True); args=parser.parse_args()
    approval=json.loads(args.approval_file.read_text(encoding="utf-8"))
    if approval.get("approvedPolicy") != args.approved_policy or approval.get("gate2Status") != "APPROVED_EXTERNAL_REVIEW": raise SystemExit("refusing apply: explicit external Gate 2 approval is required")
    case_dir=ROOT / "outputs" / "color-purification" / args.profile / args.case
    structural=np.load(case_dir / "structural_label_map.npz")["labels"]; pixel=np.load(case_dir / "pixel_label_map.npz")["labels"]
    edges=[edge for edge in approval.get("edges",[]) if edge.get("decision")=="SAFE_MERGE"]
    appearance,lineage,audit=apply_safe_merges(structural,pixel,edges,{tuple(sorted(pair)) for pair in approval.get("prohibitedPairs",[])})
    with Image.open(ROOT / "fixtures" / "source" / f"{args.case}.png") as image: source=np.asarray(image.convert("RGBA"))
    profiles=json.loads((ROOT / "candidates" / "color-purification" / "configs" / "profiles.json").read_text(encoding="utf-8")); config=profiles[args.profile.split("_")[0].rsplit("-", 1)[1]]
    repaired=source.copy(); regions=[]; lab=rgb_to_lab(source[...,:3])
    for appearance_id, raw_ids in lineage.items():
        core=structural>0
        core &= np.isin(structural,raw_ids)
        detail=representative_details(source,core,args.representative,config); assigned=appearance==appearance_id; repaired[assigned,:3]=np.asarray(detail["representativeRgb"],dtype=np.uint8)
        ys,xs=np.where(core); regions.append({"appearanceRegionId":appearance_id,"rawSourceRegionIds":raw_ids,"structuralPixelCount":int(core.sum()),"assignedPixelCount":int(assigned.sum()),"bbox":[int(xs.min()),int(ys.min()),int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)],**detail})
    output=ROOT / "region-core" / "outputs" / "freeze-candidate" / args.profile / args.case
    write_contract(output,repaired,structural,pixel,appearance,regions,[],{"structuralAlphaThreshold":config["structuralAlphaThreshold"],"globalHolePreservation":"raw alpha immutable"},lineage,audit,args.profile,args.representative,args.approved_policy)
    return 0
if __name__=="__main__": raise SystemExit(main())
