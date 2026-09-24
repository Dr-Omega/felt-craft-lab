"""Strict source attribution after the real mooncake overlay failure.

The non-frozen fixture retains only the two exact selected source polygons.
No expected numerical tolerance is introduced to accept the illegal sliver.
"""
import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import zlib

from shapely.geometry import box
from shapely import wkb
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solid_plans
from solid_plans import (SolidPlanError, _actual_parents, _intersects_area,
                         decompose_solid, propose_plans, validate_plan)


FIXTURE = Path(__file__).with_name("fixtures") / "mooncake_contour_partition_rejection.json"


def real_sources():
    record = json.loads(FIXTURE.read_text("utf-8"))
    sources = []
    for item in record["observed"]:
        raw = zlib.decompress(base64.b64decode(item["geometryWkbZlibBase64"], validate=True))
        if len(raw) != item["wkbByteLength"] or hashlib.sha256(raw).hexdigest() != item["wkbSha256"]:
            raise ValueError("real source fixture exact WKB identity mismatch")
        sources.append({**{k: v for k, v in item.items() if k not in
                            {"geometryWkbZlibBase64", "wkbSha256", "wkbByteLength"}},
                        "polygon": wkb.loads(raw)})
    return sources


def synthetic_sources():
    outside = box(0, 0, 24, 20)
    inside = box(6, 5, 18, 15)
    return [{"componentId": name, "regionId": "r-"+name, "colorSlotId": "slot-"+name,
             "rgb": rgb, "polygon": polygon,
             "boundaryProvenance": {"selectedVectorArtifactId": "synthetic-actual-geometry", "edgeIds": [name]}}
            for name, rgb, polygon in [("outer", [220, 30, 40], outside.difference(inside)),
                                       ("inner", [240, 200, 90], inside)]]


def attribution_records(sources, axis):
    """Records for the actual-parent helper, not a fabrication candidate.

    An uncut BASE domain deliberately isolates the source-attribution contract
    under test; full solid-BASE validation is exercised on generated plans in
    the other tests. No such helper record is published or passed as a PASS.
    """
    foreground = unary_union([item["polygon"] for item in sources])
    records = [{"id": "attribution-only-base", "role": "BASE", "polygon": foreground,
                "sourceComponentIds": sorted(item["componentId"] for item in sources),
                "colorSlotId": sources[0]["colorSlotId"]}]
    for source in sources:
        for index, piece in enumerate(decompose_solid(source["polygon"], axis), 1):
            records.append({"id": f"visible-{source['componentId']}-piece-{index}", "role": "VISIBLE",
                            "polygon": piece, "sourceComponentIds": [source["componentId"]],
                            "colorSlotId": source["colorSlotId"]})
    return foreground, records


class QualityPartitionRejectionTests(unittest.TestCase):
    def test_actual_mooncake_sources_touch_but_y_split_is_strictly_rejected(self):
        sources = real_sources()
        by_id = {item["componentId"]: item for item in sources}
        r3, r13 = by_id["R00003-C001"]["polygon"], by_id["R00013-C001"]["polygon"]
        self.assertTrue(r3.is_valid and r13.is_valid)
        self.assertEqual(len(r3.interiors), 11)
        self.assertEqual(r3.intersection(r13).area, 0.0)
        self.assertFalse(_intersects_area(r3, r13))
        illegal = [part for part in decompose_solid(r3, "y") if part.intersection(r13).area > 0]
        # The supported GEOS dependency reproduces a positive-area near-
        # collinear triangle. Do not change this to an area-epsilon acceptance.
        self.assertTrue(illegal, "real repeated overlay failure no longer reproduces; investigate dependency/geometry change")
        self.assertTrue(_intersects_area(illegal[0], r13))
        self.assertGreater(illegal[0].difference(r3).area, 0.0)
        foreground, pieces = attribution_records(sources, "y")
        with self.assertRaisesRegex(SolidPlanError, r"actual source Components.*R00003-C001.*R00013-C001.*differ"):
            _actual_parents(sources, foreground, pieces, {})

    def test_actual_mooncake_x_partition_passes_same_strict_source_attribution(self):
        sources = real_sources()
        by_id = {item["componentId"]: item for item in sources}
        r3, r13 = by_id["R00003-C001"]["polygon"], by_id["R00013-C001"]["polygon"]
        parts = decompose_solid(r3, "x")
        self.assertGreater(len(parts), 1)
        for part in parts:
            self.assertFalse(_intersects_area(part, r13))
            self.assertEqual(part.intersection(r13).area, 0.0)
            self.assertEqual(part.difference(r3).area, 0.0)
        foreground, pieces = attribution_records(sources, "x")
        _, parents = _actual_parents(sources, foreground, pieces, {})
        self.assertEqual(set(parents), {piece["id"] for piece in pieces})

    def test_opt_in_records_score_rejection_and_still_fully_validates_survivors(self):
        observed = synthetic_sources()
        before = copy.deepcopy(observed)
        original_score = solid_plans._score

        def reject_y(plan, sources, **kwargs):
            if any(choice["splitAxis"] == "y" for choice in plan["baseChoices"]):
                raise SolidPlanError("injected strict source attribution failure")
            return original_score(plan, sources, **kwargs)

        with patch("solid_plans._score", side_effect=reject_y):
            plans = propose_plans(observed, reject_invalid_options=True)
        self.assertTrue(plans)
        self.assertEqual(observed, before)
        for plan in plans:
            self.assertTrue(all(choice["splitAxis"] == "x" for choice in plan["baseChoices"]))
            rejected = plan["rejectedCandidates"]
            self.assertTrue(rejected)
            self.assertTrue(all(entry["stage"] == "HARD_VALIDATION_BEFORE_RANKING" for entry in rejected))
            self.assertTrue(all(entry["splitAxis"] == "y" for entry in rejected))
            self.assertTrue(all("strict source attribution" in entry["reason"] for entry in rejected))
            self.assertTrue(validate_plan(observed, plan))

    def test_default_path_still_propagates_score_validation_failure(self):
        for kwargs in ({}, {"reject_invalid_options": False}):
            with self.subTest(kwargs=kwargs):
                with patch("solid_plans._score", side_effect=SolidPlanError("injected score hard rejection")):
                    with self.assertRaisesRegex(SolidPlanError, "injected score hard rejection"):
                        propose_plans(synthetic_sources(), **kwargs)

    def test_all_invalid_opt_in_candidates_still_fail_closed(self):
        with patch("solid_plans._score", side_effect=SolidPlanError("all candidates invalid")):
            with self.assertRaisesRegex(SolidPlanError, "No valid Base/solid partition"):
                propose_plans(synthetic_sources(), reject_invalid_options=True)

    def test_programming_error_is_never_converted_to_candidate_rejection(self):
        with patch("solid_plans._score", side_effect=RuntimeError("unexpected implementation bug")):
            with self.assertRaisesRegex(RuntimeError, "unexpected implementation bug"):
                propose_plans(synthetic_sources(), reject_invalid_options=True)


if __name__ == "__main__":
    unittest.main()
