# P0-04B2 V0 Observed-only Baseline

Status: `B2_V0_REVALIDATED_ON_REPAIRED_BASELINE`

`B2_V0_STATUS=VALIDATED_BASELINE`

`B2_FULL_UPSTREAM_BASELINE=90a92ae1853ce07308238a70f9301fa148821b66`

Every Frozen 4-connected component is consumed exactly once by a separately identified Fabrication Piece. No hidden geometry, boundary mutation, geometry merge, Color Layer, Material, Repair, or z-order inference is present.

| Fixture | Applicability | Regions | Components | Pieces | Inner rings | Frozen fallback edges | V0 Gate |
|---|---|---:|---:|---:|---:|---:|---|
| FLD-001 | B2_LIMITED | 108 | 155 | 155 | 1 | 80 | PASS |
| FLD-002 | B2_HIGH_VALUE | 13 | 18 | 18 | 3 | 35 | PASS |
| FLD-003 | B2_HIGH_VALUE | 18 | 25 | 25 | 16 | 49 | PASS |
| FLD-004 | B2_HIGH_VALUE | 330 | 597 | 597 | 13 | 246 | PASS |
| FLD-005 | B2_LIMITED | 68 | 84 | 84 | 4 | 30 | PASS |
| FLD-006 | B2_HIGH_VALUE | 28 | 36 | 36 | 9 | 35 | PASS |
| FLD-007 | B2_LIMITED | 104 | 167 | 167 | 8 | 137 | PASS |
| FLD-008 | B2_HIGH_VALUE | 38 | 98 | 98 | 4 | 131 | PASS |

## Dataset gap and V1 readiness

Current fixtures contain useful overlap candidates, but there is no project-real piece identity, hidden-contour, or human-authored overlap partial-order GT. The result is `DATASET_GAP`; B2-V1 is `BLOCKED_PROJECT_REAL_B2_GT` and was not started.
