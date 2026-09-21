"""Bind validated algorithm geometry to the existing shared fabrication contract.

This adapter has no manufacturing/quality acceptance authority. Main must
persist the actual named geometry/evidence objects and independently validate
and render them before requesting the structural assessment below.
"""
from __future__ import annotations

import copy
import hashlib
import math

from m1_adapter import canonical_bytes, run_shared_validation
from relations import validate_relations


class ResultWireError(ValueError):
    pass


def _geometry_ref(artifact_id, object_id, frame_id):
    return {"artifactId": artifact_id, "objectId": object_id, "frameId": frame_id}


def _require_polygon(polygon, *, solid=False):
    if polygon.geom_type != "Polygon" or not polygon.is_valid or polygon.is_empty or polygon.area <= 0:
        raise ResultWireError("Cannot serialize invalid/nonpositive or disconnected geometry as a Piece")
    if solid and len(polygon.interiors):
        raise ResultWireError("Cannot claim solid for a geometry retaining an interior hole")


def _add_artifact(input_object, record):
    matches = [value for value in input_object["artifacts"] if value["id"] == record["id"]]
    if len(matches) > 1 or (matches and matches[0] != record):
        raise ResultWireError("Conflicting artifact identity: " + record["id"])
    if not matches:
        input_object["artifacts"].append(copy.deepcopy(record))


def build_result(input_object, plan, relations, geometry_artifact, evidence_artifact):
    """Convert actual M7 polygons/splits and M6 records; sign with shared JS.

    Artifacts use objects keyed by Piece.id, ``exposure:<zero-based index>``
    and AddedSeam.id. Geometry/source conservation must have passed M7's
    independent validate_plan before this conversion. This boundary additionally
    checks actual solidity, seam geometry and expected validation results.
    """
    for gate in ("solidGeometry", "sourceCoverage", "splitConservation", "frozenBoundaryAndVoids"):
        if plan.get("geometryChecks", {}).get(gate) != "PASS":
            raise ResultWireError("M7 geometry check not passed: " + gate)
    value = copy.deepcopy(input_object)
    _add_artifact(value, geometry_artifact)
    _add_artifact(value, evidence_artifact)
    frame_id = value["coordinates"]["canonicalFrameId"]
    ref = lambda object_id: _geometry_ref(geometry_artifact["id"], object_id, frame_id)
    pieces = []
    for piece in plan["pieces"]:
        _require_polygon(piece["polygon"], solid=True)
        pieces.append({key: copy.deepcopy(piece[key]) for key in
                       ("id", "role", "colorSlotId", "sourceRegionIds", "splitGroupId")})
        pieces[-1].update(geometry=ref(piece["id"]), solid=True)
    exposures = []
    for index, exposure in enumerate(plan["baseExposures"]):
        _require_polygon(exposure["polygon"])
        exposures.append({"sourceRegionId": exposure["sourceRegionId"],
                          "basePieceId": exposure["basePieceId"], "geometry": ref(f"exposure:{index}")})
    groups = []
    for group in plan["splitGroups"]:
        seams = []
        for seam in group["seams"]:
            line, length = seam["polyline"], seam["lengthCanonical"]
            if line.geom_type != "LineString" or not line.is_valid or line.is_empty or not math.isfinite(length) or length <= 0 or abs(line.length-length) > 1e-8:
                raise ResultWireError("Seam measurement differs from actual geometry")
            seams.append({"id": seam["id"], "pieceIds": list(seam["pieceIds"]),
                          "geometry": ref(seam["id"]), "lengthCanonical": length,
                          "measurementEvidenceId": evidence_artifact["id"]})
        groups.append({"id": group["id"], "sourceRegionIds": list(group["sourceRegionIds"]),
                       "pieceIds": list(group["pieceIds"]), "seams": seams,
                       "partitionEvidenceIds": [evidence_artifact["id"]]})
    records = copy.deepcopy(relations["records"] if isinstance(relations, dict) else relations)
    coverage = []
    for kind, endpoints in (("VISUAL_OCCLUSION_RELATION", value["observedRegions"]),
                            ("ASSEMBLY_PRECEDENCE", pieces)):
        ids = sorted(item["id"] for item in endpoints)
        expected = {(a, b) for i, a in enumerate(ids) for b in ids[i+1:]}
        actual = {tuple(sorted((record["a"], record["b"]))) for record in records if record["kind"] == kind}
        # The shared v1 contract does not allow completely record-free COMPLETE.
        complete = bool(actual) and actual == expected
        coverage.append({"kind": kind, "status": "COMPLETE" if complete else "NOT_EVALUATED",
                         "evidenceArtifactIds": [evidence_artifact["id"]]})
    result = {"schemaVersion": "b2.result/1", "identity": {
        "contractVersion": "b2.result/1", "algorithmRecipeId": "m4-m7-conservative-solid-plan",
        "algorithmRecipeVersion": "1", "identityMode": "CANONICAL_JSON_LF_UTF8", "sha256": "0"*64},
        "payload": {"input": value, "pieces": pieces, "baseExposures": exposures,
                    "splitGroups": groups, "relations": records, "relationCoverage": coverage,
                    "unspecifiedRelation": "NOT_EVALUATED"}}
    checked = run_shared_validation(result=result, sign_result=True)
    if not checked["ok"]:
        raise ResultWireError("Shared FabricationResult rejected: " + str(checked.get("result")))
    return checked["signedResult"]


