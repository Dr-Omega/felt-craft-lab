# M3-C1 Ground-Truth Authoring and Signoff Guide

This guide applies only to project-real candidate intake. A candidate is not a formal acceptance case until an authorized human reviewer signs its GT.

## Binary foreground contract

- `255` means the complete intended subject must be retained.
- `0` means background must be removed.
- The delivered `draft_ground_truth.png` must be strictly binary: no antialiased or intermediate alpha/gray values.
- Source and GT dimensions must match exactly.

## Human visual decisions

- Decide whether a shadow belongs to the subject according to the project’s visual intent; record the decision in candidate notes.
- Define an explicit boundary for glow, halo, and soft edges rather than leaving semitransparent mask values.
- Preserve genuine internal holes as `0`.
- When a case requires multiple subjects, mark every required subject as `255`.
- Do not remove small critical structures merely because they are difficult to annotate.

## Prohibited shortcuts

- Do not use a benchmarked model output as the GT.
- An automatic segmentation tool may assist with a `DRAFT`, but never supplies approval or signoff.
- Do not copy candidate data into `cases/BR-*` or `acceptance-dataset.json` before review.

## Required review evidence

Before explicit promotion, the candidate must have `gt-review.json` with exactly:

```json
{
  "state": "APPROVED",
  "signoff": "SIGNED_OFF",
  "reviewerRole": "PROJECT_DATASET_REVIEWER"
}
```

The candidate must also have `rightsStatus: "CLEARED_FOR_PROJECT_EVAL"`. The promotion tool verifies both conditions, image dimensions, binary GT, unique source lineage, and manifest identity before writing anything.
