# Project-real B2 GT Review Pack V2

Status: `PROJECT_REAL_B2_GT_PACK_V2_READY_FOR_EXTERNAL_REVIEW`

GT Pack V1 status: `AUDIT_SAMPLE_ONLY`. Its 40 cards remain an audit sample only.

V2 is a bucketed, non-random, non-exhaustive review set. It does not support population estimates over the 1180 V0 Pieces. No candidate is Ground Truth or an automatic merge/stacking/completion decision.

| Fixture | Total | Same region | Same surface color split | Contained overlay | Direct fill/fill | Stroke-mediated | Stroke control | Sheet |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| FLD-002 | 14 | 1 | 2 | 1 | 2 | 6 | 2 | [FLD-002 V2](FLD-002_REVIEW_V2.png) |
| FLD-003 | 13 | 1 | 0 | 8 | 4 | 0 | 0 | [FLD-003 V2](FLD-003_REVIEW_V2.png) |
| FLD-004 | 14 | 0 | 3 | 3 | 0 | 6 | 2 | [FLD-004 V2](FLD-004_REVIEW_V2.png) |
| FLD-006 | 10 | 0 | 3 | 5 | 0 | 0 | 2 | [FLD-006 V2](FLD-006_REVIEW_V2.png) |
| FLD-008 | 16 | 2 | 2 | 0 | 4 | 6 | 2 | [FLD-008 V2](FLD-008_REVIEW_V2.png) |

## Candidate selection audit

Each review JSON records discovered counts, selected counts, bucket caps, exact piece-set deduplication, and the bounded stroke-control check. `STROKE_STRESS_CONTROL` is capped at two per Fixture.

`STROKE_MEDIATED_FILL_FILL_ADJACENCY` means an actual Frozen graph path `Fill A -> stroke-like Region -> Fill B`; it is candidate-discovery evidence only and does not alter Region geometry or create a semantic relationship.

## Reviewer questions

1. Same physical Piece? `YES / NO / AMBIGUOUS / NOT_APPLICABLE`
2. Hidden continuous area? `YES / NO / AMBIGUOUS / NOT_APPLICABLE`
3. Stacking? `A_ABOVE_B / B_ABOVE_A / AMBIGUOUS / NOT_APPLICABLE`
4. Hidden geometry needed? `REQUIRED / OPTIONAL / NOT_REQUIRED / AMBIGUOUS`
5. Multiple acceptable decompositions? `YES / NO`
6. Fabrication role per Piece? `BASE_FILL / OVERLAY_FILL / STROKE_DETAIL / UNKNOWN`

All answers and fabrication roles are null. B2-V1 remains paused.
