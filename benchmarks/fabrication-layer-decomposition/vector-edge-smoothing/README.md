# P0-04C Label-to-Vector Edge Smoothing PoC

This isolated PoC derives reusable boundary geometry from the frozen CP-B
`structural_label_map`. It does not modify label maps, Region Core, production
code, or fabrication semantics.

Geometry truth is the structural label map alone:

- positive integers are CP-B regions;
- zero is void/background;
- zero components use 4-connectivity;
- a zero component touching the canvas is `OUTER`, otherwise it is `HOLE`;
- source alpha is audit-only and a topology mismatch fails closed.

Routes:

- `V0_EXACT_PIXEL_BOUNDARY`: canonical pixel-cell half-edge graph.
- `V1_SIMPLIFIED_POLYGON`: deterministic RDP on shared canonical chains.
- `V2_SMOOTH_BEZIER`: protected-junction/corner cubic fitting with local
  V1/V0 fallback.

The comparison tolerances are evidence settings only. They do not freeze a
production tolerance or select a winning route.

Run from the repository root with the existing B1 PoC environment:

```powershell
python benchmarks/fabrication-layer-decomposition/tools/run_vector_edge_smoothing.py
python benchmarks/fabrication-layer-decomposition/tools/validate_vector_edge_smoothing.py
python -m unittest discover -s benchmarks/fabrication-layer-decomposition/vector-edge-smoothing/tests -v
```

After an interrupted run has been completed by rerunning only the affected
case/profile pairs, reports and contact sheets can be rebuilt without repeating
the geometry work:

```powershell
python benchmarks/fabrication-layer-decomposition/tools/run_vector_edge_smoothing.py --report-only
```

`--report-only` fails if any expected route/tolerance result is absent or if a
case mixes input artifact SHAs.

External V2 tolerance evidence is generated strictly from the saved route
geometry:

```powershell
python benchmarks/fabrication-layer-decomposition/tools/generate_v2_tolerance_review.py
```

The generator writes same-scale 0.5/1.0/2.0 contact sheets, fixed-box focus
crops, aggregate metrics, and the numbered FLD-007 hole review. It snapshots
all 112 route artifacts plus the 32 structural/pixel inputs before and after
rendering and fails if any SHA changes.

Evidence-generation status:

`POC_EVIDENCE_COMPLETE_PENDING_EXTERNAL_VECTOR_REVIEW`

## Frozen baseline

External route and tolerance review is recorded in `freeze.v1.json` and
`reports/P0-04C_VECTOR_EDGE_SMOOTHING_FREEZE.md`.

- Primary route: `V2_SMOOTH_BEZIER`.
- Default tolerance: **0.5 source pixel** in the original
  `structural_label_map` coordinate system.
- Fallback: V2 → V1 → V0.

Validate the frozen baseline with:

```powershell
python benchmarks/fabrication-layer-decomposition/tools/validate_vector_edge_smoothing_freeze.py
```

Frozen status: `P0-04C_VECTOR_EDGE_SMOOTHING_FROZEN`.
