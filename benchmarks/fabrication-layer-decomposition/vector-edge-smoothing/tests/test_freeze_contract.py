from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

POC_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = POC_ROOT.parent / "tools"
sys.path.insert(0, str(TOOLS_ROOT))

from validate_vector_edge_smoothing_freeze import FALLBACK_LADDER, validate_freeze


class FreezeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.freeze = json.loads((POC_ROOT / "freeze.v1.json").read_text(encoding="utf-8"))

    def _validate_mutation(self, mutation) -> list[str]:
        value = copy.deepcopy(self.freeze)
        mutation(value)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "freeze.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return validate_freeze(path)

    def test_frozen_manifest_and_all_evidence_validate(self):
        self.assertEqual(validate_freeze(), [])

    def test_freeze_schema_declares_locked_route_and_tolerance(self):
        schema = json.loads((POC_ROOT / "schemas" / "freeze.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["properties"]["primaryRoute"]["const"], "V2_SMOOTH_BEZIER")
        tolerance = schema["properties"]["defaultTolerance"]["properties"]
        self.assertEqual(tolerance["value"]["const"], 0.5)
        self.assertEqual(tolerance["unit"]["const"], "source_pixel")
        self.assertEqual(tolerance["coordinateSystem"]["const"], "structural_label_map")

    def test_primary_route_and_strict_fallback_ladder_are_locked(self):
        self.assertEqual(self.freeze["primaryRoute"], "V2_SMOOTH_BEZIER")
        self.assertEqual(self.freeze["fallbackLadder"], FALLBACK_LADDER)
        errors = self._validate_mutation(lambda value: value.update(primaryRoute="V1_SIMPLIFIED_POLYGON"))
        self.assertTrue(any("primaryRoute" in error for error in errors))
        errors = self._validate_mutation(lambda value: value.update(fallbackLadder=list(reversed(FALLBACK_LADDER))))
        self.assertTrue(any("fallback ladder" in error for error in errors))

    def test_default_is_exactly_0_5_source_pixel_in_structural_coordinates(self):
        self.assertEqual(self.freeze["defaultTolerance"], {"value": 0.5, "unit": "source_pixel", "coordinateSystem": "structural_label_map", "display": "0.5 source pixel", "resolutionNormalization": "NOT_DEFINED_REQUIRES_REVALIDATION"})
        for key, invalid in (("value", 1.0), ("unit", "screen_pixel"), ("coordinateSystem", "rendered_canvas")):
            errors = self._validate_mutation(lambda value, key=key, invalid=invalid: value["defaultTolerance"].update({key: invalid}))
            self.assertTrue(any("default tolerance" in error for error in errors))

    def test_benchmark_alternatives_cannot_become_default(self):
        self.assertEqual(self.freeze["routeDisposition"]["V2_1_SOURCE_PIXEL"], "BENCHMARK_ONLY")
        self.assertEqual(self.freeze["routeDisposition"]["V2_2_SOURCE_PIXELS"], "BENCHMARK_FUTURE_EXPERIMENT_ONLY")
        errors = self._validate_mutation(lambda value: value["defaultTolerance"].update(value=2.0, display="2.0 source pixels"))
        self.assertTrue(any("default tolerance" in error for error in errors))

    def test_known_sha_mismatch_fails_closed(self):
        errors = self._validate_mutation(lambda value: value["evidence"].update(routeArtifactAggregateSha256="0" * 64))
        self.assertTrue(any("routeArtifactAggregateSha256" in error for error in errors))

    def test_production_integration_remains_false(self):
        errors = self._validate_mutation(lambda value: value.update(productionIntegration=True))
        self.assertTrue(any("production integration" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
