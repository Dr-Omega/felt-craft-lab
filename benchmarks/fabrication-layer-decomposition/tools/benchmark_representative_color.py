"""Run Gate-1 RC evidence on existing CP-B maps without regenerating proposals."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from skimage.color import deltaE_ciede2000
ROOT=Path(__file__).resolve().parents[1]; sys.path[:0]=[str(ROOT / "region-core" / "src"),str(ROOT / "candidates" / "color-purification" / "src")]
from representative_benchmark import evaluate_case, write_case_report  # noqa:E402
from region_core import load_json, relation_anchor_labels, write_json  # noqa:E402

def _attach_relation_distances(result: dict, labels: np.ndarray, relation: dict) -> None:
    anchors=relation_anchor_labels(labels,relation); representatives={(item["method"],item["regionId"]):np.asarray(item["representativeLab"],dtype=np.float32) for item in result["regions"]}; distances=[]
    for item in relation.get("relations",[]):
        if len(item["regionKeys"]) != 2: continue
        first,second=(anchors[key] for key in item["regionKeys"])
        for method in ("RC-A","RC-B","RC-C","RC-D"):
            pairs=[float(deltaE_ciede2000(representatives[(method,left)].reshape(1,3),representatives[(method,right)].reshape(1,3))[0]) for left in first for right in second if (method,left) in representatives and (method,right) in representatives]
            distances.append({"relationId":item["relationId"],"type":item["type"],"method":method,"distance":min(pairs) if pairs else None,"mappingStatus":"MAPPED" if pairs else "UNMAPPED"})
    result["relationPairDistances"]=distances

def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("--profile",default="cp-b-aggressive_rc-a"); parser.add_argument("--finalize-existing",action="store_true"); args=parser.parse_args()
    profile=args.profile.split("_")[0].rsplit("-", 1)[1]; configs=load_json(ROOT / "candidates" / "color-purification" / "configs" / "profiles.json"); manifest=load_json(ROOT / "region-core" / "manifest.v1.json"); out=ROOT / "region-core" / "reports" / "representative-color" / args.profile; cases=[]
    for fixture in manifest["fixtures"]:
        if fixture["kind"] != "project_real": continue
        case=fixture["fixtureId"]; path=ROOT / "outputs" / "color-purification" / args.profile / case
        if not path.is_dir(): continue
        labels=np.load(path / "structural_label_map.npz")["labels"]
        target=out / "case-metrics" / f"{case}.json"
        if args.finalize_existing:
            result=load_json(target)
            result.pop("caseId",None)
        else:
            with Image.open(ROOT / "fixtures" / "source" / f"{case}.png") as image: rgba=np.asarray(image.convert("RGBA"))
            result=evaluate_case(rgba,labels,configs[profile])
        relation_path=ROOT / "region-core" / "relation-ground-truth" / f"{case}.json"
        if relation_path.is_file(): _attach_relation_distances(result,labels,load_json(relation_path))
        write_case_report(out / "case-metrics",case,result); cases.append({"caseId":case,"regionCount":len(result["regions"] )//4})
    aggregate={"status":"PENDING_EXTERNAL_GATE_1_REVIEW","profile":args.profile,"cases":cases,"methods":["RC-A","RC-B","RC-C","RC-D"],"note":"No Production representative method has been selected."}; write_json(out / "aggregate.json",aggregate); (out / "summary.md").write_text("# Representative Color Gate 1\n\nStatus: `PENDING_EXTERNAL_GATE_1_REVIEW`. Inspect case-metrics before selecting a method.\n",encoding="utf-8"); print(json.dumps(aggregate,indent=2)); return 0
if __name__=="__main__": raise SystemExit(main())
