from __future__ import annotations
import sys
import unittest
import tempfile
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT / "tools"),str(ROOT / "region-core" / "src"),str(ROOT / "candidates" / "color-purification" / "src")]
from region_core import RegionCoreError, transparent_components, validate_relation_gt
from region_core_contract import write_contract
try:
    from color_purification import representative_details
    from generate_project_real_safe_merge_review import select_review_candidates
    from region_repair import apply_safe_merges, boundary_persistence, decide_edge, evaluate_edge, policy_definitions, rag_evidence, region_perimeter_edge_counts, shared_boundary_coverage
    COLOR_STACK_AVAILABLE = True
except ModuleNotFoundError:
    COLOR_STACK_AVAILABLE = False

CONFIG={"coreAlphaMin":1,"coreDistancePx":0,"histogramBinWidth":16,"densityRadius":12}

@unittest.skipUnless(COLOR_STACK_AVAILABLE, "OpenCV/scikit-image color stack is unavailable")
class RegionCoreTests(unittest.TestCase):
    def setUp(self):
        self.rgba=np.zeros((5,6,4),dtype=np.uint8); self.rgba[1:4,1:5]=[200,100,50,255]
        self.labels=np.zeros((5,6),dtype=np.int32); self.labels[1:4,1:3]=1; self.labels[1:4,3:5]=2
    def test_rc_d_is_deterministic_actual_core_pixel(self):
        first=representative_details(self.rgba,self.labels==1,"RC-D",CONFIG); second=representative_details(self.rgba,self.labels==1,"RC-D",CONFIG)
        self.assertEqual(first,second); self.assertEqual(first["representativeRgb"],[200,100,50]); self.assertFalse(first["approximateMedoid"])
    def test_boundary_persistence_self(self): self.assertEqual(boundary_persistence(self.labels,self.labels)["exact"],1.0)
    def test_rag_only_true_adjacency(self):
        edges=rag_evidence(self.labels,self.rgba,{1:[50,0,0],2:[51,0,0]},self.labels); self.assertEqual([(edge["regionA"],edge["regionB"]) for edge in edges],[(1,2)]); self.assertLessEqual(edges[0]["sharedBoundaryCoverage"],1.0)
    def test_shared_boundary_coverage_uses_unique_edges_and_perimeters(self):
        perimeters=region_perimeter_edge_counts(self.labels)
        self.assertEqual((int(perimeters[1]),int(perimeters[2])),(10,10))
        self.assertEqual(shared_boundary_coverage(3,int(perimeters[1]),int(perimeters[2])),0.3)
    def test_shared_boundary_coverage_rejects_ambiguous_over_one(self):
        with self.assertRaises(ValueError): shared_boundary_coverage(11,10,12)
    def test_policy_definitions_are_semantic_constants(self):
        policies=policy_definitions(); self.assertEqual(set(policies),{"STRICT","CONSERVATIVE","MODERATE"}); self.assertTrue(all(value["derivation"]=="semantic evidence-separation policy; no GT grid search" for value in policies.values()))
    def test_project_real_review_selects_all_safe_and_requested_near_misses(self):
        def edge(region_a,decision,delta_e):
            checks={"COHERENT_SPLIT_REPAIR":{"near":decision=="SAFE_MERGE","weak":True},"TINY_FRAGMENT_REPAIR":{"small":False,"near":True}}
            evaluation={"decision":decision,"triggeredRoutes":["COHERENT_SPLIT_REPAIR"] if decision=="SAFE_MERGE" else [],"routeChecks":checks,"vetoes":[]}
            return {"regionA":region_a,"regionB":region_a+1,"representativeDeltaE":delta_e,"sourceBoundaryDeltaE":{"p90":delta_e},"boundaryPersistence":{"tolerance1px":.1},"sharedBoundaryCoverage":.5,"evaluations":{name:evaluation for name in ("STRICT","CONSERVATIVE","MODERATE")}}
        records=[{"fixture":"FLD-001","profile":"cp-b-balanced_rc-a","edge":edge(1,"SAFE_MERGE",1.)}]
        records += [{"fixture":"FLD-002","profile":"cp-b-balanced_rc-a","edge":edge(index+10,"UNCERTAIN",float(index+2))} for index in range(10)]
        selected=select_review_candidates(records,near_miss_count=5)
        self.assertEqual(sum(row["selectionType"]=="SAFE_MERGE" for row in selected),3)
        self.assertEqual(sum(row["selectionType"]=="NEAR_MISS" for row in selected),5)
        self.assertTrue(all(row["fixture"].startswith("FLD-") for row in selected))
    def test_veto_cannot_be_safe(self):
        edge={"representativeDeltaE":0,"sourceBoundaryDeltaE":{"p90":0},"boundaryPersistence":{"tolerance1px":0},"sharedBoundaryCoverage":1,"areaRatio":0,"areaA":1,"areaB":10,"lineageAmbiguous":False,"touchesGlobalVoid":False}; decision,_=decide_edge(edge,policy_definitions()["MODERATE"],["HOLE"]); self.assertEqual(decision,"PRESERVE")
    def test_coherent_route_allows_similar_area_regions(self):
        edge={"representativeDeltaE":12,"sourceBoundaryDeltaE":{"p90":1},"boundaryPersistence":{"tolerance1px":0},"sharedBoundaryCoverage":.3,"areaRatio":.95,"areaA":1000,"areaB":950,"lineageAmbiguous":False,"touchesGlobalVoid":False}; result=evaluate_edge(edge,policy_definitions()["STRICT"]); self.assertEqual(result["decision"],"SAFE_MERGE"); self.assertEqual(result["triggeredRoutes"],["COHERENT_SPLIT_REPAIR"])
    def test_tiny_fragment_route_is_independent(self):
        edge={"representativeDeltaE":6,"sourceBoundaryDeltaE":{"p90":3},"boundaryPersistence":{"tolerance1px":.2},"sharedBoundaryCoverage":.1,"areaRatio":.01,"areaA":10,"areaB":1000,"lineageAmbiguous":False,"touchesGlobalVoid":False}; result=evaluate_edge(edge,policy_definitions()["STRICT"]); self.assertEqual(result["decision"],"SAFE_MERGE"); self.assertIn("TINY_FRAGMENT_REPAIR",result["triggeredRoutes"])
    def test_apply_safe_and_preserve_labels(self):
        appearance,lineage,audit=apply_safe_merges(self.labels,self.labels,[{"regionA":1,"regionB":2,"representativeDeltaE":0,"sourceBoundaryDeltaE":{"p90":0},"sharedBoundaryEdgeCount":3}]); self.assertEqual(set(appearance[self.labels>0]),{1}); self.assertEqual(lineage,{1:[1,2]}); self.assertEqual(audit[0]["decision"],"SAFE_MERGE_APPLIED")
    def test_orphan_and_transparent_survive(self):
        pixel=self.labels.copy(); pixel[0,0]=-1; appearance,_,_=apply_safe_merges(self.labels,pixel,[]); self.assertEqual(appearance[0,0],-1); self.assertEqual(appearance[0,5],0)
    def test_transitive_veto(self):
        labels=self.labels.copy(); labels[1:4,4:5]=3; edges=[{"regionA":1,"regionB":2,"representativeDeltaE":0,"sourceBoundaryDeltaE":{"p90":0},"sharedBoundaryEdgeCount":2},{"regionA":2,"regionB":3,"representativeDeltaE":0,"sourceBoundaryDeltaE":{"p90":0},"sharedBoundaryEdgeCount":2}]; _,_,audit=apply_safe_merges(labels,labels,edges,{(1,3)}); self.assertEqual(audit[0]["decision"],"SAFE_MERGE_APPLIED"); self.assertEqual(audit[1]["decision"],"PRESERVE_BY_TRANSITIVE_VETO")
