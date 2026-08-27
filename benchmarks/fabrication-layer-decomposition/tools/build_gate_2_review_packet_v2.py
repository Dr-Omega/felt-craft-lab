"""Consolidate existing V2 evidence; never runs proposal or repair apply."""
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REPORTS=ROOT / "region-core" / "reports"
PROFILES=("cp-b-balanced_rc-a","cp-b-aggressive_rc-a")
POLICIES=("STRICT","CONSERVATIVE","MODERATE")

packet={"packetVersion":"2.0.0","gate1":{"status":"APPROVED","productionRepresentative":"RC-A","benchmarkOnlyRepresentatives":["RC-B","RC-C","RC-D"],"fullDeterminismReport":"representative-color/RC-A_FULL_DETERMINISM.json"},"gate2":{"status":"PENDING_EXTERNAL_GATE_2_REVIEW_V2","representative":"RC-A","repairApply":"NOT_EXECUTED"},"sharedBoundaryMetric":{"oldField":"sharedBoundaryToSmallerPerimeter","oldDefinition":"unique shared 4-connected grid-edge count / smaller region AREA","reasonAboveOne":"a thin region can have more shared perimeter edges than pixels; the denominator was not a perimeter","replacementField":"sharedBoundaryCoverage","definition":"unique_shared_edge_count / min(regionA_perimeter_edge_count, regionB_perimeter_edge_count)","range":[0,1],"perimeterDefinition":"number of exposed 4-connected grid edges around a positive region","test":"region-core/tests/test_region_core.py::test_shared_boundary_coverage_uses_unique_edges_and_perimeters"},"policies":{},"profileAggregates":[],"relationPredictions":[],"syntheticEvidence":[],"safeMergeCandidates":[],"preserveCandidates":[],"falseSafeMerges":[],"gtMetrics":[],"adjacentRelationReview":{"status":"PENDING_HUMAN_RELATION_LABELS","markdown":"adjacent-relation-review/ADJACENT_RELATION_REVIEW.md","json":"adjacent-relation-review/ADJACENT_RELATION_REVIEW.json"},"state":["IMPLEMENTATION_COMPLETE","FREEZE_CANDIDATE","BLOCKED_DATA_G02_SHADOW"]}

