"""Generate Gate-2 evidence only. It never writes B1 outputs or applies merges."""
from __future__ import annotations
import argparse, gzip, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; sys.path[:0]=[str(ROOT / "region-core" / "src"),str(ROOT / "candidates" / "color-purification" / "src")]
from region_core import load_json, relation_anchor_labels, write_json  # noqa:E402
from region_repair import evaluate_edge, policy_definitions, rag_evidence  # noqa:E402

def _regions(path: Path) -> dict[int,list[float]]:
    with gzip.open(path,"rt",encoding="utf-8") as handle: records=json.load(handle)
    return {int(item["regionId"]):item["representativeColorLab"] for item in records}
def _relation_vetoes(labels: np.ndarray, relation: dict) -> dict[tuple[int,int],list[str]]:
    anchor=relation_anchor_labels(labels,relation); result={}
    for item in relation["relations"]:
        if item["type"] not in {"MUST_SEPARATE","PROTECTED_BOUNDARY","HOLE"}: continue
        groups=[anchor[key] for key in item["regionKeys"]]
        if len(groups)==2:
            for first in groups[0]:
                for second in groups[1]: result.setdefault(tuple(sorted((first,second))),[]).append(item["type"])
    return result
def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("--profile",default="cp-b-aggressive_rc-a"); parser.add_argument("--comparison-profile",default="cp-b-balanced_rc-a"); args=parser.parse_args()
    manifest=load_json(ROOT / "region-core" / "manifest.v1.json"); all_edges=[]; by_case={}
    for fixture in manifest["fixtures"]:
        case=fixture["fixtureId"]
        if fixture["kind"] == "project_real":
            current=ROOT / "outputs" / "color-purification" / args.profile / case; other=ROOT / "outputs" / "color-purification" / args.comparison_profile / case
        else:
            current=ROOT / "region-core" / "outputs" / "synthetic" / args.profile / case; other=ROOT / "region-core" / "outputs" / "synthetic" / args.comparison_profile / case
        if not current.is_dir() or not other.is_dir(): continue
        structural=np.load(current / "structural_label_map.npz")["labels"]; comparison=np.load(other / "structural_label_map.npz")["labels"]
        with Image.open((ROOT / "region-core" / fixture["source"]).resolve()) as image: rgba=np.asarray(image.convert("RGBA"))
        edges=rag_evidence(structural,rgba,_regions(current / "regions.json.gz"),comparison)
        by_case[case]={"labels":structural,"edges":edges,"kind":fixture["kind"]}; all_edges.extend(edges)
    policies=policy_definitions(); output={"status":"PENDING_EXTERNAL_GATE_2_REVIEW_V2","profile":args.profile,"comparisonProfile":args.comparison_profile,"representativeMethod":"RC-A","policies":policies,"cases":{},"edgeCount":len(all_edges)}
    for case,payload in by_case.items():
        relation_path=ROOT / "region-core" / "relation-ground-truth" / f"{case}.json"; relation=load_json(relation_path) if relation_path.is_file() else {"regions":[],"relations":[]}; anchors=relation_anchor_labels(payload["labels"],relation); vetoes=_relation_vetoes(payload["labels"],relation); rows=[]
        for edge in payload["edges"]:
            pair=tuple(sorted((edge["regionA"],edge["regionB"]))); relation_types=vetoes.get(pair,[])
            evaluations={name:evaluate_edge(edge,policy,relation_types) for name,policy in policies.items()}
            rows.append({**edge,"relationTypes":relation_types,"evaluations":evaluations,"decisions":{name:value["decision"] for name,value in evaluations.items()}})
        matrix=[]
        for item in relation["relations"]:
            sets=[anchors[key] for key in item["regionKeys"]]
            pairs=[tuple(sorted((left,right))) for left in sets[0] for right in sets[1] if left and right] if len(sets)==2 else []
            matching=[row for row in rows if tuple(sorted((row["regionA"],row["regionB"]))) in pairs]
            decisions={name: [row["decisions"][name] for row in matching] for name in policies}
            false_safe={name: item["type"] in {"MUST_SEPARATE","PROTECTED_BOUNDARY","HOLE"} and "SAFE_MERGE" in values for name,values in decisions.items()}
            false_preserve={name: item["type"]=="MUST_MERGE" and values and all(value!="SAFE_MERGE" for value in values) for name,values in decisions.items()}
            matrix.append({"relationId":item["relationId"],"type":item["type"],"regionPairs":pairs,"matchingEdgeCount":len(matching),"decisions":decisions,"falseSafeMerge":false_safe,"falsePreserve":false_preserve,"unmapped":not bool(pairs),"edgeEvidence":matching})
        output["cases"][case]={"kind":payload["kind"],"edges":rows,"relationMatrix":matrix}
    write_json(ROOT / "region-core" / "reports" / f"repair-evidence-v2-{args.profile}.json",output); print(json.dumps({"status":output["status"],"edgeCount":len(all_edges)},indent=2)); return 0
if __name__=="__main__": raise SystemExit(main())
