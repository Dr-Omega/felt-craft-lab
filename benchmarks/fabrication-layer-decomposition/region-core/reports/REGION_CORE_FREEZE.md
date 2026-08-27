# P0-04B Region Core Freeze

Status: `REGION_CORE_FROZEN`

## Frozen selection

- `PRIMARY_FROZEN_PROFILE=cp-b-aggressive_rc-a`
- `cp-b-balanced_rc-a=REGRESSION_EVIDENCE_ONLY`
- `RC-A=FROZEN`; RC-B/RC-C/RC-D are Benchmark-only.
- `PRODUCTION_INTEGRATION_STATUS=NOT_INTEGRATED`

## Contract

The frozen truth is the existing CP-B raw structural label map. Proposal connectivity is 8; component, adjacency, and void connectivity are 4. A single Region ID may contain multiple 4-connected components and must not be treated as one connected polygon. The pixel label map is optional fringe coverage evidence.

Historical `regions.json.gz` files remain byte-identical. Their fixed `componentCount` is not frozen component truth. The new sidecars derive `components[]`, area, and bbox directly from each structural label map. `LEGACY_COMPONENT_METADATA_SUPERSEDED`.

## Representative color audit

RC-A is recomputed as the median Lab color over the configured Core Sampling Area. Every stored Region RGB/Lab/core count and every assigned pixel in the purified raster must match the recomputation. Existing full determinism evidence remains pinned by SHA. No RC algorithm selection is reopened.

## Frozen matrix

Exactly 8 primary contracts cover FLD-001 through FLD-008. Exactly 8 balanced records cover the same fixture set as regression evidence only. The validator rejects zero, missing, extra, wrong-case, or wrong-profile entries.

## Region Repair disposition

Region Repair is `REJECTED_AS_PRODUCTION_APPROACH`, `RESEARCH_EVIDENCE_ONLY`, `NOT_PRODUCTION`, and `NOT_FREEZE_BLOCKER`. G02_SHADOW remains part of the rejected Region Repair route and is not a Region Core Freeze blocker. Repair results are not frozen inputs.

## Exclusions

Frozen contracts prohibit Repair Apply appearance maps, SAFE_MERGE, repair policy/audit, merged IDs, experimental color groups, Material, Piece, Layer, and Vector semantics. This freeze does not integrate Region Core into Production and does not start B2.

## Evidence totals

- Primary Regions: 707
- Primary 4-connected components: 1180
- Primary input artifact aggregate SHA-256: `137ffb24b8ba5548f0dec6b90569a2eb12a9ccd3ad452ab913f8db1c1624b8f4`
- Balanced input artifact aggregate SHA-256: `4c763af6e97a1fe1b24b71c364ffe43c34f4dfa98c9419f41b48c2d60a2dacda`
