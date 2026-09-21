"""Two-stage evidence rules. A_TO_B means A below B / assembled before B.

Visible geometry alone never resolves hidden visual order. Actual final pieces
may still have no precedence requirement in a supported conservative Base plan.
"""
from __future__ import annotations

import hashlib
from itertools import combinations
import re

import numpy as np
from shapely.ops import unary_union

from solid_plans import SolidPlanError, validate_plan


class RelationError(ValueError):
    pass


def validate_relations(records, region_ids, piece_ids):
    """Validate both graph types without discarding any conflicting assertion."""
    seen=set(); directed={}; pair_direction={}; unrelated=set()
    required={"id","kind","a","b","status","direction","fabricationImpact","impactReason","evidenceArtifactIds"}
    for r in records:
        if not isinstance(r,dict) or not required.issubset(r):
            raise RelationError("incomplete relation record")
        if not isinstance(r["id"],str) or not r["id"] or r["id"] in seen:
            raise RelationError("missing/duplicate relation identity")
        seen.add(r["id"])
        if r["kind"] not in {"VISUAL_OCCLUSION_RELATION","ASSEMBLY_PRECEDENCE"}:
            raise RelationError("unknown endpoint type")
        allowed=region_ids if r["kind"]=="VISUAL_OCCLUSION_RELATION" else piece_ids
        a,b=r["a"],r["b"]
        if not isinstance(a,str) or not isinstance(b,str) or a==b or a not in allowed or b not in allowed:
            raise RelationError("invalid relation endpoints/self-loop")
        if r["status"] not in {"RESOLVED","NO_RELATION","UNRESOLVED","NOT_EVALUATED"}:
            raise RelationError("unknown relation status")
        if r["status"]=="RESOLVED":
            if r["direction"] not in {"A_TO_B","B_TO_A"}: raise RelationError("resolved direction missing")
        elif r["direction"] is not None: raise RelationError("non-resolved relation cannot have direction")
        if r["fabricationImpact"] not in {"BLOCKING","NON_BLOCKING"}:
            raise RelationError("invalid fabrication impact")
        if not isinstance(r["evidenceArtifactIds"],list) or not r["evidenceArtifactIds"] or any(not isinstance(e,str) or not e for e in r["evidenceArtifactIds"]):
            raise RelationError("relation requires located evidence")
        if not isinstance(r["impactReason"],str) or not r["impactReason"].strip():
            raise RelationError("relation requires impact reason")
        pair=(r["kind"],*sorted((a,b)))
        if r["status"]=="NO_RELATION":
            unrelated.add(pair)
            if pair in pair_direction: raise RelationError("NO_RELATION conflicts with directional assertion")
        if r["status"]=="RESOLVED":
            source,target=(a,b) if r["direction"]=="A_TO_B" else (b,a)
            if pair in unrelated: raise RelationError("NO_RELATION conflicts with directional assertion")
            if pair in pair_direction and pair_direction[pair] != (source,target):
                raise RelationError("conflicting directions")
            pair_direction[pair]=(source,target)
            graph=directed.setdefault(r["kind"],{})
            graph.setdefault(source,set()).add(target)
    for graph in directed.values():
        active=set(); done=set()
        def visit(node):
            if node in active: raise RelationError("cycle in directional evidence; no edge was removed")
            if node in done: return
            active.add(node)
            for child in graph.get(node,()): visit(child)
            active.remove(node); done.add(node)
        for node in graph: visit(node)
    return True


def _record(identifier,kind,a,b,status,direction,impact,reason):
    return {"id":identifier,"kind":kind,"a":a,"b":b,"status":status,"direction":direction,
            "fabricationImpact":impact,"impactReason":reason,"evidenceArtifactIds":["relation-evidence.json"]}


def _mask_sha(mask):
    return hashlib.sha256(np.asarray(mask,dtype=np.uint8).tobytes()).hexdigest()


