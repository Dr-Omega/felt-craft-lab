# M3-C1 Ground-Truth Authoring and Signoff Guide

This guide applies only to project-real candidate intake. A candidate is not a formal acceptance case until an authorized human reviewer signs its GT. Formal promotion targets `background-removal.acceptance-dataset/2` only.

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

Run `build_gt_review_pack.py` after the source, GT, and candidate metadata are ready. It writes `review-identity.json`; an authorized human may then create `gt-review.json`, copying the three reviewed-byte hashes exactly. The tool never creates an approval or signoff itself.

Before explicit promotion, the candidate must have `gt-review.json` containing at least:

```json
{
  "state": "APPROVED",
  "signoff": "SIGNED_OFF",
  "reviewerRole": "PROJECT_DATASET_REVIEWER",
  "reviewedSourceSha256": "<SHA-256 from review-identity.json>",
  "reviewedGroundTruthSha256": "<SHA-256 from review-identity.json>",
  "reviewedCandidateMetadataSha256": "<SHA-256 from review-identity.json>"
}
```

The candidate must also have `rightsStatus: "CLEARED_FOR_PROJECT_EVAL"`, `backgroundRemovalSuitability: "SUITABLE"`, `lineageStatus: "CONFIRMED"`, and a non-empty stable `sourceLineageId`. `provisional:`, `temporary:`, and `temp:` lineage prefixes are never promotable, regardless of case. The only promotable source origins are `PROJECT_FIXTURE`, `PROJECT_GENERATED_ASSET`, and `PROJECT_USER_ASSET`; any other or unknown value fails closed.

Sources with alpha must have every alpha value equal to `255`; RGB/no-alpha sources are allowed. The human reviewer must set `primaryCoverageSlot` in `candidate.json` to exactly one of `slot-01` through `slot-15`; inventory coverage hints are never formal slot truth. Promotion re-hashes all three reviewed inputs and rejects any byte drift. It also verifies source opacity, dimensions, binary GT, path-safe `BR-###` case ID, unique confirmed lineage, v2 manifest identity, and the human-confirmed slot before writing anything.

## Final evidence and promotion semantics

Promotion copies the signed human `gt-review.json` into the final case as `cases/BR-XXX/gt-review.json`. The v2 manifest records its relative path and SHA-256 under `groundTruthReview.evidence`; this is the evidence chain that the R3 formal loader revalidates. `case.json` remains case metadata only.

Promotion performs exception-level rollback across its case and manifest replacements: if a catchable manifest replacement failure occurs after a case move, it removes the newly moved case and cleans temporary artifacts while preserving the original manifest bytes. This does not claim crash- or power-loss-level cross-file atomicity.

Promotion never changes `acceptance-freeze.json`. A formal dataset change naturally invalidates the existing freeze; a separately reviewed later stage owns any dataset/freeze rotation.
