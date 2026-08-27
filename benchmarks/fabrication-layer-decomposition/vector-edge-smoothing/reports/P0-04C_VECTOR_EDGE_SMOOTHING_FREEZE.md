# P0-04C Vector Edge Smoothing Freeze

Status: `P0-04C_VECTOR_EDGE_SMOOTHING_FROZEN`

External decision: `TOLERANCE_FREEZE_APPROVED`

## 1. Scope

This document freezes the P0-04C label-to-vector route contract and its default tolerance. It does not connect the PoC to the backend, Electron, UI, Color Layer Grouping, or B2 Fabrication Decomposition.

## 2. Frozen Inputs

`structural_label_map` is the only geometry truth. The frozen evidence covers eight fixtures under `cp-b-aggressive_rc-a` and `cp-b-balanced_rc-a`. Vectorization must never modify or back-propagate changes into a label map.

The input evidence aggregate SHA-256 is `1f131b7911276a268a6ad22f069778679bf800aa16b8c13dc1a848dfe6a8d43b` across 32 structural/pixel artifacts.

## 3. Frozen Route

The primary route is `V2_SMOOTH_BEZIER`. Shared boundaries are generated and fitted once. Adjacent regions reference the same boundary geometry using direction, and junction coordinates cannot drift independently.

## 4. Frozen Default Tolerance

The default is **0.5 source pixel** in the original `structural_label_map` pixel coordinate system.

This freeze does not define resolution normalization. A future label-map resolution change must not scale the default automatically; it requires separate evidence and approval.

## 5. Fallback Ladder

The strict local fallback order is:

`V2_SMOOTH_BEZIER` → `V1_SIMPLIFIED_POLYGON` → `V0_EXACT_PIXEL_BOUNDARY`

`V0_EXACT_PIXEL_BOUNDARY` remains the exact geometry fallback and must retain byte-identical round-trip capability. `V1_SIMPLIFIED_POLYGON` remains the intermediate fallback and is not the primary route.

## 6. Geometry Contract

- `structural_label_map` is the sole geometry truth.
- Vectorization cannot modify the label map.
- Each shared boundary is generated and fitted once.
- Both adjacent regions reference that shared geometry by direction.
- Junctions are locked and cannot drift independently.
- A region may contain multiple 4-connected path components.
- Diagonal-only point touch does not create a shared edge.

## 7. Topology Contract

Topology and region adjacency must be preserved. Curves cannot create a self-intersection, an illegal inter-edge crossing, or a new region adjacency. Any local geometry whose safety cannot be proven fails closed through the frozen fallback ladder.

## 8. Hole Contract

Every structural hole must be retained. Small holes cannot be removed as visually insignificant. FLD-007 contains 29 structural holes; all 29 are preserved by saved V2 evidence at 0.5, 1.0, and 2.0 source pixels.

## 9. Determinism Contract

Boundary IDs, chain direction, ring ordering, region ordering, segment ordering, floating-point serialization, and JSON serialization are deterministic. The same input and configuration must produce byte-identical artifacts. V0 must remain byte-identical to the source label map after rasterization at source-pixel centers.

## 10. External Review Decision

External Vector Review selected `V2_SMOOTH_BEZIER` as the primary route, retained V1 as an intermediate fallback, and retained V0 as the exact fallback. External Tolerance Review approved **0.5 source pixel** as the frozen default.

## 11. Evidence Summary

- V0 byte-identical round-trip: 16/16 case/profile combinations.
- Route results: 112/112 Hard Gate PASS.
- FLD-007: 29/29 structural holes retained at all three evidence tolerances.
- Route artifact aggregate SHA-256: `5054ae02b65c65eb81f6cef50501056459c9f0fecbbc9b553aeb67c14e5399e4`.
- Case metrics SHA-256: `ce90e7db5433761536ab75055fead5157600713548ed781010687fe82b6bd1c4`.

For V2 at the default 0.5 source pixel across all 16 case/profile combinations, the exact machine evidence is:

- Median symmetric maximum deviation: 0.56174213 source pixels.
- Maximum symmetric maximum deviation: 0.56249905 source pixels.
- Median area-error ratio: 0.0.
- Maximum area-error ratio: 0.0.
- Total line segments: 86420.
- Total cubic segments: 5473.
- Total segments: 91893.
- Median fallback ratio: 0.18332013.

Raw values remain authoritative in `reports/V2_TOLERANCE_METRICS.json` and `reports/case-metrics.json`.

## 12. Benchmark-only Alternatives

- V2 at 1.0 source pixel remains benchmark-only evidence and is not the default.
- V2 at 2.0 source pixels remains benchmark/future-experiment evidence and is not the default.

## 13. Known Non-goals

This freeze does not implement backend or Electron integration, a production vector API, Color Layer Grouping, B2 decomposition, material semantics, or UI controls. It does not change CP-B, RC-A, label maps, RDP, the Bezier fitter, corner detection, Hard Gates, or fallback behavior.

## 14. Future Revalidation Triggers

Revalidation is mandatory if the structural-label-map resolution or coordinate system changes; if V2 fitting, RDP, corner detection, Hard Gates, or fallback behavior changes; or if new fixture/topology classes enter the supported scope. The default must not be rescaled automatically.
