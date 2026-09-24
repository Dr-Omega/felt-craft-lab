import copy
import json
from pathlib import Path
import sys
import unittest

import numpy as np
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quality_seams import compare_quality_plans, rank_quality_plans, render_plan_preview
from solid_plans import SolidPlanError, propose_plans, rank_plans


def source(polygon, component="ring", rgb=(180, 90, 20)):
    return {"componentId": component, "regionId": "r-"+component,
            "colorSlotId": "slot-"+component, "rgb": list(rgb), "polygon": polygon,
            "boundaryProvenance": {"selectedVectorArtifactId": "fixture", "edgeIds": [component]}}


class QualitySeamsTest(unittest.TestCase):
    def setUp(self):
        outer, inner = box(1, 1, 31, 25), box(10, 8, 22, 18)
        self.observed = [source(outer.difference(inner)), source(inner, "center", (240, 220, 120))]
        self.plans = propose_plans(self.observed)

    def test_disabled_preserves_legacy_order_and_does_not_mutate_inputs(self):
        before = copy.deepcopy(self.plans)
        ordered, report = rank_quality_plans(self.observed, self.plans, enabled=False)
        self.assertEqual([p["id"] for p in ordered], [p["id"] for p in rank_plans(self.observed, before)])
        self.assertEqual(self.plans, before)
        self.assertFalse(report["enabled"])
        json.dumps(report, allow_nan=False)

    def test_same_geometry_and_physical_records_survive_experimental_sort(self):
        ordered, report = rank_quality_plans(self.observed, self.plans)
        old = {p["id"]: p for p in self.plans}
        self.assertEqual(set(old), {p["id"] for p in ordered})
        for plan in ordered:
            self.assertEqual(plan["pieces"], old[plan["id"]]["pieces"])
            self.assertEqual(plan["splitGroups"], old[plan["id"]]["splitGroups"])
            record = next(r for r in report["candidates"] if r["planId"] == plan["id"])
            self.assertEqual(record["physicalSeamRecordCount"], sum(len(g["seams"]) for g in plan["splitGroups"]))
            for seam in record["physicalSeams"]:
                self.assertAlmostEqual(seam["visibleLengthCanonical"]+seam["coveredLengthCanonical"], seam["physicalLengthCanonical"])
        self.assertFalse(report["humanTruth"])
        self.assertFalse(report["motifDetection"])

    def test_public_rank_never_trusts_forged_old_score_or_missing_groups(self):
        ring = [source(box(1, 1, 31, 25).difference(box(10, 8, 22, 18)))]
        plans = propose_plans(ring)
        plans[0]["score"] = {"pieceCount": -100000, "interiorSeamLengthCanonical": -100000}
        ordered, _ = rank_quality_plans(ring, plans)
        self.assertGreater(ordered[0]["score"]["pieceCount"], 0)
        for enabled in (True, False):
            bad = copy.deepcopy(plans)
            bad[0]["splitGroups"] = []
            with self.assertRaises(SolidPlanError):
                rank_quality_plans(ring, bad, enabled=enabled)

    def test_all_public_render_compare_rank_reject_metadata_changes(self):
        bad = copy.deepcopy(self.plans[0])
        bad["pieces"][0]["sourceComponentIds"] = ["invented"]
        with self.assertRaises(SolidPlanError):
            render_plan_preview(bad, self.observed, (28, 34))
        with self.assertRaises(SolidPlanError):
            compare_quality_plans(self.observed, [bad], (28, 34))
        with self.assertRaises(SolidPlanError):
            rank_quality_plans(self.observed, [bad])

    def test_anonymous_comparison_is_actual_xy_plus_alternate_base(self):
        report, images = compare_quality_plans(self.observed, self.plans, (28, 34))
        self.assertEqual(report["comparisonCount"], 3)
        a, b, c = report["comparisons"]
        self.assertEqual([a["anonymousLabel"], b["anonymousLabel"], c["anonymousLabel"]], list("ABC"))
        self.assertEqual(a["baseChoices"][0]["splitAxis"], "x")
        self.assertEqual(b["baseChoices"][0]["splitAxis"], "y")
        self.assertEqual(a["baseChoices"][0]["colorSlotId"], b["baseChoices"][0]["colorSlotId"])
        self.assertNotEqual(a["baseChoices"][0]["colorSlotId"], c["baseChoices"][0]["colorSlotId"])
        self.assertEqual(len(images), 15)
        self.assertEqual(images["A-appearance"].size, (34, 28))
        json.dumps(report, allow_nan=False)

    def test_preview_is_actual_slots_no_number_by_default_and_reproducible(self):
        plan = self.plans[0]
        image = render_plan_preview(plan, self.observed, (28, 34), scale=3)
        self.assertEqual(image.tobytes(), render_plan_preview(plan, self.observed, (28, 34), scale=3).tobytes())
        # Far from boundaries the colors are the exact Piece slots, not pasted input.
        self.assertEqual(image.getpixel((16, 13)), (240, 220, 120, 255))
        self.assertEqual(image.getpixel((5, 5)), (180, 90, 20, 255))
        self.assertNotEqual(image.tobytes(), render_plan_preview(plan, self.observed, (28, 34), numbered=True).tobytes())
        # Every alternative uses the same AA function and reproduces the same design.
        for other in self.plans:
            other_image = render_plan_preview(other, self.observed, (28, 34))
            np.testing.assert_array_equal(np.asarray(image), np.asarray(other_image))

    def test_real_hole_stays_transparent_and_missing_alternative_is_explicit(self):
        observed = [source(box(1, 1, 31, 25).difference(box(10, 8, 22, 18)))]
        plans = propose_plans(observed)
        report, images = compare_quality_plans(observed, plans, (28, 34))
        self.assertTrue(report["missingAlternatives"])
        for label in ("A", "B"):
            self.assertEqual(images[label+"-appearance"].getpixel((16, 13))[3], 0)

    def test_no_number_appearance_distinguished_from_visible_seam_overlay(self):
        observed = [source(box(1, 1, 31, 25).difference(box(10, 8, 22, 18)))]
        plan = propose_plans(observed)[0]
        plain = render_plan_preview(plan, observed, (28, 34))
        seams = render_plan_preview(plan, observed, (28, 34), seams=True)
        self.assertNotEqual(plain.tobytes(), seams.tobytes())

    def test_invalid_scale_and_empty_plans_rejected(self):
        with self.assertRaises(ValueError):
            render_plan_preview(self.plans[0], self.observed, (28, 34), scale=0)
        with self.assertRaises(ValueError):
            rank_quality_plans(self.observed, [])


if __name__ == "__main__":
    unittest.main()
