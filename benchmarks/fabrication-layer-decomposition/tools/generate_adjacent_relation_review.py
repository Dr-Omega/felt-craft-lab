"""Generate human-review crops for selected project-real adjacent RAG edges."""
from __future__ import annotations
import gzip
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT / "region-core" / "src"),str(ROOT / "candidates" / "color-purification" / "src")]
from region_core import load_json, write_json  # noqa:E402
from region_repair import _pair_boundary_mask  # noqa:E402

PROFILES=("cp-b-balanced_rc-a","cp-b-aggressive_rc-a")

def main() -> int:
    output_root=ROOT / "region-core" / "reports" / "adjacent-relation-review"
    index={"status":"PENDING_HUMAN_RELATION_LABELS","semanticLabelsGenerated":False,"candidates":[]}
    lines=["# Adjacent Relation Review","","No semantic relation is assigned by this generator. Human reviewers may mark each entry `MUST_MERGE`, `PROTECTED_BOUNDARY / MUST_SEPARATE`, or `UNCERTAIN`.",""]
    for profile in PROFILES:
        evidence=load_json(ROOT / "region-core" / "reports" / f"repair-evidence-v2-{profile}.json")
        for case,payload in sorted(evidence["cases"].items()):
            if payload["kind"] != "project_real" or not payload["edges"]: continue
            edges=payload["edges"]; selected: dict[tuple[int,int],set[str]]={}
            selectors=(("LOWEST_REPRESENTATIVE_DELTA_E",lambda edge:edge["representativeDeltaE"]),("WEAKEST_SOURCE_BOUNDARY",lambda edge:edge["sourceBoundaryDeltaE"]["p90"]),("LOWEST_BOUNDARY_PERSISTENCE",lambda edge:edge["boundaryPersistence"]["tolerance1px"] or 0.0))
            for reason,key in selectors:
                edge=min(edges,key=lambda item:(key(item),item["regionA"],item["regionB"])); selected.setdefault((edge["regionA"],edge["regionB"]),set()).add(reason)
            for edge in edges:
                if any(value["decision"]=="SAFE_MERGE" for value in edge["evaluations"].values()): selected.setdefault((edge["regionA"],edge["regionB"]),set()).add("SAFE_MERGE_CANDIDATE")
            case_dir=ROOT / "outputs" / "color-purification" / profile / case
            labels=np.load(case_dir / "structural_label_map.npz")["labels"]
            with Image.open(ROOT / "fixtures" / "source" / f"{case}.png") as image: source=np.asarray(image.convert("RGBA"))
            with gzip.open(case_dir / "regions.json.gz","rt",encoding="utf-8") as handle: regions={int(row["regionId"]):row for row in json.load(handle)}
            lines += [f"## {case} — {profile}",""]
            by_pair={(edge["regionA"],edge["regionB"]):edge for edge in edges}
            for pair,reasons in sorted(selected.items()):
                edge=by_pair[pair]; mask=np.isin(labels,pair); ys,xs=np.where(mask); padding=12; x0=max(0,int(xs.min())-padding);x1=min(labels.shape[1],int(xs.max())+padding+1);y0=max(0,int(ys.min())-padding);y1=min(labels.shape[0],int(ys.max())+padding+1)
                crop=source[y0:y1,x0:x1].copy(); overlay=crop.copy(); boundary=_pair_boundary_mask(labels,pair[0],pair[1])[y0:y1,x0:x1]; overlay[boundary,:3]=[255,0,255];overlay[boundary,3]=255
                color_a=regions[pair[0]]["representativeColorRgb"];color_b=regions[pair[1]]["representativeColorRgb"]
                swatch_width=min(24,overlay.shape[1]//4);swatch_height=min(12,overlay.shape[0]//4);overlay[:swatch_height,:swatch_width,:3]=color_a;overlay[:swatch_height,:swatch_width,3]=255;overlay[:swatch_height,swatch_width:2*swatch_width,:3]=color_b;overlay[:swatch_height,swatch_width:2*swatch_width,3]=255
                relative=Path(profile)/case; target=output_root/relative;target.mkdir(parents=True,exist_ok=True);stem=f"edge-{pair[0]}-{pair[1]}";Image.fromarray(crop,"RGBA").save(target/f"{stem}-original.png");Image.fromarray(overlay,"RGBA").save(target/f"{stem}-boundary-overlay.png")
                record={"fixture":case,"profile":profile,"regionA":pair[0],"regionB":pair[1],"selectionReasons":sorted(reasons),"originalCrop":str((relative/f"{stem}-original.png").as_posix()),"boundaryOverlay":str((relative/f"{stem}-boundary-overlay.png").as_posix()),"representativeColorA":color_a,"representativeColorB":color_b,"representativeDeltaE00":edge["representativeDeltaE"],"sourceBoundaryEvidence":edge["sourceBoundaryDeltaE"],"boundaryPersistence":edge["boundaryPersistence"],"sharedBoundaryCoverage":edge["sharedBoundaryCoverage"],"areaRatio":edge["areaRatio"],"policyEvaluations":edge["evaluations"],"humanRelation":"PENDING"};index["candidates"].append(record)
                lines += [f"### Regions {pair[0]} / {pair[1]}",f"- Reasons: {', '.join(sorted(reasons))}",f"- Original crop: [{stem}-original]({record['originalCrop']})",f"- Boundary overlay: [{stem}-boundary-overlay]({record['boundaryOverlay']})",f"- Representative RGB: `{color_a}` / `{color_b}`; ΔE00 `{edge['representativeDeltaE']:.6f}`",f"- Source boundary mean/median/P90: `{edge['sourceBoundaryDeltaE']}`",f"- Persistence exact/1px: `{edge['boundaryPersistence']}`",f"- sharedBoundaryCoverage: `{edge['sharedBoundaryCoverage']:.6f}`; area ratio: `{edge['areaRatio']:.6f}`",f"- Human relation: `PENDING`",""]
    write_json(output_root / "ADJACENT_RELATION_REVIEW.json",index);(output_root / "ADJACENT_RELATION_REVIEW.md").write_text("\n".join(lines),encoding="utf-8");print(json.dumps({"candidateCount":len(index["candidates"]),"status":index["status"]},indent=2));return 0
if __name__=="__main__": raise SystemExit(main())
