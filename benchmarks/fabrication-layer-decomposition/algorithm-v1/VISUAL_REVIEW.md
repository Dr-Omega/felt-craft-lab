# Development visual inspection — not human acceptance

The agent inspected actual input, purified, selected-vector and final geometry
images from the three existing project development sources below. They are
read-only reuse of `fixtures/source/FLD-001.png` through `FLD-003.png`, not newly
collected holdout data. No GT, review signature or frozen output was changed.
All runs use the existing `aggressive` profile without tuning. Coordinates
below refer to source pixels; these are located observations, not calibrated
manufacturing thresholds.

## Crescent (FLD-001)

The yellow body, black outline and curved open interior remain recognizable;
the tips and curved outline are retained by the selected vector domain. The
output still contains many tiny positive-area edge islands: 108 Regions, 155
Components and 94 exact ColorSlots. The original whole-foreground 8-connected
statistic is 20, which is deliberately not reported as the Component count.
106 Regions are below the existing pixel small-region diagnostic threshold,
with median Region area one pixel. This is a difficult, visually pending case,
not a claim that 155 pieces are child-appropriate. M7 preserves these positive
domains and does not silently remove them or connect them with a Base bridge.
The candidate has both BASE and VISIBLE pieces and no required solid split.

## Envelope (FLD-002, 591 × 737)

The red rectangular body, bowed flap boundary and yellow circular seal near
(297, 275) are preserved. The bottom corners and thick black contour remain.
Purification removes the original red texture/gradient; staircase details are
visible around the curved seal and flap. This is a real visual change, not a
quality PASS. The resulting 18 Components map to 18 final pieces without added
seams. The pure selected-vector render and final Piece render agree; this says
nothing about whether the user prefers the flattened colors or edge treatment.

## Mooncake (FLD-003, 1024 × 1024)

The scalloped perimeter, central oval around (496, 426), radial decorative
strokes and lower side panels remain. Cream/gold variations become flatter;
the gold outline remains continuous at the diagnostic scale. The 27-piece
candidate includes two actual solid split groups. Eight recorded cuts have
172.5 canonical units of exposed length: two cross the central oval outline
near x=496, while six partition the larger gold structural domain near the
left/right sides and lower scallops. Magenta lines in `added-seams.png` show
the actual recorded seam locations; these are not all hidden or zero cost.
Their acceptability and the thin outline's cuttability remain unassessed.

## Targeted and layered development inputs

- Ring with an inner different color and a central global hole: the other-color
  inner region remains colored; the true central hole remains transparent.
  Four physical seam records (including Base seams), two deduplicated seam
  polylines, 48 canonical length, and exact source conservation are measured.
- Small red ring around a larger blue interior: red Base exposes the ring and
  supports one blue solid piece (2 pieces / 0 seam). Blue Base requires two red
  pieces and two exposed seam segments (3 pieces / 8 canonical length). Three
  distinct legal alternatives are retained. The smaller red source area wins
  on measured seam visibility, not on largest-color area.
- Diagonal touching blocks plus low-alpha fringe: separate 4-connected
  Components are retained; fringe/ORPHAN_FRINGE remain an M4 raster semantic,
  not an invented solid manufacturing domain.
- Genuine generated SVG and PSD: the opaque upper blue object visibly covers
  the uniform red lower object. M6 records the selected source masks, witness
  pixel and original source identity. These are synthetic development sources,
  not project-real layered files. Unsupported PSD blending yields PARTIAL
  evidence and an explicit stopped run, not a successful fabrication result.

## Limits and status

Geometric agreement is measured against the **selected P0-04C vector domain**,
not a false requirement that valid V2 approximation equal V0 pixels. Final
Piece rendering uses persisted geometry, exact ColorSlots and the support
graph. Raw sample differences and exact original-boundary color ties are
separate diagnostics; interior mismatches fail.

There is no established human truth for false merge/split or seam acceptability.
`VISUAL_REVIEW_STATUS=PENDING_MANUAL_REVIEW`, false merge/split and manufacturing
remain NOT_EVALUATED, production export is NO. The many tiny crescent regions
and pixel-scale jaggies deserve review. This inspection does not prove a
specific frozen-kernel defect or authorize a kernel change; no Region Repair,
global color merge, profile retuning or hash replacement is used to hide them.

Actual regenerated pages, per-case runtime, input hashes, result SHA, measured
comparisons and failure details are produced by `run_examples.py` under the
chosen isolated output directory. Re-run those pages for the candidate being
reviewed; do not substitute this narrative for current artifact checks.