class RelationContractTests(unittest.TestCase):
    def test_hole_requires_interior_transparency(self):
        alpha=np.ones((5,5),dtype=np.uint8)*255; alpha[2,2]=0; data={"fixtureId":"RCF-001","regions":[{"regionKey":"h","kind":"HOLE","anchors":[[2,2]]}],"relations":[{"relationId":"h","type":"HOLE","regionKeys":["h"]}]}; validate_relation_gt(data,alpha)
    def test_exterior_is_not_hole(self):
        alpha=np.ones((5,5),dtype=np.uint8)*255; alpha[0,0]=0; data={"fixtureId":"RCF-001","regions":[{"regionKey":"h","kind":"HOLE","anchors":[[0,0]]}],"relations":[]};
        with self.assertRaises(RegionCoreError): validate_relation_gt(data,alpha)
    def test_duplicate_relation_id_rejected(self):
        data={"fixtureId":"RCF-001","regions":[{"regionKey":"a","kind":"SUBJECT_REGION","anchors":[[1,1]]}],"relations":[{"relationId":"x","type":"UNCERTAIN","regionKeys":["a"]},{"relationId":"x","type":"UNCERTAIN","regionKeys":["a"]}]}
        with self.assertRaises(RegionCoreError): validate_relation_gt(data,np.ones((3,3),dtype=np.uint8)*255)

    def test_contract_contains_lineage_and_artifacts(self):
        rgba=np.zeros((2,2,4),dtype=np.uint8); rgba[...,3]=255; labels=np.array([[1,1],[2,2]],dtype=np.int32)
        with tempfile.TemporaryDirectory() as directory:
            contract=write_contract(Path(directory),rgba,labels,labels,labels,[],[],{}, {1:[1],2:[2]}, [], "cp-b-balanced_rc-a", "RC-A", "STRICT")
            self.assertIn("raw_structural_label_map.npz",contract["artifactSha256"])
            self.assertTrue((Path(directory) / "raw_to_appearance_lineage.json.gz").is_file())

    def test_contract_rejects_benchmark_only_representative(self):
        rgba=np.zeros((2,2,4),dtype=np.uint8); rgba[...,3]=255; labels=np.ones((2,2),dtype=np.int32)
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            write_contract(Path(directory),rgba,labels,labels,labels,[],[],{}, {1:[1]}, [], "cp-b-balanced_rc-a", "RC-D", "STRICT")

    def test_synthetic_relations_are_direct_and_have_expected_v2_predictions(self):
        report_root=ROOT / "region-core" / "reports"
        for profile in ("cp-b-balanced_rc-a","cp-b-aggressive_rc-a"):
            data=json.loads((report_root / f"repair-evidence-v2-{profile}.json").read_text(encoding="utf-8"))
            merge=data["cases"]["RCF-001"]["relationMatrix"][0]
            protected=data["cases"]["RCF-002"]["relationMatrix"][0]
            self.assertEqual(merge["matchingEdgeCount"],1)
            self.assertEqual(protected["matchingEdgeCount"],1)
            self.assertTrue(all(value==["SAFE_MERGE"] for value in merge["decisions"].values()))
            self.assertTrue(all(value==["PRESERVE"] for value in protected["decisions"].values()))

if __name__=="__main__": unittest.main()