def build_assessment(result, evidence_artifact, checks):
    """Bind completed independent geometry/render checks, leaving quality pending.

    Caller supplies actual independent geometry conservation, relation and
    render measurements plus the identity of their canonical JSON artifact.
    Measurements must match that digest, bind this exact result SHA, and pass
    each checked domain before this function can emit a PASS check. Quality
    acceptance remains pending.
    """
    if evidence_artifact["id"] != "geometry-checks.json":
        raise ResultWireError("Assessment requires the independent geometry-checks.json artifact")
    check_bytes = canonical_bytes(checks)
    if evidence_artifact["sha256"] != hashlib.sha256(check_bytes).hexdigest() or evidence_artifact["byteLength"] != len(check_bytes):
        raise ResultWireError("Actual geometry checks do not match the evidence artifact identity")
    if checks.get("resultSha256") != result["identity"]["sha256"]:
        raise ResultWireError("Independent geometry checks do not bind the assessed result identity")
    for name in ("solidGeometry", "frozenBoundaryAndVoids", "sourceCoverage", "splitConservation", "addedSeams", "baseSupport"):
        if checks.get("geometryChecks", {}).get(name) != "PASS":
            raise ResultWireError("Independent geometry check not passed: " + name)
    if checks.get("renderBackStatus") != "PASS" or type(checks.get("mismatchPixelCount")) is not int or checks["mismatchPixelCount"] != 0:
        raise ResultWireError("Independent renderBack must PASS with exactly zero mismatchPixelCount")
    if checks.get("relationsStatus") != "PASS":
        raise ResultWireError("Independent relationship check not passed")
    payload = result["payload"]
    piece_ids = {piece["id"] for piece in payload["pieces"]}
    validate_relations(payload["relations"], {region["id"] for region in payload["input"]["observedRegions"]}, piece_ids)
    order = checks.get("topologicalOrder", [])
    if len(order) != len(piece_ids) or set(order) != piece_ids:
        raise ResultWireError("Independent topological order must contain every final Piece exactly once")
    positions = {piece_id: index for index, piece_id in enumerate(order)}
    for relation in payload["relations"]:
        if relation["kind"] == "ASSEMBLY_PRECEDENCE" and relation["status"] == "RESOLVED":
            a, b = (relation["a"], relation["b"]) if relation["direction"] == "A_TO_B" else (relation["b"], relation["a"])
            if positions[a] >= positions[b]:
                raise ResultWireError("Independent topological order contradicts final assembly relations")
    if any(record["fabricationImpact"] == "BLOCKING" and record["status"] in ("UNRESOLVED", "NOT_EVALUATED")
           for record in result["payload"]["relations"]):
        raise ResultWireError("Cannot mark relation geometry passed with blocking unresolved relationships")
    assessment_checks = {name: {"status": "REVIEW_REQUIRED" if name in ("purification", "sourceSemantics") else "PASS",
                     "evidenceArtifactIds": [evidence_artifact["id"]]}
              for name in ("purification", "sourceSemantics", "solidGeometry", "frozenBoundaryAndVoids",
                           "renderBack", "sourceCoverage", "splitConservation", "relations")}
    assessment = {"schemaVersion": "b2.structure/1", "assessmentId": "structure:" + result["identity"]["sha256"],
                  "resultSha256": result["identity"]["sha256"], "resultContractVersion": "b2.result/1",
                  "evidenceArtifacts": [copy.deepcopy(evidence_artifact)], "status": "REVIEW_REQUIRED", "checks": assessment_checks}
    checked = run_shared_validation(result=result, assessment=assessment)
    if not checked["ok"]:
        raise ResultWireError("Shared StructuralAssessment rejected: " + str(checked.get("assessment")))
    return assessment
