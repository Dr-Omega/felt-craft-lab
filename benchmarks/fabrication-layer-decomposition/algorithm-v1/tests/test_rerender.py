import copy
import hashlib
from pathlib import Path
import sys
import unittest

import numpy as np
from shapely.geometry import Polygon, box, mapping
from shapely.affinity import translate
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from m1_adapter import canonical_bytes, run_shared_validation
from relations import assembly_relations
from result_wire import build_result
from rerender import RerenderError, verify_and_render
from solid_plans import propose_plans


def source(polygon, component="c1", slot="red", region=None):
    return {"id": component, "componentId": component, "regionId": region or "r-"+component,
            "colorSlotId": slot, "rgb": {"red": [210,30,40], "blue": [20,60,220]}[slot],
            "polygon": polygon, "boundaryProvenance": {"selectedVector": component+"-vector"}}


def rehash(result, document):
    data = canonical_bytes(document)
    artifact = next(a for a in result["payload"]["input"]["artifacts"] if a["id"] == "fabrication-geometry.json")
    artifact.update(sha256=hashlib.sha256(data).hexdigest(), byteLength=len(data))
    resign(result)


def resign(result):
    # Use the same actual shared JS canonical signer, including deliberately
    # invalid-contract mutations which the public verifier must reject.
    signed = run_shared_validation(result=result, sign_result=True)
    result["identity"] = signed["signedResult"]["identity"]


def bytes_artifact(name, value):
    data = canonical_bytes(value)
    return {"id": name, "sha256": hashlib.sha256(data).hexdigest(), "byteLength": len(data),
            "mediaType": "application/json", "identityMode": "EXACT_BYTES"}


def serialize(plan, observed, size=16):
    doc = {"objects": {}}
    def geometry(name, polygon):
        doc["objects"][name] = mapping(polygon)
        return {"artifactId": "fabrication-geometry.json", "objectId": name, "frameId": "canonical"}
    for p in plan["pieces"]:
        geometry(p["id"], p["polygon"])
    for i,e in enumerate(plan["baseExposures"]):
        geometry(f"exposure:{i}", e["polygon"])
    for group in plan["splitGroups"]:
        geometry("source:"+group["id"], group["sourcePolygon"])
        for seam in group["seams"]:
            geometry(seam["id"], seam["polyline"])
    original = bytes_artifact("development-source.json", {
        "source": "SYNTHETIC_DEVELOPMENT_EXACT_VECTOR",
        "objects": {region: mapping(unary_union([s["polygon"] for s in observed if s["regionId"] == region]))
                    for region in sorted({s["regionId"] for s in observed})},
        "palette": {s["colorSlotId"]: s["rgb"] for s in observed}})
    slots = {s["colorSlotId"]: {"id": s["colorSlotId"], "rgb": s["rgb"], "skinFamily": None,
             "purificationArtifactId": original["id"], "paletteEntryId": s["colorSlotId"]} for s in observed}
    regions = [{"id": r, "colorSlotId": next(s["colorSlotId"] for s in observed if s["regionId"] == r),
                "componentIds": [s["componentId"] for s in observed if s["regionId"] == r],
                "geometry": {"artifactId": original["id"], "objectId": r, "frameId": "canonical"}}
               for r in sorted({s["regionId"] for s in observed})]
    relations = assembly_relations(observed, plan, {"records": [], "evidence": []})
    frames = [{"id": name, "space": space, "unit": unit, "bounds": [0,0,size,size],
               "xDirection": "RIGHT", "yDirection": "DOWN", "sourceArtifactId": original["id"],
               "sampleConvention": "PIXEL_CELL_BOUNDARY" if name in ("source", "analysis") else "CONTINUOUS"}
              for name, space, unit in [("source", "source-native", "native-unit"),
                  ("analysis", "analysis-raster", "px"), ("p004c", "p0-04c", "px"),
                  ("canonical", "fabrication-canonical", "canonical-unit")]]
    input_value = {"schemaVersion": "b2.input/1", "assetVersionId": "sha256:"+original["sha256"],
        "artifacts": [original], "source": {"mediaType": "application/json", "sourceKind": "FLAT",
            "artifactId": original["id"], "normalizedLayerEvidenceId": None,
            "adapter": {"id": "development-exact-vector", "version": "1", "status": "SUPPORTED"}},
        "coordinates": {"canonicalFrameId": "canonical", "sourceFrameId": "source", "analysisFrameId": "analysis",
            "p004cFrameId": "p004c", "frames": frames,
            "transforms": [{"id": a+"-"+b, "fromFrameId": a, "toFrameId": b, "matrix": [1,0,0,1,0,0],
                "evidenceArtifactIds": [original["id"]]} for a,b in [("source","analysis"),("analysis","p004c"),("p004c","canonical")]]},
        "frozenRegionArtifactId": original["id"], "frozenVectorArtifactId": original["id"],
        "colorSlots": list(slots.values()), "observedRegions": regions}
    result = build_result(input_value, plan, relations, bytes_artifact("fabrication-geometry.json", doc),
                          bytes_artifact("relation-evidence.json", relations))
    return result, doc