def _source_ownership(observed, labels, layered):
    """Recompute ownership from selected effective alpha, never trust cached owners."""
    if not layered or layered.get("status")!="SUPPORTED": return [],{},None,{}
    selected=layered.get("selectedLayerIds",[])
    if not selected: return [],{},None,{}
    if len(selected)!=len(set(selected)): raise RelationError("duplicate selected layer ID")
    pixels={}
    for layer in layered.get("layers",[]):
        if layer.get("id") in pixels: raise RelationError("duplicate layer identity")
        pixels[layer.get("id")]=layer
    if set(selected)-set(pixels): raise RelationError("selected layer identity absent")
    layers=[pixels[i] for i in selected if pixels[i].get("visible",True)]
    if any(layer.get("rgba") is None for layer in layers): raise RelationError("selected layer has no pixel evidence")
    layers.sort(key=lambda x:x["order"])
    if len({layer["order"] for layer in layers})!=len(layers): raise RelationError("ambiguous selected layer order")
    owner=np.full(labels.shape,-1,np.int32)
    for i,layer in enumerate(layers):
        rgba=layer["rgba"]
        if not isinstance(rgba,np.ndarray) or rgba.dtype!=np.uint8 or rgba.shape!=(*labels.shape,4):
            raise RelationError("layer RGBA does not match label canvas")
        alpha=rgba[...,3]
        owner[alpha>0]=-1
        # Fractional source opacity can quantize to byte 255 without proving
        # the original authoring object was opaque.
        if layer.get("opacity",1)==1 and layer.get("fillOpacity",1)==1:
            owner[alpha==255]=i
    region_labels={}
    for obj in observed:
        region=obj["regionId"]; label=obj.get("regionLabel")
        if label is None and re.fullmatch(r"R\d+",region): label=int(region[1:])
        if label is None: continue
        if not isinstance(label,(int,np.integer)) or label<=0: raise RelationError("invalid explicit Region raster label")
        if region in region_labels and region_labels[region]!=label: raise RelationError("inconsistent Region raster labels")
        region_labels[region]=int(label)
    if len(set(region_labels.values()))!=len(region_labels): raise RelationError("duplicate Region raster label mapping")
    mapping={}; diagnostic={}
    for region,label in region_labels.items():
        cells=labels==label; owners=set(int(x) for x in np.unique(owner[cells]))
        if not owners: continue
        if len(owners)==1 and next(iter(owners))>=0:
            index=next(iter(owners)); visible_labels=set(int(x) for x in np.unique(labels[(owner==index)&(labels>0)]))
            # A multi-Region source layer does not identify which hidden Region
            # its whole alpha footprint belongs to. Restrict proof to uniform
            # source color and unique layer/Region correspondence.
            if visible_labels=={label}:
                colors=np.unique(layers[index]["rgba"][:,:,:3][layers[index]["rgba"][:,:,3]>0],axis=0)
                if len(colors)==1:
                    mapping[region]=index
                    diagnostic[region]={"rasterLabel":label,"visiblePixelCount":int(cells.sum()),"sourceUniformRgb":colors[0].tolist(),"visibleOwnerMaskSha256":_mask_sha(owner==index)}
    return layers,mapping,owner,diagnostic


