# M7 Base and solid partition strategy v1

This batch introduces an experimental deterministic geometry strategy. It is
not a previously approved manufacturing algorithm or an assertion of human
visual acceptance. Coordinates are canonical/source units, never millimetres.

## Actual input and source preservation

`propose_plans(observed)` receives the actual selected-vector polygons. Each
record has Component and Region identities, an exact ColorSlot/RGB pair, a
single valid positive-area Shapely Polygon, and selected-vector boundary
provenance. Holes are allowed in observed domains. Overlapping source domains,
invalid geometry, missing identities/provenance and inconsistent ColorSlot
identities are rejected. This module does not read raster labels or pixel
contours. The caller records its vector-curve flattening tolerance separately;
M7 introduces no additional approximation or boundary offset.

## Finite Base candidate search

The union of all visible domains determines actual foreground bodies and global
holes. A differently colored inner domain therefore fills a Region interior
ring without becoming a global hole. Point-contact or disconnected bodies stay
separate; there are no connecting bridges. Every exact ColorSlot present in a
body is searched as that body's Base color, with both X and Y splitting
strategies. A Base covers just that connected body's existing foreground shape.
Every source domain of the selected color is represented through explicit Base
exposures. Every other source domain gets its own VISIBLE partition; ordinary
pieces never gain hidden geometry or merge globally by color.

Each body has independent local options. Global proposals include every
uniform-color/axis strategy (with each body's best local option where that
color is absent) and the combination of independent best local options. This
is a bounded finite search rather than an exponential enumeration of all
per-body combinations. Geometrically identical proposals are deduplicated.
Returned IDs depend on actual piece geometry, roles, colors and source
Components; source list order and temporary paths have no effect.

## Solid geometry decomposition

For the first deterministically ordered remaining hole, use its interior
representative point to cut across the entire current polygon on the chosen
axis. Recursively repeat until every resulting cell has no interior rings.
Fail if a cut does not reduce remaining holes. Then repeatedly merge adjacent
cells sharing the longest boundary, only if the union is one valid hole-free
Polygon. Tie breaks use normalized geometry bytes. This merge stays inside one
source domain; it is not Region Repair or cross-Region color merging.

All positive-area pieces survive. No hole filling, buffering, erosion,
dilation, snapping, or zero-width slit reinterpretation is used. This algorithm
does not emit a triangulation as ideal pieces. GEOS/Shapely split and union
operate on double-precision segment intersections. Verification tolerances are
`max(1, domain area) * 1e-9` for area and
`max(1, domain width, domain height) * 1e-10` for boundary Hausdorff distance.
These tolerate numerical roundoff only and never move/repair coordinates.
The union must reconstruct the original domain within both checks; each piece
must be positive, valid, connected, hole-free, and free of internal area
overlap. Unsupported nonprogressing decompositions produce a concrete error.

Already solid domains return the original immutable Polygon object without
performing an identity union. Within one candidate-search call, exact-WKB plus
axis keys reuse identical decompositions across Base colors; the cache is then
discarded. Exact geometric equality establishes zero boundary Hausdorff
distance before the more expensive distance computation is needed. These
optimizations do not remove candidates, simplify geometry or change IDs.

## Seams, experimental comparison and evidence

Each actual split has a SplitGroup and every retained shared positive-length
cut boundary gets an AddedSeam record referencing the actual two final Piece
IDs and an actual LineString. Consecutive collinear/connected segments for one
pair are merged, duplicates are rejected, and lengths come from the recorded
geometry. This applies to Base splits as well as VISIBLE splits. Disconnected
subjects do not create artificial seams.

For VISIBLE splits, the cut is exposed. For Base splits, the exposed portion is
the intersection with the actual same-color Base exposure domains. Closed-domain
intersection intentionally counts a cut lying exactly on an exposure boundary
as exposed; it does not assume a covering allowance or hidden ordinary-piece
overlap. The interior proxy removes lengths already on observed visual
boundaries. All raw canonical lengths are retained. Global score lengths are
geometric unions, so coincident geometric segments do not double-count, while
`physicalSeamRecordCount` separately counts every distinct physical piece-pair
cut and shared-contract seam records remain complete. `seamCount` is the
number of connected merged geometric polylines, not human cutting difficulty.

Hard geometry and exact source-color coverage checks run before ranking. The
lexicographic ranking is interior exposed seam length, all exposed seam length,
piece count, vertex count, and total geometric seam length. Appearance area
error is zero within the reported numerical residual tolerance for every
accepted proposal. This is an experimental visibility proxy, not material or
child-suitability acceptance. No calibrated seam score, teacher signature or
production eligibility is created. Relation hard checks and any actual human
constraints must be applied by the integration caller before final selection.

The development ring-with-an-inner-other-color example provides a real
tradeoff: outer-color Base plus inner VISIBLE has no added visible seam;
inner-color Base requires splitting the outer-color annulus and produces
nonzero exposed interior seams and more pieces. Both preserve the same source
appearance and foreground. The first is selected on actual geometry evidence.

`validate_plan(observed, plan)` independently verifies solid geometry, exact
ColorSlot presentation, per-source conservation, Base support/global voids,
overlap, source references, SplitGroup conservation/back-references, complete
actual seam geometry, two-sided Piece references, unique IDs and measured
lengths. Its checks do not use a `solid: true` claim as proof. The caller then
serializes the actual geometries into artifacts and invokes the real shared
`b2.result/1` validator; these in-memory plans are not standalone wire results.

Within one proposal search, repeated pure boundary-distance and overlay-area
calculations are memoized by operation name and both exact ordered WKB byte
strings. This cache never stores a validation verdict or uses a plan ID; every
plan's references, colors, geometry and seams are still checked. Standalone
validation and final artifact rerender default to a fresh, uncached evaluation.
Strictly disjoint or merely touching axis-aligned bounds skip positive-area
intersection tests only; they never change geometry or exclude actual overlap.
Cached/fresh validation equality and rejection of geometry mutation under an
unchanged plan ID are regression-tested.