for profile in PROFILES:
    data=json.loads((REPORTS / f"repair-evidence-v2-{profile}.json").read_text(encoding="utf-8"));packet["policies"]=data["policies"]
    all_edges=[(case,edge) for case,payload in data["cases"].items() for edge in payload["edges"]]
    for policy in POLICIES:
        decisions=[edge["decisions"][policy] for _,edge in all_edges]
        routes={route:sum(route in edge["evaluations"][policy]["triggeredRoutes"] for _,edge in all_edges) for route in ("COHERENT_SPLIT_REPAIR","TINY_FRAGMENT_REPAIR")}
        packet["profileAggregates"].append({"profile":profile,"policy":policy,"edgeCount":len(all_edges),"safeMergeCount":decisions.count("SAFE_MERGE"),"preserveCount":decisions.count("PRESERVE"),"uncertainCount":decisions.count("UNCERTAIN"),"routeTriggerCounts":routes})
    for case,payload in data["cases"].items():
        for relation in payload["relationMatrix"]:
            for policy in POLICIES:
                matching=relation["edgeEvidence"]
                record={"fixture":case,"fixtureKind":payload["kind"],"profile":profile,"policy":policy,"relationId":relation["relationId"],"relationType":relation["type"],"regionPairs":relation["regionPairs"],"matchingEdgeCount":relation["matchingEdgeCount"],"prediction":relation["decisions"][policy] or ["NOT_EVALUABLE_NON_ADJACENT"],"falseSafeMerge":relation["falseSafeMerge"][policy],"falsePreserve":relation["falsePreserve"][policy],"evidence":matching[0] if len(matching)==1 else "NOT_AVAILABLE: relation is not one direct RAG edge"}
                packet["relationPredictions"].append(record)
                if record["falseSafeMerge"]: packet["falseSafeMerges"].append(record)
        for edge in payload["edges"]:
            for policy in POLICIES:
                evaluation=edge["evaluations"][policy]
                record={"fixture":case,"fixtureKind":payload["kind"],"profile":profile,"policy":policy,"regionA":edge["regionA"],"regionB":edge["regionB"],"representativeDeltaE00":edge["representativeDeltaE"],"sourceBoundaryEvidence":edge["sourceBoundaryDeltaE"],"boundaryPersistence":edge["boundaryPersistence"],"sharedBoundaryCoverage":edge["sharedBoundaryCoverage"],"sharedBoundaryEdgeCount":edge["sharedBoundaryEdgeCount"],"perimeters":[edge["regionAPerimeterEdgeCount"],edge["regionBPerimeterEdgeCount"]],"areaRatio":edge["areaRatio"],"areas":[edge["areaA"],edge["areaB"]],"triggeredRoutes":evaluation["triggeredRoutes"],"routeChecks":evaluation["routeChecks"],"vetoes":evaluation["vetoes"],"decision":evaluation["decision"]}
                if evaluation["decision"]=="SAFE_MERGE": packet["safeMergeCandidates"].append(record)
                elif evaluation["decision"]=="PRESERVE": packet["preserveCandidates"].append(record)
    for policy in POLICIES:
        evaluable=[row for row in packet["relationPredictions"] if row["profile"]==profile and row["policy"]==policy and row["matchingEdgeCount"]==1]
        must_merge=[row for row in evaluable if row["relationType"]=="MUST_MERGE"]
        negative=[row for row in evaluable if row["relationType"] in {"MUST_SEPARATE","PROTECTED_BOUNDARY","HOLE"}]
        true_safe=sum("SAFE_MERGE" in row["prediction"] for row in must_merge); all_labeled_safe=sum("SAFE_MERGE" in row["prediction"] for row in evaluable)
        packet["gtMetrics"].append({"profile":profile,"policy":policy,"evaluableRelationCount":len(evaluable),"mustMergeTotal":len(must_merge),"mustMergeSafeMerge":true_safe,"mustMergeRecall":true_safe/len(must_merge) if must_merge else "NOT_AVAILABLE","negativeRelationTotal":len(negative),"falseSafeMergeCount":sum("SAFE_MERGE" in row["prediction"] for row in negative),"safeMergePrecisionOnEvaluableGT":true_safe/all_labeled_safe if all_labeled_safe else "NOT_AVAILABLE","scopeWarning":"Synthetic direct-edge GT only; project-real adjacent relation review remains pending."})
    for case in ("RCF-001","RCF-002"):
        relation=data["cases"][case]["relationMatrix"][0];edge=relation["edgeEvidence"][0]
        packet["syntheticEvidence"].append({"fixture":case,"profile":profile,"relationId":relation["relationId"],"relationType":relation["type"],"anchorRegionPairs":relation["regionPairs"],"directAdjacent":relation["matchingEdgeCount"]==1,"representativeDeltaE00":edge["representativeDeltaE"],"sourceBoundaryEvidence":edge["sourceBoundaryDeltaE"],"boundaryPersistence":edge["boundaryPersistence"],"sharedBoundaryCoverage":edge["sharedBoundaryCoverage"],"areaRatio":edge["areaRatio"],"policyEvaluations":edge["evaluations"]})