def visual_relations(observed, labels, layered=None):
    if not isinstance(labels,np.ndarray) or labels.ndim!=2 or not np.issubdtype(labels.dtype,np.integer) or np.any(labels<0):
        raise RelationError("labels must be a nonnegative integer raster")
    by_region={}
    for obj in observed: by_region.setdefault(obj["regionId"],[]).append(obj["polygon"])
    domains={r:unary_union(p) for r,p in by_region.items()}
    if any(p.is_empty or not p.is_valid or p.area<=0 for p in domains.values()): raise RelationError("invalid observed Region geometry")
    evidence=[]; records=[]
    layers,mapping,owner,ownership_evidence=_source_ownership(observed,labels,layered)
    for a,b in combinations(sorted(domains),2):
        pa,pb=domains[a],domains[b]
        detail={"id":f"visual:{a}:{b}","regionA":a,"regionB":b,
                "sharedBoundaryLength":float(pa.boundary.intersection(pb.boundary).length),
                "visibleAreaOverlap":float(pa.intersection(pb).area),
                "regionAContainsRegionB":bool(pa.covers(pb)),"regionBContainsRegionA":bool(pb.covers(pa)),
                "rule":"NO_OCCLUSION_DIRECTION_FROM_VISIBLE_GEOMETRY_ALONE"}
        direction=None
        if a in mapping and b in mapping and mapping[a]!=mapping[b]:
            ia,ib=mapping[a],mapping[b]; lower,upper=sorted((ia,ib))
            lower_mask=layers[lower]["rgba"][...,3]>0
            upper_mask=layers[upper]["rgba"][...,3]==255
            witness=lower_mask & upper_mask & (owner==upper)
            upper_region=a if ia==upper else b
            witness &= labels==ownership_evidence[upper_region]["rasterLabel"]
            if np.any(witness):
                direction="A_TO_B" if ia<ib else "B_TO_A"
                detail.update(rule="SELECTED_OPAQUE_VISIBLE_UPPER_COVERS_UNIFORM_LOWER_SOURCE_MASK",
                    lowerLayerId=layers[lower]["id"],upperLayerId=layers[upper]["id"],
                    overlapPixelCount=int(witness.sum()),samplePixelYX=np.argwhere(witness)[0].tolist(),
                    lowerSourceMaskSha256=_mask_sha(lower_mask),upperOpaqueMaskSha256=_mask_sha(upper_mask),
                    visibleWitnessMaskSha256=_mask_sha(witness),sourceSha256=layered["sourceSha256"],
                    regionOwnerLayerIds={a:layers[ia]["id"],b:layers[ib]["id"]},
                    ownershipEvidence={a:ownership_evidence[a],b:ownership_evidence[b]})
        status="RESOLVED" if direction else "UNRESOLVED"
        records.append(_record(detail["id"],"VISUAL_OCCLUSION_RELATION",a,b,status,direction,
                               "BLOCKING","Pending actual final Piece support/exposure review; evidence "+detail["id"]))
        evidence.append(detail)
    validate_relations(records,set(domains),set())
    return {"records":records,"evidence":evidence,"checkedRegionPairCount":len(evidence),
            "unspecifiedRelation":"NOT_EVALUATED","layerOwnerMapping":{r:layers[i]["id"] for r,i in mapping.items()},
            "selectedEvidenceLayerIds":[layer["id"] for layer in layers]}


