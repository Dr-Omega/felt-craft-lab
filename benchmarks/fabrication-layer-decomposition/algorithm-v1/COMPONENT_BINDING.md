# Runtime Component domain binding

Base: `fc0fde8bd3d1c8cd88d1af2f83e686519bd57ea7`.
Audit branch: `audit/fabrication-component-binding-hotfix`.
This change repairs provenance, not application quality or manufacturing readiness.

## Contract and implementation

The frozen graph's Component IDs remain the runtime namespace. Raster scan
ordinals are explicitly separate. `tools/component_binding.py` extracts actual
4-connected supports from structural labels and every directed unit grid edge
on their borders, including holes. It compares that full multiset with the
unsmoothed graph rings. Every domain and every Component must participate exactly
once within its Region. Missing/duplicate/ambiguous/cross-Region matches reject.
Area, bounding box, names and iteration order never establish identity.

The bijection is computed before selected-curve refinement on every M4 path:
baseline, selection, contour, combined, design-colors and design-cleanup. Raster,
external-mask and layered M5 inputs share that implementation. Runtime statistics
and numbered previews use the bound graph IDs, with explicit raster ordinals and
support digests; observed candidates persist the source support digest.
`component-binding.json` is bound into the runtime and M1 identities.

M1 `build_input` and the final persisted replay reconstruct the bijection from
the actual NPZ labels and raw graph. They compare the complete stored metadata,
proof and observed references, not a PASS flag or cached mapping. M1 source
records/artifact references are reconstructed again during final replay. The
quality-path source replay also uses freshly rebound metadata. Old artifacts
without the new proof cannot acquire a new binding PASS from valid hashes alone.

The contour trial adapter constructs only its existing polygon-representability
inputs. Those temporary trial objects do not claim a pixel binding. Frozen
geometry, contour policy and candidate scoring are unchanged.

## Permitted changes and parity boundary

`regions.json` Component identities/statistics, source-support fields, binding
proof, M1 provenance, artifact/result hashes and Component-numbered preview
change (including the default path). Graph IDs/order, raw/selected boundaries,
labels, colors, input alpha, physical Pieces, candidate scores/order/selection
and seams must remain identical by actual source-domain correspondence.
The old raster-statistics ID is never used as a geometry join key.

## Verification

`python -m unittest discover -s benchmarks/fabrication-layer-decomposition/algorithm-v1/tests -v`
includes opposite scan/graph order, equal-area distinct domains, shuffled lists,
holes/point contacts, missing/duplicate/cross-Region rejection, real numbered
preview placement, all six quality paths, and coherently rehashed incorrect
mapping rejection at M1 and final persisted replay.

The batch evidence additionally contains the 50 old M4 source-domain replays
(not 50 full M7 reruns), focused public-entry M4–M7 runs, exact physical parity,
full affected suites, six current validators, the separately reported known
legacy helper failure, 844-file byte verification and clean-checkout reproduction.
See the external incremental REVIEW/RESULTS/manifest for actual invocation logs,
commit SHA and remote verification; this document is not an independent signoff.

Independent review and user visual acceptance remain PENDING. Manufacturing is
NOT_EVALUATED and production export remains NO. M8 is not started.
