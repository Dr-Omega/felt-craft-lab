# Cross-image quality candidate

Code baseline: `767f9f973a6e8e0e8f374c18e10fcf27ab9756fc`.
Material-only snapshot: `1cdf77db19d99bc1446277c86783bb09c5f595d6`.
No material branch history is merged. Inputs are original PNGs verified against
the snapshot's Git blobs. Sources and old evidence are read-only.

## Boundaries

The automatic experimental design-colour path is still opt-in. Frozen CP-B,
RC-A, Region Core, P0-04C, B2-V0 and all frozen evidence are unchanged. There is
no M8 or manufacturing evaluation. A valid B-to-C reconstruction does not
approve the original-to-design A-to-B change.

1. `design-colour-regions/3` never treats RGB underneath zero alpha as observed
   background evidence. Palette neighborhood statistics extend *visible* RGB
   to invisible samples only for computing local statistics. They do not add
   foreground or alter input pixels. Cleanup and exterior mixing use an explicit
   **unconfirmed neutral-light matte hypothesis**, not an inferred matte or an
   answer palette. Existing shape/proximity/palette/mixing guards remain. Dark
   or coloured matte, real small pale decorations and scale dependence remain
   subjects for evaluation; this is not a general matting solution.
2. Exact design-ink matches (the existing palette matching radius, not a new
   threshold) cannot be overwritten by old-region majority/coherence. Several
   disconnected marks of the same ink must not be erased because no single
   mark dominates their combined support. A generic repeated-stroke control
   covers both automatic and reference modes; no real-case coordinates enter
   this rule. It may preserve more small shapes, not promise fewer Pieces.
3. The design-colour entry and independent persistent replay both enable the
   existing shared-contour refinement. Each edge still has one geometry for
   both sides. Existing budgets, corner constraints and thin-branch protection
   remain unchanged. Reports expose trials, protected edges, fallback reasons
   and raster changes. These are not human quality scores.
4. `shared-contour-refit/3` checks the actual selected-polygon materialization
   gate in addition to frozen embedding/deviation checks. Point-touching source
   rings can pass the latter but fail the former. In **design-colors only**, an
   exact repeated-vertex walk may be re-encoded as directed simple cycles. The
   complete directed segment multiset must be identical, coordinates are never
   moved, and the result must still be one valid positive Polygon with all true
   holes. Valid existing Polygons are byte-identical. Crossings, overlapping
   cycles, spikes/zero-area walks and multiple shells still reject; no buffer,
   make_valid, snapping, filled hole or dropped edge is allowed. Provenance
   retains the original shared-edge references and records the re-encoding.
   Persistent source/label/contour replay recomputes this declaration, including
   rejecting a lie after legitimate artifact rehashing. Neither default nor
   older quality modes silently opt into this representation change.
   Unrepresentable sources remain `BLOCKED_SOURCE_POLYGON_MATERIALIZATION`.
   Failed designs retain explicitly unaccepted diagnostic snapshots; no complete
   report or fabricated downstream Piece plan is emitted.
5. Shared polygon previews now include centers exactly on closed boundaries,
   with explicit paint-order ties, matching independent Piece replay. This
   fixes false transparent cracks without changing polygon data. The five shared
   preview calls are `pieces.png`, `base.png`, `base-exposures.png`,
   `m4/observed-candidates.png` and `m4/observed-geometry.png`.
   True hole interiors remain empty. This common display
   correction also affects default-path diagnostic previews, not its partition,
   vector, Base, candidate ranking, Piece geometry or physical seams.
6. Design-colour M7 construction alone opts into
   `PARENT_INTERSECTION_FOR_FLOATING_CUT_RESIDUE/1`. If a newly constructed
   split part has positive area outside its actual parent, it is intersected
   with that parent before source declarations and physical seams are built.
   The result must remain one valid solid Polygon, have exactly zero area
   outside the parent, and satisfy the existing (unchanged) area and inherited
   boundary limits. An already-contained/no-cut part is untouched. This is
   not normalization of source regions and never fills their holes. It is not
   applied when validating supplied/persisted plans: strict positive-area source
   ownership, actual-parent completeness, colour, coverage and seam checks all
   still run, including during ranking and independent rerender. The default
   and older quality modes retain their historical construction. No new numeric
   tolerance, source-ID invention or trusted old PASS is introduced.

## Experiment protocol

The immutable external `PROTOCOL.md`, `SAMPLE_MANIFEST_LOCKED.json` and
`SPLIT_LOCK_FINAL.json` were saved before baseline effects were inspected.
There are 58 actual originals: 50 alpha-bearing stickers and 8 opaque items
requiring explicit foreground preparation. Eight previously used FLD families
are regression only. The remaining 42 images represent 37 conservative design
families: 25 development families / 29 images and 12 holdout families / 13 images.
Source-only family grouping is not algorithm-result inspection.

All real runs use AUTO, original resolution, the same aggressive profile,
cleanup proposal and baseline seam ranking. The uniform 600-second per-run
timeout includes independent persistent replay and artifact writes. Failures
and timeouts stay in the inventory and overview. Scaled/tinted/invisible-RGB
variants remain stability tests of their parent design, never extra samples.
The final implementation is locked before any holdout run. The delivery records
the actual locked commit, source hashes, complete commands and environment.

Baseline development: 7 of 29 invocations completed the geometry pipeline;
22 rejected selected polygons. Three diagnosed real examples already contain
self-touching rings on exact pixel-cell boundaries. A read-only development
probe established that some can be represented as one valid Polygon by exact
cycle decomposition, preserving every directed segment and area. The bounded
adapter above handles only that case. Domains requiring multiple shells or
different point-contact/solid semantics remain a separate contract proposal;
this batch does not authorize that change. A valid ring representation does not
remove texture fragments or their required physical seams, nor guarantee that
the existing M7 search finishes within the uniform timeout.

The final development revision was run on all 29 images, not just the synthetic
counterexamples: 17 completed with full geometry/replay checks and 12 timed out.
All 29 produced their intermediate M4 report. Of the original 22 rejected
images, 11 completed and 11 timed out; one formerly successful image (S44)
also timed out. This is not 29 full-chain successes or a visual acceptance.
The original crescent remains a disclosed 2-to-5 Piece regression; the envelope
stays at four Pieces and the mooncake at sixteen. Shared-contour fitting changes
the mooncake's total seam length from 172.5 to approximately 172.8364 source units
while retaining eight seam records. Real near-colour/detail losses, micro-pieces
and incomplete runs remain in the external per-image review. These are measured
outcomes, not filename-specific algorithm rules. The sealed holdout is evaluated
only after the candidate and configuration are locked; its results belong to
the delivery, not to an implementation-tuning loop.

See the incremental delivery's `REVIEW.md`, `RESULTS.json`, `overview.html`,
raw logs and manifest for final measured outcomes, including unresolved failures.
Execution success, geometric validity, executor visual observations and human
acceptance are reported separately. Independent audit and human review remain
PENDING; manufacturing is NOT_EVALUATED and production export is NO.
