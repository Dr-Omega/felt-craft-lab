from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "region-core" / "src"), str(ROOT / "tools")]

from frozen_contract import (  # noqa: E402
    BALANCED_REGRESSION_PROFILE,
    CASE_IDS,
    PRIMARY_FROZEN_PROFILE,
    RegionCoreError,
    assert_no_forbidden_keys,
    four_connected_components,
    perimeter_and_adjacency,
    rc_a_representative,
)
from validate_region_core_freeze import matrix_errors  # noqa: E402
from region_core import artifact_identity_mode, artifact_size, sha256  # noqa: E402


class FrozenArtifactIdentityTests(unittest.TestCase):
    def test_text_identity_is_checkout_line_ending_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            lf = Path(directory) / "lf.json"
            crlf = Path(directory) / "crlf.json"
            lf.write_bytes(b'{\n  "value": 1\n}\n')
            crlf.write_bytes(b'{\r\n  "value": 1\r\n}\r\n')
            self.assertEqual(artifact_identity_mode(lf), "GIT_BLOB_CANONICAL_LF")
            self.assertEqual(sha256(lf), sha256(crlf))
            self.assertEqual(artifact_size(lf), artifact_size(crlf))

    def test_binary_identity_remains_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.npz"
            second = Path(directory) / "second.npz"
            first.write_bytes(b"a\r\nb")
            second.write_bytes(b"a\nb")
            self.assertEqual(artifact_identity_mode(first), "EXACT_BYTES")
            self.assertNotEqual(sha256(first), sha256(second))


class FrozenComponentTests(unittest.TestCase):
    def test_one_region_may_have_multiple_four_connected_components(self):
        labels = np.array([[1, 0, 1], [0, 1, 0]], dtype=np.int32)
        components = four_connected_components(labels)[1]
        self.assertEqual(len(components), 3)
        self.assertEqual(sum(item["area"] for item in components), 3)
        self.assertEqual([item["bbox"] for item in components], [[0, 0, 1, 1], [2, 0, 1, 1], [1, 1, 1, 1]])

    def test_components_cover_region_and_are_deterministic(self):
        labels = np.array([[1, 1, 0], [0, 0, 0], [1, 1, 1]], dtype=np.int32)
        first = four_connected_components(labels)
        second = four_connected_components(labels)
        self.assertEqual(first, second)
        self.assertEqual(sum(item["area"] for item in first[1]), int(np.count_nonzero(labels == 1)))

    def test_adjacency_uses_unique_four_connected_grid_edges(self):
        labels = np.array([[1, 2], [1, 2]], dtype=np.int32)
        perimeter, adjacency = perimeter_and_adjacency(labels)
        self.assertEqual(perimeter, {1: 6, 2: 6})
        self.assertEqual(adjacency, [{"regionA": 1, "regionB": 2, "uniqueSharedEdgeCount": 2, "sharedBoundaryCoverage": 0.33333333}])

    def test_diagonal_touch_is_not_adjacency(self):
        labels = np.array([[1, 0], [0, 2]], dtype=np.int32)
        _, adjacency = perimeter_and_adjacency(labels)
        self.assertEqual(adjacency, [])


class FrozenRepresentativeTests(unittest.TestCase):
    def test_rc_a_is_byte_deterministic(self):
        rgba = np.zeros((3, 3, 4), dtype=np.uint8)
        rgba[..., :3] = [120, 80, 40]
        rgba[..., 3] = 255
        mask = np.ones((3, 3), dtype=bool)
        config = {"coreAlphaMin": 1, "coreDistancePx": 0}
        self.assertEqual(rc_a_representative(rgba, mask, config), rc_a_representative(rgba, mask, config))

    def test_forbidden_repair_and_color_group_keys_fail_closed(self):
        for key in ("repairPolicy", "SAFE_MERGE", "appearance_label_map", "colorGroupId", "material", "piece", "layer", "vector"):
            with self.subTest(key=key), self.assertRaises(RegionCoreError):
                assert_no_forbidden_keys({key: "forbidden"})


class FrozenMatrixTests(unittest.TestCase):
    @staticmethod
    def rows(profile: str, primary: bool) -> list[dict[str, object]]:
        return [
            {"fixtureId": fixture_id, "profile": profile, **({"contract": {}} if primary else {"status": "REGRESSION_EVIDENCE_ONLY"})}
            for fixture_id in CASE_IDS
        ]

    def test_exact_primary_matrix_passes(self):
        self.assertEqual(matrix_errors(self.rows(PRIMARY_FROZEN_PROFILE, True), PRIMARY_FROZEN_PROFILE, contract_key="contract"), [])

    def test_zero_matrix_is_hard_failure(self):
        self.assertTrue(matrix_errors([], PRIMARY_FROZEN_PROFILE, contract_key="contract"))

    def test_missing_extra_wrong_case_and_wrong_profile_fail(self):
        valid = self.rows(PRIMARY_FROZEN_PROFILE, True)
        variants = [valid[:-1], valid + [copy.deepcopy(valid[0])], copy.deepcopy(valid), copy.deepcopy(valid)]
        variants[2][0]["fixtureId"] = "FLD-999"
        variants[3][0]["profile"] = BALANCED_REGRESSION_PROFILE
        for rows in variants:
            with self.subTest(rows=len(rows)):
                self.assertTrue(matrix_errors(rows, PRIMARY_FROZEN_PROFILE, contract_key="contract"))

    def test_exact_balanced_regression_matrix_passes(self):
        rows = self.rows(BALANCED_REGRESSION_PROFILE, False)
        self.assertEqual(matrix_errors(rows, BALANCED_REGRESSION_PROFILE, contract_key=None), [])


if __name__ == "__main__":
    unittest.main()