def assembly_relations(observed, plan, visual, manual_records=None, *, geometry_cache=None):
    """Rebind from Region sources to actual final pieces, including all splits."""
    regions={x["regionId"] for x in observed}
    validate_relations(visual["records"],regions,set())
    try:
        validate_plan(observed,plan,geometry_cache=geometry_cache)
    except SolidPlanError as error:
        raise RelationError("final plan support/exposure/geometry contract failed: "+str(error)) from error
    pieces=sorted(plan["pieces"],key=lambda p:p["id"]); ids={x["id"] for x in pieces}
    # Floating overlay roundoff only; not a fabrication scale/quality threshold.
    area_epsilon=64*np.finfo(float).eps*max(1.0,sum(p["polygon"].area for p in pieces))
    records=[]; evidence=list(visual["evidence"])
    bases=unary_union([p["polygon"] for p in pieces if p["role"]=="BASE"])
    # These are measured inputs, never cached plan verdicts or relation records.
    # One call-local cache may be reused across candidates; exact WKB identifies
    # every operand so unchanged plan IDs cannot conceal changed geometry.
    cache=geometry_cache if geometry_cache is not None else {}
    wkb={p["id"]:p["polygon"].wkb for p in pieces}
    bounds={p["id"]:p["polygon"].bounds for p in pieces}
    hashes={identifier:hashlib.sha256(value).hexdigest() for identifier,value in wkb.items()}
    base_wkb=bases.wkb
    unsupported_by_piece={}
    source_to_pieces={r:[] for r in sorted(regions)}
    visible_by_region={r:[] for r in regions}
    for piece in pieces:
        identifier=piece["id"]
        for region in piece["sourceRegionIds"]:
            source_to_pieces[region].append(identifier)
            if piece["role"]=="VISIBLE": visible_by_region[region].append(piece)
        if piece["role"]=="VISIBLE":
            key=("difference-area",wkb[identifier],base_wkb)
            if key not in cache: cache[key]=piece["polygon"].difference(bases).area
            unsupported_by_piece[identifier]=cache[key]
    exposure_areas={r:0 for r in regions}
    for exposure in plan["baseExposures"]:
        exposure_areas[exposure["sourceRegionId"]]+=exposure["polygon"].area

    def overlap_area(p,q):
        a,b=p["id"],q["id"]; pa,pb=bounds[a],bounds[b]
        if min(pa[2],pb[2])<=max(pa[0],pb[0]) or min(pa[3],pb[3])<=max(pa[1],pb[1]):
            return 0.0  # Disjoint or touching bounding boxes have zero area.
        key=("m6-intersection-area",wkb[a],wkb[b])
        if key not in cache: cache[key]=p["polygon"].intersection(q["polygon"]).area
        return cache[key]

    for original in visual["records"]:
        r=dict(original)
        left=visible_by_region[r["a"]]; right=visible_by_region[r["b"]]
        overlap=sum(overlap_area(p,q) for p in left for q in right)
        unsupported=sum(unsupported_by_piece[p["id"]] for p in left+right)
        blocking=overlap>area_epsilon or unsupported>area_epsilon
        impact_id="impact:"+plan["id"]+":"+r["id"]
        r["fabricationImpact"]="BLOCKING" if blocking else "NON_BLOCKING"
        r["impactReason"]=f"Final plan {plan['id']}: VISIBLE overlap area={overlap}; unsupported VISIBLE area={unsupported}; exact Base exposure/source coverage validated. Original hidden order is not required for disjoint supported visible pieces. Evidence {impact_id}"
        evidence.append({"id":impact_id,"planId":plan["id"],"visualRelationId":r["id"],
            "finalPieceIdsA":source_to_pieces[r["a"]],"finalPieceIdsB":source_to_pieces[r["b"]],
            "visibleOverlapAreaCanonical":float(overlap),"unsupportedAreaCanonical":float(unsupported),"numericalAreaEpsilon":float(area_epsilon),
            "baseExposureAreaA":float(exposure_areas[r["a"]]),
            "baseExposureAreaB":float(exposure_areas[r["b"]]),
            "sourceCoverageValidation":"PASS"})
        records.append(r)
    for p,q in combinations(pieces,2):
        a,b=p["id"],q["id"]; area=float(overlap_area(p,q))
        detail={"id":f"assembly:{a}:{b}","pieceA":a,"pieceB":b,"overlapAreaCanonical":area,
                "sourceRegionIdsA":p["sourceRegionIds"],"sourceRegionIdsB":q["sourceRegionIds"],
                "geometrySha256A":hashes[a],"geometrySha256B":hashes[b]}
        detail["numericalAreaEpsilon"]=float(area_epsilon)
        if area<=area_epsilon:
            status,direction="NO_RELATION",None; detail["rule"]="FINAL_GEOMETRIES_HAVE_NO_POSITIVE_AREA_OVERLAP"
        elif p["role"]=="BASE" and q["role"]=="VISIBLE":
            status,direction="RESOLVED","A_TO_B"; detail["rule"]="ACTUAL_BASE_SUPPORT_BEFORE_VISIBLE_COVER"
        elif q["role"]=="BASE" and p["role"]=="VISIBLE":
            status,direction="RESOLVED","B_TO_A"; detail["rule"]="ACTUAL_BASE_SUPPORT_BEFORE_VISIBLE_COVER"
        else:
            raise RelationError(f"unsupported same-role overlap changes exposure: {a}, {b}, area {area}")
        records.append(_record(detail["id"],"ASSEMBLY_PRECEDENCE",a,b,status,direction,"NON_BLOCKING",detail["rule"]+"; evidence "+detail["id"]))
        evidence.append(detail)
    if manual_records:
        records.extend(manual_records)
    validate_relations(records,regions,ids)
    unresolved=[r["id"] for r in records if r["status"] in {"UNRESOLVED","NOT_EVALUATED"} and r["fabricationImpact"]=="BLOCKING"]
    return {"records":records,"evidence":evidence,"blockingUnresolved":unresolved,
            "checkedFinalPiecePairCount":len(pieces)*(len(pieces)-1)//2,
            "sourceRegionToFinalPieceIds":source_to_pieces,"unspecifiedRelation":"NOT_EVALUATED"}
