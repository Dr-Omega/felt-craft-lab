# Project-real B2 GT Review Pack

Status: `PROJECT_REAL_B2_GT_PACK_READY_FOR_EXTERNAL_REVIEW`

All candidates are review-only. No candidate is Ground Truth, CONFIRMED, merged, stacked, or completed by this tool.

| Fixture | Candidates | Review sheet | Review JSON | GT draft |
|---|---:|---|---|---|
| FLD-002 | 8 | [FLD-002 sheet](FLD-002_REVIEW.png) | [FLD-002 review](FLD-002.review.json) | [FLD-002 draft](FLD-002.gt-draft.json) |
| FLD-003 | 8 | [FLD-003 sheet](FLD-003_REVIEW.png) | [FLD-003 review](FLD-003.review.json) | [FLD-003 draft](FLD-003.gt-draft.json) |
| FLD-004 | 8 | [FLD-004 sheet](FLD-004_REVIEW.png) | [FLD-004 review](FLD-004.review.json) | [FLD-004 draft](FLD-004.gt-draft.json) |
| FLD-006 | 8 | [FLD-006 sheet](FLD-006_REVIEW.png) | [FLD-006 review](FLD-006.review.json) | [FLD-006 draft](FLD-006.gt-draft.json) |
| FLD-008 | 8 | [FLD-008 sheet](FLD-008_REVIEW.png) | [FLD-008 review](FLD-008.review.json) | [FLD-008 draft](FLD-008.gt-draft.json) |

## Reviewer questions

Each candidate has a card under `cards/`.

1. Do the observed components belong to one physical Fabrication Piece? `YES / NO / AMBIGUOUS`
2. If yes, is there a hidden continuous area between them? `YES / NO / AMBIGUOUS`
3. If occluded, which piece is above? `A_ABOVE_B / B_ABOVE_A / AMBIGUOUS`
4. Is hidden geometry required for fabrication? `REQUIRED / OPTIONAL / NOT_REQUIRED / AMBIGUOUS`
5. Are multiple decompositions equally acceptable? `YES / NO`

Post-review distribution fields remain null in `POST_REVIEW_DISTRIBUTION.json`. Do not start B2-V1 until these answers are reviewed and the distribution is measured.
