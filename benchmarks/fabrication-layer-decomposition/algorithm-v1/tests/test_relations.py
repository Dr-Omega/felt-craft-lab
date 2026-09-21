import copy
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from shapely.geometry import box
from shapely.affinity import translate
from shapely.ops import unary_union

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from generate_layered_examples import development_svg, development_psd
from layered_sources import parse_layered
from relations import RelationError, visual_relations, assembly_relations, validate_relations
from solid_plans import propose_plans


def source(polygon, index, rgb):
    return {"id":f"c{index}","componentId":f"c{index}","regionId":f"R{index:05d}","colorSlotId":f"slot{index}",
            "rgb":rgb,"polygon":polygon,"boundaryProvenance":{"selectedVectorArtifactId":"development-vector","edgeIds":[f"edge{index}"]}}


def raster_observed(rgba):
    labels=np.zeros(rgba.shape[:2],np.int32); observed=[]
    colors=np.unique(rgba[:,:,:3][rgba[:,:,3]>0],axis=0)
    for index,color in enumerate(colors,1):
        mask=(rgba[:,:,3]>0)&np.all(rgba[:,:,:3]==color,axis=2); labels[mask]=index
        polygon=unary_union([box(int(x),int(y),int(x)+1,int(y)+1) for y,x in np.argwhere(mask)])
        parts=[polygon] if polygon.geom_type=="Polygon" else list(polygon.geoms)
        for n,part in enumerate(parts):
            item=source(part,index,color.tolist()); item["componentId"]=item["id"]=f"c{index}-{n}"; observed.append(item)
    return observed,labels


def record(identifier,a,b,status="RESOLVED",direction="A_TO_B",kind="ASSEMBLY_PRECEDENCE",impact="NON_BLOCKING"):
    return {"id":identifier,"kind":kind,"a":a,"b":b,"status":status,"direction":direction,
            "fabricationImpact":impact,"impactReason":"Actual test input record; no generated signature", "evidenceArtifactIds":["development-evidence.json"]}


class RelationsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name); self.addCleanup(self.tmp.cleanup)

    def parse(self,raw,suffix="svg",selection=None):
        path=self.root/("source."+suffix); path.write_bytes(raw)
        return parse_layered(path,selection or ["*"])

    def test_real_svg_and_psd_have_actual_direction_and_located_witness(self):
        for raw,suffix in ((development_svg(),"svg"),(development_psd(),"psd")):
            layered=self.parse(raw,suffix); observed,labels=raster_observed(layered["rgba"])
            result=visual_relations(observed,labels,layered)
            self.assertEqual(result["checkedRegionPairCount"],1)
            relation=result["records"][0]
            self.assertEqual(relation["status"],"RESOLVED")
            # Lexicographic colors put blue in Region 1 and red in Region 2.
            self.assertEqual(relation["direction"],"B_TO_A")
            evidence=result["evidence"][0]
            self.assertEqual(evidence["overlapPixelCount"],16*20)
            self.assertEqual(len(evidence["visibleWitnessMaskSha256"]),64)
            self.assertEqual(evidence["sourceSha256"],layered["sourceSha256"])
            self.assertEqual(evidence["samplePixelYX"],[12,18])

    def test_unselected_layer_never_changes_ownership_or_direction(self):
        raw=development_svg().replace(b'</svg>',b'<rect id="unselected" width="48" height="40" fill="green"/></svg>')
        layered=self.parse(raw,selection=["explicit-foreground"])
        observed,labels=raster_observed(layered["rgba"])
        result=visual_relations(observed,labels,layered)
        self.assertEqual(result["records"][0]["status"],"RESOLVED")
        self.assertNotIn("unselected",result["selectedEvidenceLayerIds"])
        self.assertNotIn("unselected",result["layerOwnerMapping"].values())

    def test_cached_ownership_cannot_turn_translucency_into_proof(self):
        raw=development_svg().replace(b'id="blue-front"',b'id="blue-front" opacity="0.5"')
        layered=self.parse(raw); observed,labels=raster_observed(layered["rgba"])
        layered["opaqueOwnerIndex"]=np.ones(labels.shape,np.int32)
        result=visual_relations(observed,labels,layered)
        self.assertTrue(result["records"])
        self.assertTrue(all(r["status"]=="UNRESOLVED" for r in result["records"]))

    def test_fractional_source_opacity_rounded_to_255_is_not_opaque_proof(self):
        raw=development_svg().replace(b'id="blue-front"',b'id="blue-front" opacity="0.999"')
        layered=self.parse(raw); observed,labels=raster_observed(layered["rgba"])
        self.assertEqual(layered["layers"][-1]["rgba"][15,20,3],255)
        result=visual_relations(observed,labels,layered)
        self.assertEqual(result["records"][0]["status"],"UNRESOLVED")

    def test_third_layer_hiding_overlap_cannot_prove_queried_direction(self):
        raw=b'''<svg xmlns="http://www.w3.org/2000/svg" width="10" height="4"><rect id="red" width="6" height="4" fill="red"/><rect id="blue" x="4" width="6" height="4" fill="blue"/><rect id="green" x="4" width="2" height="4" fill="green"/></svg>'''
        layered=self.parse(raw); observed,labels=raster_observed(layered["rgba"])
        result=visual_relations(observed,labels,layered)
        # Colors order is blue, green, red. Their original overlap is covered.
        rb=next(r for r in result["records"] if {r["a"],r["b"]}=={"R00001","R00003"})
        self.assertEqual(rb["status"],"UNRESOLVED")
        self.assertEqual(sum(r["status"]=="RESOLVED" for r in result["records"]),2)

    def test_order_contact_color_or_containment_alone_never_proves_visual_order(self):
        raw=b'''<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect id="red" width="4" height="4" fill="red"/><rect id="blue" x="4" width="4" height="4" fill="blue"/></svg>'''
        layered=self.parse(raw); observed,labels=raster_observed(layered["rgba"])
        result=visual_relations(observed,labels,layered)
        self.assertEqual(result["records"][0]["status"],"UNRESOLVED")
        self.assertEqual(result["evidence"][0]["sharedBoundaryLength"],4)
        self.assertEqual(result["unspecifiedRelation"],"NOT_EVALUATED")
        self.assertEqual(visual_relations(observed,labels)["records"][0]["status"],"UNRESOLVED")

    def test_multicolor_source_layer_is_not_automatically_one_region(self):
        layered=self.parse(development_psd(),"psd")
        lower=layered["layers"][0]; lower["rgba"][5,5,:3]=[1,2,3]
        observed,labels=raster_observed(layered["rgba"])
        result=visual_relations(observed,labels,layered)
        self.assertEqual(result["records"][0]["status"],"UNRESOLVED")

    def test_supported_actual_base_plan_makes_unknown_visual_order_nonblocking(self):
        layered=self.parse(development_svg()); observed,labels=raster_observed(layered["rgba"])
        visual=visual_relations(observed,labels)
        result=assembly_relations(observed,propose_plans(observed)[0],visual)
        self.assertEqual(result["blockingUnresolved"],[])
        original=next(r for r in result["records"] if r["kind"]=="VISUAL_OCCLUSION_RELATION")
        self.assertEqual(original["status"],"UNRESOLVED"); self.assertEqual(original["fabricationImpact"],"NON_BLOCKING")
        self.assertTrue(any(r["kind"]=="ASSEMBLY_PRECEDENCE" and r["status"]=="RESOLVED" for r in result["records"]))
        impacts=[e for e in result["evidence"] if e["id"].startswith("impact:")]
        self.assertEqual(impacts[0]["unsupportedAreaCanonical"],0)
        self.assertEqual(impacts[0]["sourceCoverageValidation"],"PASS")

    def test_final_split_piece_ids_and_independent_pairs_are_actual(self):
        ring=box(0,0,12,12).difference(box(3,3,9,9))
        observed=[source(ring,1,[220,30,30]),source(box(3,3,9,9),2,[30,30,220])]
        labels=np.ones((12,12),np.int32); labels[3:9,3:9]=2
        plan=next(p for p in propose_plans(observed) if p["baseChoices"][0]["colorSlotId"]=="slot2")
        self.assertTrue(plan["splitGroups"])
        result=assembly_relations(observed,plan,visual_relations(observed,labels))
        ids={p["id"] for p in plan["pieces"]}
        assembly=[r for r in result["records"] if r["kind"]=="ASSEMBLY_PRECEDENCE"]
        self.assertEqual(len(assembly),len(ids)*(len(ids)-1)//2)
        self.assertTrue(all(r["a"] in ids and r["b"] in ids for r in assembly))
        self.assertTrue(any(r["status"]=="NO_RELATION" for r in assembly))
        visible={p["id"] for p in plan["pieces"] if p["role"]=="VISIBLE"}
        self.assertGreater(len(visible),1)
        self.assertTrue(visible.issubset(result["sourceRegionToFinalPieceIds"]["R00001"]))
        self.assertFalse(any(r["a"] in {"c1","c2"} or r["b"] in {"c1","c2"} for r in assembly))

    def test_missing_support_or_exposure_cannot_downgrade_unknown_impact(self):
        observed=[source(box(0,0,4,4),1,[255,0,0]),source(box(4,0,8,4),2,[0,0,255])]
        labels=np.ones((4,8),np.int32); labels[:,4:]=2
        plan=propose_plans(observed)[0]; visual=visual_relations(observed,labels)
        missing=copy.deepcopy(plan); missing["baseExposures"]=[]
        with self.assertRaisesRegex(RelationError,"contract failed"):
            assembly_relations(observed,missing,visual)
        missing=copy.deepcopy(plan); missing["pieces"]=[p for p in missing["pieces"] if p["role"]!="BASE"]
        with self.assertRaisesRegex(RelationError,"contract failed"):
            assembly_relations(observed,missing,visual)

    def test_no_relation_direction_conflict_detected_in_both_record_orders(self):
        yes=record("yes","a","b"); no=record("no","b","a","NO_RELATION",None)
        for records in ([yes,no],[no,yes]):
            with self.assertRaisesRegex(RelationError,"NO_RELATION conflicts"):
                validate_relations(records,set(),{"a","b"})

    def test_cycles_conflicting_directions_self_and_dangling_endpoints_rejected(self):
        cases=[([record("1","a","b"),record("2","b","c"),record("3","c","a")],"cycle"),
               ([record("1","a","b"),record("2","a","b",direction="B_TO_A")],"conflicting"),
               ([record("1","a","a")],"self-loop"),([record("1","old-candidate","b")],"endpoints")]
        for records,message in cases:
            with self.assertRaisesRegex(RelationError,message): validate_relations(records,set(),{"a","b","c"})

    def test_manual_constraints_preserved_and_checked_against_derived_records(self):
        observed=[source(box(0,0,4,4),1,[255,0,0]),source(box(4,0,8,4),2,[0,0,255])]
        labels=np.ones((4,8),np.int32); labels[:,4:]=2
        plan=propose_plans(observed)[0]; visual=visual_relations(observed,labels)
        base=next(p for p in plan["pieces"] if p["role"]=="BASE")["id"]
        top=next(p for p in plan["pieces"] if p["role"]=="VISIBLE")["id"]
        wrong=record("provided-record",base,top,"NO_RELATION",None)
        with self.assertRaisesRegex(RelationError,"NO_RELATION conflicts"):
            assembly_relations(observed,plan,visual,[wrong])
        pending=record("provided-pending","R00001","R00002","UNRESOLVED",None,"VISUAL_OCCLUSION_RELATION","BLOCKING")
        before=copy.deepcopy(pending)
        result=assembly_relations(observed,plan,visual,[pending])
        self.assertEqual(pending,before)
        self.assertIn("provided-pending",result["blockingUnresolved"])
        self.assertIn(before,result["records"])

    def test_malformed_layer_label_and_relation_contracts_fail_closed(self):
        layered=self.parse(development_svg()); observed,labels=raster_observed(layered["rgba"])
        broken=copy.deepcopy(layered); broken["selectedLayerIds"]=["missing"]
        with self.assertRaisesRegex(RelationError,"absent"): visual_relations(observed,labels,broken)
        broken=copy.deepcopy(layered); broken["layers"][-1]["rgba"]=np.zeros((2,2,4),np.uint8)
        with self.assertRaisesRegex(RelationError,"canvas"): visual_relations(observed,labels,broken)
        with self.assertRaisesRegex(RelationError,"integer"): visual_relations(observed,labels.astype(float))
        malformed=record("id","a","b"); malformed["evidenceArtifactIds"]=[]
        with self.assertRaisesRegex(RelationError,"evidence"): validate_relations([malformed],set(),{"a","b"})

    def test_cached_and_fresh_all_candidate_relations_match_exactly(self):
        observed=[source(box(0,0,12,12).difference(box(3,3,9,9)),1,[255,0,0]),
                  source(box(3,3,9,9),2,[0,0,255]),source(box(16,0,20,4),3,[0,255,0])]
        labels=np.zeros((12,20),np.int32); labels[:12,:12]=1; labels[3:9,3:9]=2; labels[:4,16:20]=3
        visual=visual_relations(observed,labels); cache={}
        plans=propose_plans(observed)
        self.assertGreater(len(plans),1)
        for plan in plans:
            fresh=assembly_relations(observed,plan,visual)
            cached=assembly_relations(observed,plan,visual,geometry_cache=cache)
            self.assertEqual(fresh,cached)
            self.assertEqual(fresh,assembly_relations(observed,plan,visual,geometry_cache=cache))
        self.assertTrue(cache)
        self.assertTrue(all(isinstance(key,tuple) and isinstance(key[1],bytes) and isinstance(key[2],bytes) for key in cache))

    def test_cached_geometry_cannot_hide_changed_piece_or_metadata_same_plan_id(self):
        observed=[source(box(0,0,4,4),1,[255,0,0]),source(box(4,0,8,4),2,[0,0,255])]
        labels=np.ones((4,8),np.int32); labels[:,4:]=2
        visual=visual_relations(observed,labels); plan=propose_plans(observed)[0]; cache={}
        assembly_relations(observed,plan,visual,geometry_cache=cache)
        moved=copy.deepcopy(plan); moved["pieces"][0]["polygon"]=translate(moved["pieces"][0]["polygon"],xoff=1)
        self.assertEqual(moved["id"],plan["id"])
        for candidate in (moved,copy.deepcopy(plan)):
            if candidate is not moved: candidate["pieces"][0]["sourceRegionIds"]=["R-absent"]
            for passed_cache in (None,cache):
                with self.assertRaisesRegex(RelationError,"contract failed"):
                    assembly_relations(observed,candidate,visual,geometry_cache=passed_cache)


if __name__=="__main__": unittest.main()
