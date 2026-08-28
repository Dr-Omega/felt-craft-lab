from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

POC_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(POC_ROOT / "src"))

from vector_contract import canonical_json_bytes, sha256, write_json


class VectorContractTests(unittest.TestCase):
    def test_float_and_key_serialization_is_stable(self):
        first = canonical_json_bytes({"z": -0.0, "a": 1.123456789123})
        second = canonical_json_bytes({"a": 1.123456789, "z": 0.0})
        self.assertEqual(first, second)

    def test_manifest_excludes_production_and_b2_semantics(self):
        manifest = json.loads((POC_ROOT / "manifest.v1.json").read_text(encoding="utf-8"))
        payload = json.dumps(manifest)
        for forbidden in ("materialPalette", "pieceGraph", "stacking", "productionPromotion"):
            self.assertNotIn(forbidden, payload)
        self.assertEqual(manifest["geometryInput"], "structural_label_map")

    def test_artifact_sha_is_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.json", Path(directory) / "second.json"
            write_json(first, {"b": 2, "a": 1})
            write_json(second, {"a": 1, "b": 2})
            self.assertEqual(sha256(first), sha256(second))

    def test_text_artifact_sha_ignores_checkout_line_endings(self):
        with tempfile.TemporaryDirectory() as directory:
            lf, crlf = Path(directory) / "lf.json", Path(directory) / "crlf.json"
            lf.write_bytes(b'{\n  "value": 1\n}\n')
            crlf.write_bytes(b'{\r\n  "value": 1\r\n}\r\n')
            self.assertEqual(sha256(lf), sha256(crlf))

    def test_complete_evidence_results_record_required_complexity_and_safety_metrics(self):
        result = json.loads(
            (POC_ROOT / "outputs" / "cp-b-aggressive_rc-a" / "FLD-001" / "V2" / "tol-1p0" / "result.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertIn("outputVertexCount", result["metrics"]["complexity"])
        self.assertIn("selfIntersectionCount", result["metrics"]["safety"])
        self.assertIn("interEdgeIllegalIntersectionCount", result["metrics"]["safety"])


if __name__ == "__main__":
    unittest.main()
