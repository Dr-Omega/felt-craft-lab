# Located visual observations — not human sign-off

Fixed inputs and the approved aggressive profile are unchanged. Coordinates are
source-image XY, origin at top left. The accompanying `overview.html` embeds the
actual input/purified/label/vector/exposure/Piece/seam/rerender PNGs, with matching
nearest-neighbour crops. No image was synthesized or substituted. Numerical
records are in `visual-measurements.json`; all candidate comparisons remain in
the case evidence. These are executor observations, not an independent audit.

## Facts and located issues

| Case / location or Component | Earliest located stage | Before / after evidence and fact | Possible cause and impact | Next step, separately authorized if algorithm changes |
|---|---|---|---|---|
| Crescent `(429,537)`, `R00001-C002`; crop XY `(419,527)`, 32×32 | Fixed foreground input already has a one-pixel alpha island | Input RGBA `[231,228,237,255]`; purified `[3,3,3,255]`. Input and threshold-connected area are both 1 pixel. Alpha is unchanged. | The isolated domain predates M7; representative color then changes in M4. Whether this is unwanted input residue cannot be proved without upstream acquisition evidence. | Inspect upstream foreground provenance for this coordinate; do not silently delete the island or treat this batch as a background-removal evaluation. |
| Crescent `(406,274)`, `R00003-C001`; crop `(396,264)`, 32×32 | M4 CP-B label partition / Region Component derivation | One-pixel Component inside a 110,004-pixel input alpha domain; input and purified RGB both `[206,210,195]`. It is not an isolated input alpha island. | Exact edge color remains a separate label. Potential visual oversegmentation requires human confirmation; it is not a new M7 split. | A separate boundary-local CP-B experiment could study adjacent-label decisions while protecting true edges/thin features. No global same-color merge or micro-piece deletion is enabled here. |
| Crescent bbox `(504,280,5,3)`, `R00004-C001`; crop `(496,272)`, 32×32 | M4 label partition, then representative assignment | Area 9; sample `(508,280)` changes RGB `[205,204,199]` → `[253,248,239]`, inside the same large alpha domain. | Local color/representative decisions, rather than Base search, explain this located small colored fragment. Exact causal parameter attribution remains untested. | Isolate proposal labels versus RC-A representatives in a separate experiment, with source-edge and color-error comparisons; do not modify the frozen kernels in this batch. |
| Envelope `(84,16)` `R00002-C001`, `(9,44)` `R00005-C001`, `(237,728)` `R00012-C001`; crops `(64,0)`, `(0,32)`, `(224,704)`, each 32×32 | M4 labels inside one input foreground domain | Respective areas 3, 1, 6 pixels; all belong to the original 408,892-pixel alpha domain. Example `(84,16)` RGB `[224,223,221]` → `[198,197,195]`. | Small boundary-color partitions remain despite an apparently simple icon. Not caused by low-alpha thresholds or M7 seams in this case. | Review edge colors and local grouping under a separately scoped experiment, with thin black-border preservation as an explicit risk. |
| Mooncake central ellipse, `R00008-C001`, Piece 1/2; crops `(464,370)` and `(464,450)`, 64×64 | M7 physical splitting of a holed VISIBLE domain | Two real seams at `x=496`, `y=381..400` and `y=452..469` cross the central ellipse's upper/lower band; lengths 19 and 17 canonical source units. | Solid-piece construction preserves geometry but cuts a visually salient ring. A zero-difference rerender does not judge the desirability of the physical seam. | Blindly compare the existing x/y candidates before proposing any new visual seam penalty. Such a penalty changes the approved objective and is NOT implemented here. |
| Mooncake label text near `(500,454)` | Diagnostic PNG annotation, not algorithm labels | The visible `R00003` text lies near the ellipse, but direct NPZ lookup at `(500,454)` is label 8, RGB `[232,185,130]`. | Original label text uses independent X/Y medians, which need not lie inside the region. Text location can mislead reviewers. | This batch's overview explicitly warns about text anchors and supplies actual point/Component tables. Original PNGs are preserved so equivalence remains auditable. |
| Synthetic diagonal/fringe `(31,0)` and the diagonal junction `(13,13)/(14,14)` | Input alpha and frozen structural-domain convention | One pixel has alpha 12, below threshold 64, remains unassigned; alpha itself is unchanged. Alpha-positive domains: 3 under four-neighbour connectivity, 2 under eight-neighbour; structural domains: 2. | Demonstrates a real low-alpha/structure difference, unlike the three real cases. Diagonal contact does not authorize an invented bridge. | Keep this as an adversarial control, not a reason to change connectivity or thresholds. |
| Synthetic ring / `BASE/body-1` | M7 solid decomposition | One actual Base parent requires splitting into two Base Pieces; two SplitGroups total, including the visible ring. | This is genuinely new splitting, unlike the crescent's 52 disconnected Base parents. | Retain as the hole/seam completeness control; no repair or manufacturing inference. |

## Counts are evidence, not quality verdicts

| Case | Input alpha components 4 / 8-neighbour | Alpha below 64 but above 0 | M4 Regions / Components | Exact ColorSlots / experimental groups | BASE / VISIBLE | Actual Base parents / split Base parents |
|---|---:|---:|---:|---:|---:|---:|
| Crescent | 52 / 20 | 0 | 108 / 155 | 94 / 23 | 52 / 103 | 52 / 0 |
| Envelope | 1 / 1 | 0 | 13 / 18 | 13 / 6 | 1 / 17 | 1 / 0 |
| Mooncake | 1 / 1 | 0 | 18 / 25 | 14 / 4 | 1 / 26 | 1 / 0 |
| Synthetic ring | 1 / 1 | 0 | 2 / 2 | 2 / 2 | 2 / 2 | 1 / 1 |
| Synthetic diagonal/fringe | 3 / 2 | 1 | 1 / 2 | 1 / 1 | 2 / 0 | 2 / 0 |

For the three real cases the structural mask is exactly the alpha≥64 mask;
there is no observed low-alpha explanation for their fragments. Of the
crescent's 153 Components of area≤16, 51 lie in pre-existing tiny alpha islands
and 102 are label partitions within the large connected input domain. These are
localization categories, not proof that every small Component is undesirable.
Experimental groups are not interchangeable with exact ColorSlots: the 94→23,
13→6 and 14→4 counts cannot authorize merging disconnected geometry or changing
exact RGB identity. Their visual closeness does not establish manufacturing
interchangeability.

## Existing legal alternatives, no objective changes

The mooncake selected `m7-plan-c46be0c801914053`: Base `RGB-FDF9CA`, x-axis,
27 Pieces, 8 physical seam records, length 172.5. The legal y-axis alternative
`m7-plan-21f1337e09837be0` has the same Base, 27 Pieces and 8 seam records but
length 178.0. Changing the Base to `RGB-E3B07B` (x-axis,
`m7-plan-8624d60a36b1f8a1`) yields 31 Pieces / 18 seam records / length 1126.140625.
The candidate set, scores, ranking and selected result were not changed here.
We have not rendered every alternative or established that the y-axis candidate
is visually preferable; that remains a located follow-up experiment.

Proposed follow-ups must compare the fixed snapshots and synthetic controls,
predeclare thin-edge/hole/color/coverage risks and collect blind manual crop
reviews. They must not tune on formal holdouts, silently enable Region Repair,
globally merge equal colors, delete small pieces, or alter this audit candidate.

INDEPENDENT_FINAL_AUDIT=PENDING
VISUAL_QUALITY=PENDING_MANUAL_REVIEW
MANUFACTURING=NOT_EVALUATED
PRODUCTION_EXPORT_ELIGIBLE=NO
