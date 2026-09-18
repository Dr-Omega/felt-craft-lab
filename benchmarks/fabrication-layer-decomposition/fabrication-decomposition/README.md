# P0-04B2 Fabrication Decomposition PoC

Status: `B2_V0_REVALIDATED_ON_REPAIRED_BASELINE`; `B2_V0_STATUS=VALIDATED_BASELINE`.

The V0 baseline maps every Frozen Region Core 4-connected component to one independently identified Fabrication Piece candidate. `Region ID != Fabrication Piece ID != Color Layer ID`. Color Layer grouping is not implemented.

Observed geometry is a set of directed ring references into the immutable P0-04C result selected by the frozen `V2 -> V1 -> V0` ladder. V0 never copies, refits, closes, merges, or extends boundaries. `inferredGeometry` is always `null`, and `finalCutGeometry` is byte-equivalent to `observedGeometry`.

The overlap contract is a partial order with `BELOW`, `ABOVE`, `AMBIGUOUS`, and `NO_RELATION`. V0 emits no relations and uses `NO_RELATION` for unspecified pairs, because observed geometry alone is not sufficient evidence for z-order.

Run from the repository root with the isolated Color Purification PoC Python environment:

```powershell
python benchmarks/fabrication-layer-decomposition/tools/run_b2_v0.py
python benchmarks/fabrication-layer-decomposition/tools/validate_b2_v0.py
python -m unittest discover -s benchmarks/fabrication-layer-decomposition/fabrication-decomposition/tests -v
```

B2-V1 is blocked on `PROJECT_REAL_B2_GT` for piece identity, hidden contours, and human-authored partial-order relations. This is a data gap, not permission to fabricate GT.
