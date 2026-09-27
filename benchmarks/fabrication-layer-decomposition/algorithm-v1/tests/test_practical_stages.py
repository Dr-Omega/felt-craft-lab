"""Development reuse cannot confer acceptance or trust stale mutable results."""
import copy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from shapely.geometry import box

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),
               str(Path(__file__).resolve().parents[2] / "tools")]
import practical_stages as stages
from layered_completion import LayeredPlanError


class PreviewStageTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.zeros((12, 16, 4), np.uint8)
        self.rgba[2:10, 3:13] = [170, 50, 30, 255]
        self.config = {"fixture": "pure-stage-cache-mechanics"}
        self.inputs = []

        def propose(rgba, config):
            self.inputs.append(rgba.copy())
            labels = (rgba[..., 3] > 0).astype(np.int32)
            return SimpleNamespace(structural_label_map=labels, pixel_label_map=labels.copy())

        self.patchers = [
            patch.object(stages.kernel, "get_candidate", return_value=SimpleNamespace(propose=propose)),
            patch.object(stages.kernel, "apply_representatives", side_effect=lambda rgba, *args: (rgba.copy(), [{"regionId": 1}]))]
        for item in self.patchers:
            item.start()
            self.addCleanup(item.stop)

    def test_prepare_reuses_actual_normalized_input_and_keeps_original(self):
        session = stages.PreviewStages()
        first = session.prepare_foreground(self.rgba, self.config)
        altered = self.rgba.copy()
        altered[altered[..., 3] == 0, :3] = [53, 208, 19]
        second = session.prepare_foreground(altered, self.config)
        self.assertEqual(first["key"], second["key"])
        self.assertNotEqual(first["originalRgbaSha256"], second["originalRgbaSha256"])
        np.testing.assert_array_equal(second["originalRgba"], altered)
        np.testing.assert_array_equal(self.inputs[0], first["rgba"])
        self.assertTrue(np.all(self.inputs[0][self.inputs[0][..., 3] == 0, :3] == 0))
        self.assertEqual(session.measurements()["calls"]["cpB"], 1)
        self.assertEqual(session.measurements()["calls"]["rcA"], 1)
        self.assertTrue(session.measurements()["events"][-1]["cacheHit"])
        self.assertEqual(second["status"], "PREVIEW_NOT_ACCEPTANCE")

    def test_copy_out_does_not_mutate_next_hit(self):
        session = stages.PreviewStages()
        first = session.prepare_foreground(self.rgba, self.config)
        first["structural"][:] = 77
        first["metadata"][0]["regionId"] = 77
        second = session.prepare_foreground(self.rgba, self.config)
        self.assertEqual(int(second["structural"].max()), 1)
        self.assertEqual(second["metadata"], [{"regionId": 1}])

    def test_internal_cached_array_or_metadata_corruption_rejected(self):
        for target in ("array", "metadata"):
            with self.subTest(target=target):
                session = stages.PreviewStages()
                first = session.prepare_foreground(self.rgba, self.config)
                payload, _ = session._baseline[first["key"]]
                if target == "array":
                    payload["structural"][3, 4] = 77
                else:
                    payload["metadata"][0]["regionId"] = 77
                with self.assertRaisesRegex(ValueError, "content changed"):
                    session.prepare_foreground(self.rgba, self.config)

    def test_changed_visible_input_alpha_config_or_dependency_cannot_hit(self):
        session = stages.PreviewStages()
        session.prepare_foreground(self.rgba, self.config)
        altered = self.rgba.copy()
        altered[3, 4, 0] += 1
        session.prepare_foreground(altered, self.config)
        altered[3, 4, 3] = 0
        session.prepare_foreground(altered, self.config)
        session.prepare_foreground(self.rgba, {"fixture": "changed"})
        with patch.object(stages.importlib.metadata, "version", return_value="dependency-changed"):
            with self.assertRaisesRegex(ValueError, "implementation/dependency changed"):
                session.prepare_foreground(self.rgba, self.config)
        self.assertEqual(session.measurements()["calls"]["cpB"], 4)
        self.assertTrue(all(not row["cacheHit"] for row in session.measurements()["events"]))

    def test_selection_source_request_changes_preserve_only_compatible_baseline(self):
        revision = [1]

        def identity(stage):
            return {"stage": stage, "revision": revision[0] if stage == "selection" else 0}

        def select(rgba, old, pixels, config, request):
            return old.copy(), pixels.copy(), {"request": request, "revision": revision[0]}

        with patch.object(stages, "_implementation_identity", side_effect=identity), \
                patch.object(stages, "_IMPORT_IMPLEMENTATIONS", {stage: identity(stage) for stage in ("baseline", "selection")}), \
                patch("practical_selection.rebuild_regions", side_effect=select):
            session = stages.PreviewStages()
            first = session.selection(self.rgba, self.config, {"referencePalette": None})
            second = session.selection(self.rgba, self.config, {"referencePalette": None})
            self.assertEqual(first["key"], second["key"])
            fourth = session.selection(self.rgba, self.config, {"referencePalette": [[1, 2, 3]]})
            self.assertNotEqual(second["key"], fourth["key"])
            revision[0] = 2
            with self.assertRaisesRegex(ValueError, "implementation/dependency changed"):
                session.selection(self.rgba, self.config, {"referencePalette": None})
            with self.assertRaisesRegex(ValueError, "fresh development worker process"):
                stages.PreviewStages().selection(self.rgba, self.config, {"referencePalette": None})
            session.prepare_foreground(self.rgba, self.config)
            self.assertEqual(session.measurements()["calls"]["cpB"], 1)
            self.assertEqual(session.measurements()["calls"]["selection"], 2)

    def test_source_change_during_compute_is_rejected_before_cache_write(self):
        revision = [1]

        def identity(stage):
            return {"stage": stage, "revision": revision[0]}

        def changed_during_compute(*args):
            revision[0] = 2
            return self.rgba.copy(), [{"regionId": 1}]

        with patch.object(stages, "_implementation_identity", side_effect=identity), \
                patch.object(stages, "_IMPORT_IMPLEMENTATIONS", {stage: identity(stage) for stage in ("baseline", "selection")}), \
                patch.object(stages.kernel, "apply_representatives", side_effect=changed_during_compute):
            session = stages.PreviewStages()
            with self.assertRaisesRegex(ValueError, "fresh development worker process"):
                session.prepare_foreground(self.rgba, self.config)
            self.assertEqual(len(session._baseline), 0)

    def test_selection_identity_contains_transitive_helpers(self):
        identity = stages._implementation_identity("selection")
        paths = identity["sourceLfUtf8Sha256"]
        for filename in ("practical_selection.py", "layered_selection.py", "design_color_regions.py", "quality_fragments.py"):
            self.assertIn("algorithm-v1/" + filename, paths)
        self.assertIn("dependencies", identity)
        self.assertIn("python", identity)

    def test_selector_receives_detached_normalized_arrays_and_hit_is_detached(self):
        session = stages.PreviewStages()

        def select(rgba, old, pixels, config, request):
            old[3, 4] = 2
            return old, pixels, {"count": 2}

        with patch("practical_selection.rebuild_regions", side_effect=select):
            selected = session.selection(self.rgba, self.config, {})
            selected["report"]["count"] = 99
            selected["structural"][:] = 99
            again = session.selection(self.rgba, self.config, {})
            self.assertEqual(again["report"]["count"], 2)
            self.assertEqual(int(again["structural"].max()), 2)
            baseline = session.prepare_foreground(self.rgba, self.config)
            self.assertEqual(int(baseline["structural"].max()), 1)

    def test_invalid_array_types_and_empty_frames_are_rejected(self):
        session = stages.PreviewStages()
        for invalid in (self.rgba.astype(float), self.rgba[..., :3], np.zeros((0, 2, 4), np.uint8)):
            with self.subTest(shape=invalid.shape), self.assertRaises(ValueError):
                session.prepare_foreground(invalid, self.config)

    def test_fixed_candidate_ranking_revalidates_wrong_sources_even_with_pass(self):
        observed = [{"polygon": box(0, 0, 12, 12), "componentId": "c1", "regionId": "r1",
                     "colorSlotId": "red", "rgb": [170, 50, 30],
                     "boundaryProvenance": {"selectedVectorArtifactId": "selected", "edgeIds": ["e1"]}}]
        session = stages.PreviewStages()
        completed = session.complete(observed)
        self.assertEqual(completed["status"], stages.STATUS)
        ranked = session.rank(observed, completed["plans"])
        self.assertEqual(ranked["status"], stages.STATUS)
        broken = copy.deepcopy(ranked["plans"])
        broken[0]["pieces"][0]["sourceComponentIds"] = ["wrong-source"]
        broken[0]["geometryChecks"] = {"sourceBinding": "PASS"}
        with self.assertRaises(LayeredPlanError):
            session.rank(observed, broken)
        self.assertEqual(session.measurements()["calls"]["ranking"], 2)


if __name__ == "__main__":
    unittest.main()