def table(headers,rows): return ["| "+" | ".join(headers)+" |","|"+"|".join(["---"]*len(headers))+"|"]+["| "+" | ".join(str(v) for v in row)+" |" for row in rows]
lines=["# Gate 2 Review Packet V2","","Status: `PENDING_EXTERNAL_GATE_2_REVIEW_V2`. Repair Apply remains `NOT_EXECUTED`.","","Gate 1 is `APPROVED`; Region Core Production representative is frozen to `RC-A`. RC-B/C/D remain benchmark-only.","","## Corrected shared-boundary metric","","`sharedBoundaryCoverage = unique_shared_edge_count / min(regionA_perimeter_edge_count, regionB_perimeter_edge_count)`. Perimeters count exposed four-connected grid edges. The value is enforced in `[0,1]`. The rejected V1 field divided by region area, which allowed values above one for thin regions.","","## Synthetic direct-edge evidence",""]
lines+=table(["Fixture","Profile","Relation","Direct","Rep ΔE00","Boundary mean/median/P90","Persistence exact/1px","Coverage","Area ratio"],[[x["fixture"],x["profile"],x["relationType"],x["directAdjacent"],round(x["representativeDeltaE00"],6),x["sourceBoundaryEvidence"],x["boundaryPersistence"],round(x["sharedBoundaryCoverage"],6),round(x["areaRatio"],6)] for x in packet["syntheticEvidence"]])
lines += ["","RCF-001 triggers `COHERENT_SPLIT_REPAIR` in all three policies for both profiles. RCF-002 is `PRESERVE` in all three policies because of the explicit `PROTECTED_BOUNDARY` veto.","","## Semantic policies",""]
lines += table(["Policy","COHERENT_SPLIT_REPAIR","TINY_FRAGMENT_REPAIR"],[[name,json.dumps(value["coherent"],ensure_ascii=False),json.dumps(value["tiny"],ensure_ascii=False)] for name,value in packet["policies"].items()])
lines += ["","SAFE_MERGE is the OR of the two routes after vetoes. Area ratio is absent from the coherent route and only participates in the tiny-fragment route.","","## Profile / policy aggregate",""]
lines += table(["Profile","Policy","Edges","SAFE","PRESERVE","UNCERTAIN","Route triggers"],[[x["profile"],x["policy"],x["edgeCount"],x["safeMergeCount"],x["preserveCount"],x["uncertainCount"],x["routeTriggerCounts"]] for x in packet["profileAggregates"]])
lines += ["","## Relation GT predictions",""]
lines += table(["Fixture","Kind","Profile","Policy","Relation","Type","Pairs","Edges","Prediction","False safe"],[[x["fixture"],x["fixtureKind"],x["profile"],x["policy"],x["relationId"],x["relationType"],x["regionPairs"],x["matchingEdgeCount"],x["prediction"],x["falseSafeMerge"]] for x in packet["relationPredictions"]])
lines += ["","## GT metrics",""]
lines += table(["Profile","Policy","Evaluable","MUST_MERGE","Recall","Negative","False safe","Precision"],[[x["profile"],x["policy"],x["evaluableRelationCount"],x["mustMergeTotal"],x["mustMergeRecall"],x["negativeRelationTotal"],x["falseSafeMergeCount"],x["safeMergePrecisionOnEvaluableGT"]] for x in packet["gtMetrics"]])
lines += ["","Metrics currently cover synthetic direct-edge GT only. They are not project-real precision/recall claims.","","## All SAFE_MERGE candidates",""]
lines += table(["Fixture","Kind","Profile","Policy","Regions","Route(s)","Rep ΔE","Boundary P90","Persistence","Coverage","Area ratio"],[[x["fixture"],x["fixtureKind"],x["profile"],x["policy"],f"{x['regionA']}/{x['regionB']}",x["triggeredRoutes"],round(x["representativeDeltaE00"],6),round(x["sourceBoundaryEvidence"]["p90"],6),x["boundaryPersistence"],round(x["sharedBoundaryCoverage"],6),round(x["areaRatio"],6)] for x in packet["safeMergeCandidates"]])
unique_preserve={}
for x in packet["preserveCandidates"]:
    key=(x["fixture"],x["profile"],x["regionA"],x["regionB"]);unique_preserve.setdefault(key,{"record":x,"policies":[]})["policies"].append(x["policy"])
lines += ["","## All PRESERVE candidates",""]
lines += table(["Fixture","Kind","Profile","Regions","Policies","Vetoes","Rep ΔE","Coverage"],[[v["record"]["fixture"],v["record"]["fixtureKind"],v["record"]["profile"],f"{v['record']['regionA']}/{v['record']['regionB']}",v["policies"],v["record"]["vetoes"],round(v["record"]["representativeDeltaE00"],6),round(v["record"]["sharedBoundaryCoverage"],6)] for v in unique_preserve.values()])
lines += ["","## False Safe Merge","",f"Count: `{len(packet['falseSafeMerges'])}`.","","## Adjacent project-real human review","",f"- Markdown: `{packet['adjacentRelationReview']['markdown']}`",f"- JSON: `{packet['adjacentRelationReview']['json']}`","- Status: `PENDING_HUMAN_RELATION_LABELS`; no semantic GT was generated automatically.","","## State","","- Gate 2: `PENDING_EXTERNAL_GATE_2_REVIEW_V2`","- Repair Apply: `NOT_EXECUTED`","- Region Core: `IMPLEMENTATION_COMPLETE` / `FREEZE_CANDIDATE` / `BLOCKED_DATA_G02_SHADOW`"]
(REPORTS / "GATE_2_REVIEW_PACKET_V2.json").write_text(json.dumps(packet,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
(REPORTS / "GATE_2_REVIEW_PACKET_V2.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
print(json.dumps({"status":packet["gate2"]["status"],"safeCandidates":len(packet["safeMergeCandidates"]),"preserveCandidates":len(packet["preserveCandidates"]),"falseSafeMerges":len(packet["falseSafeMerges"])},indent=2))
