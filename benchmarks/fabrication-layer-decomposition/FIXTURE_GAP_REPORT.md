# Fixture Gap Report — P0-04B0

## Audited project-real fixtures obtained

Eight existing files from `assets/generated/material/snapshot_ywn_20260805_112922/` were copied unchanged. Each source was inspected as a decodable RGBA PNG with non-trivial transparency and a single sticker-like subject. Their per-fixture original path and selection rationale are frozen in `benchmark_manifest.json`.

- G01 simple flat: FLD-001 crescent, FLD-008 lantern
- G03 same-color multi-component: FLD-004 flower lantern
- G04 similar-color distinct region: FLD-003 mooncake, FLD-004 flower lantern
- G05 internal overlay: FLD-002 envelope, FLD-006 rabbit, FLD-008 lantern
- G06 multi-level overlay: FLD-002 envelope, FLD-003 mooncake, FLD-004 flower lantern
- G07 global void: FLD-007 window flower
- G08 thin feature: FLD-005 firecracker, FLD-007 window flower
- G09 multi-subshape: FLD-005 firecracker, FLD-006 rabbit, FLD-008 lantern
- G10 hard ambiguous: FLD-006 rabbit (near-white foreground and contour/detail ambiguity)

## Confirmed gaps

1. **G02_AI_COLOR_DRIFT is absent.** No audited project-real candidate was verified to contain meaningful same-region AI near-color drift while remaining a transparent, single-subject upstream-domain image. Do not label a flat asset as drift merely to fill this bucket.
2. The initial collection has 8 fixtures, below the intended roughly-20 fixture long-term set.
3. There is only one global-void fixture and one primarily thin-feature fixture; additional diverse examples reduce overfitting to their current geometry.

## Requested additions

- 3–5 real generated core-pattern PNGs with transparent alpha where one intended local region visibly drifts among close RGB/Lab colors (for G02).
- 2 transparent single-subject examples with true closed holes of different size/placement (for G07).
- 2 examples where two visually similar colors must remain separate for fabrication intent (for G04), preferably without heavy texture.
- 5–8 further project-real, one-subject RGBA images with simple outlines and documented source path to approach the 20-fixture goal.

Do not supply screenshots, full scenes/backgrounds, or auto-generated random charts as project-real fixtures. Synthetic unit images, if later necessary, must be explicitly `fixtureType: synthetic_unit` and reported separately.