class RerenderTest(unittest.TestCase):
    def test_all_real_m7_ring_tradeoff_plans_reconstruct_actual_piece_colors(self):
        sources = [source(box(1,1,15,15).difference(box(3,3,13,13))), source(box(3,3,13,13), "c2", "blue")]
        plans = propose_plans(sources)
        self.assertGreater(len(plans), 1)
        for plan in plans:
            result, doc = serialize(plan, sources)
            output = verify_and_render(result, doc, sources, (16,16))
            self.assertEqual(output["mismatchPixelCount"], 0)
            self.assertEqual(output["renderBackStatus"], "PASS")
            self.assertEqual(output["relationsStatus"], "PASS")
            self.assertEqual(output["resultSha256"], result["identity"]["sha256"])
            self.assertEqual(output["image"].dtype, np.uint8)
            self.assertEqual(output["image"][7,7].tolist(), [20,60,220,255])
            self.assertEqual(output["image"][1,1].tolist(), [210,30,40,255])
            self.assertGreater(output["actualBaseSupportPairCount"], 0)

    def test_split_seam_through_pixel_centers_cannot_erase_alpha(self):
        # Hole interior x/y midpoints 6.5 coincide with sampling centers.
        sources = [source(box(1,1,14,14).difference(box(4,4,9,9)))]
        for plan in propose_plans(sources):
            result, doc = serialize(plan, sources)
            output = verify_and_render(result, doc, sources, (16,16))
            self.assertEqual(output["mismatchPixelCount"], 0)
            self.assertEqual(output["image"][2,6,3], 255)
            self.assertEqual(output["image"][6,2,3], 255)
            self.assertEqual(output["image"][6,6,3], 0)

    def test_diagonal_original_boundary_uses_explicit_color_tie_not_geometry_shift(self):
        sources = [source(Polygon([(1,1),(13,1),(13,13)])),
                   source(Polygon([(1,1),(13,13),(1,13)]), "c2", "blue")]
        raw_counts = []
        for plan in propose_plans(sources):
            result, doc = serialize(plan, sources)
            original = copy.deepcopy(doc)
            output = verify_and_render(result, doc, sources, (16,16))
            self.assertEqual(output["mismatchPixelCount"], 0)
            self.assertEqual(output["rawMismatchPixelCount"], output["boundaryTiePixelCount"])
            self.assertEqual(doc, original)
            raw_counts.append(output["rawMismatchPixelCount"])
        self.assertGreater(max(raw_counts), 0)

    def test_artifact_hash_and_exact_geometry_reference_are_enforced(self):
        sources = [source(box(1,1,14,14))]
        result, doc = serialize(propose_plans(sources)[0], sources)
        bad = copy.deepcopy(doc)
        bad["unboundChange"] = True
        with self.assertRaisesRegex(RerenderError, "digest"):
            verify_and_render(result, bad, sources, (16,16))
        for field, value in (("artifactId","other.json"),("objectId","missing"),("frameId","analysis")):
            damaged = copy.deepcopy(result)
            damaged["payload"]["pieces"][0]["geometry"][field] = value
            resign(damaged)
            with self.assertRaisesRegex(RerenderError, "shared|reference"):
                verify_and_render(damaged, doc, sources, (16,16))

    def test_geometry_tampering_detected_even_when_new_hash_is_consistent(self):
        sources = [source(box(1,1,14,14))]
        result, doc = serialize(propose_plans(sources)[0], sources)
        piece_id = result["payload"]["pieces"][0]["id"]
        doc["objects"][piece_id] = mapping(translate(box(1,1,14,14), 0.25, 0))
        rehash(result, doc)
        with self.assertRaisesRegex(RerenderError, "verification"):
            verify_and_render(result, doc, sources, (16,16))

    def test_final_holes_self_intersection_line_and_empty_are_rejected(self):
        sources = [source(box(1,1,14,14))]
        result, doc = serialize(propose_plans(sources)[0], sources)
        piece_id = result["payload"]["pieces"][0]["id"]
        replacements = [mapping(box(1,1,14,14).difference(box(4,4,9,9))),
                        mapping(Polygon([(1,1),(14,14),(1,14),(14,1)])),
                        {"type": "LineString", "coordinates": [[1,1],[14,14]]},
                        {"type": "Polygon", "coordinates": []}]
        for replacement in replacements:
            modified_result, modified_doc = copy.deepcopy(result), copy.deepcopy(doc)
            modified_doc["objects"][piece_id] = replacement
            rehash(modified_result, modified_doc)
            with self.assertRaises(RerenderError):
                verify_and_render(modified_result, modified_doc, sources, (16,16))

    def test_missing_split_source_or_tampered_seam_length_rejected(self):
        sources = [source(box(1,1,14,14).difference(box(4,4,9,9)))]
        result, doc = serialize(propose_plans(sources)[0], sources)
        group = result["payload"]["splitGroups"][0]
        bad_doc = copy.deepcopy(doc)
        del bad_doc["objects"]["source:"+group["id"]]
        rehash(result, bad_doc)
        with self.assertRaisesRegex(RerenderError, "source:"):
            verify_and_render(result, bad_doc, sources, (16,16))
        rehash(result, doc)
        group["seams"][0]["lengthCanonical"] += 1
        resign(result)
        with self.assertRaisesRegex(RerenderError, "seam length"):
            verify_and_render(result, doc, sources, (16,16))

    def test_wire_source_identity_and_exact_color_cannot_be_faked(self):
        sources = [source(box(1,1,14,14))]
        result, doc = serialize(propose_plans(sources)[0], sources)
        result["payload"]["input"]["colorSlots"][0]["rgb"] = [210,30,41]
        resign(result)
        with self.assertRaisesRegex(RerenderError, "ColorSlot"):
            verify_and_render(result, doc, sources, (16,16))
        result, doc = serialize(propose_plans(sources)[0], sources)
        result["payload"]["pieces"][0]["sourceRegionIds"] = ["unknown"]
        resign(result)
        with self.assertRaisesRegex(RerenderError, "shared|provenance"):
            verify_and_render(result, doc, sources, (16,16))

    def test_base_support_requires_actual_acyclic_assembly_order(self):
        sources = [source(box(1,1,15,15).difference(box(3,3,13,13))), source(box(3,3,13,13), "c2", "blue")]
        result, doc = serialize(propose_plans(sources)[0], sources)
        result["payload"]["relations"] = []
        for coverage in result["payload"]["relationCoverage"]:
            coverage["status"] = "NOT_EVALUATED"
        resign(result)
        with self.assertRaisesRegex(RerenderError, "Base-before-visible"):
            verify_and_render(result, doc, sources, (16,16))
        result, doc = serialize(propose_plans(sources)[0], sources)
        relation = next(r for r in result["payload"]["relations"] if r["status"] == "RESOLVED")
        inverse = copy.deepcopy(relation)
        inverse.update(id="opposite", direction="B_TO_A" if relation["direction"] == "A_TO_B" else "A_TO_B")
        result["payload"]["relations"].append(inverse)
        resign(result)
        with self.assertRaisesRegex(RerenderError, "shared|conflicting"):
            verify_and_render(result, doc, sources, (16,16))

    def test_payload_mutation_without_actual_shared_resigning_rejected(self):
        sources = [source(box(1,1,14,14))]
        result, doc = serialize(propose_plans(sources)[0], sources)
        # A structurally valid adapter metadata change leaves all geometry and
        # references valid; only the stale signed identity must reject it.
        result["payload"]["input"]["source"]["adapter"]["version"] = "2"
        with self.assertRaisesRegex(RerenderError, "shared result identity/contract"):
            verify_and_render(result, doc, sources, (16,16))


if __name__ == "__main__":
    unittest.main()
