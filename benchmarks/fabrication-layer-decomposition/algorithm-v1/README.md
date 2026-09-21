# M4–M7 algorithm initial candidate

This is an experimental, size-independent algorithm batch, not a production
release or an accepted fabrication plan. It reuses frozen CP-B / RC-A,
Region Core and the selected P0-04C V2 → V1 → V0 result. Original inputs,
frozen evidence and R4 worktrees remain read-only.

## Public processing entry

`algorithm_runtime.run_algorithm(...)` owns output protection before every
processing write, including failure diagnostics. Output must be absent/empty,
outside protected paths and isolated from input. `m4_runtime.run_runtime` keeps
its own guard as an independently reusable M4-only entry. Internal writer
helpers are private. No caller must remember to invoke a separate safety gate.

```python
from pathlib import Path
from algorithm_runtime import run_algorithm

report = run_algorithm(
    image_path=Path("explicit-foreground.png"),
    output_root=Path("new-isolated-output"),
    foreground_source="Caller-supplied embedded alpha; no inferred background",
    manual_confirmation="PENDING_REVIEW",
    profile="aggressive",
)
```

Single-frame PNG is the flat input boundary. Non-identity EXIF orientations
are rejected. Fully opaque PNG requires `whole_image_foreground=True`.
An external mask uses `mode="external-mask", mask_path=Path(...)` and must be
single-frame 8-bit L PNG with matching dimensions; dual alpha sources reject.
SVG/PSD require explicit `selected_layer_ids=["*"]` (all supported pixel/shape
layers) or actual IDs. This does not authorize guessing/deleting a background.
See [M5_SUPPORT.md](M5_SUPPORT.md) for the finite real parser support matrix.

## Rebuild

Keep the repository's benchmark requirements/unittest workflow. Install
[requirements.txt](requirements.txt) into a separate environment, never into
backend/R4/another worktree's environment. The tested interpreter is Python
3.12. Node and TypeScript must already be available; set `TYPESCRIPT_TSC` to
`node_modules/typescript/lib/tsc.js` if needed. The adapter compiles and calls
the actual shared TypeScript validator; it never installs dependencies itself.

From the repository root (replace `PYTHON` with the isolated interpreter):

```text
PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py --input explicit-foreground.png --output new-output --foreground-source caller-explicit-alpha
PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py --input supported.svg --select-layer explicit-foreground --output new-layered-output --foreground-source development-layer-selection
PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/run_examples.py --output new-example-directory
PYTHON -m unittest discover -s benchmarks/fabrication-layer-decomposition/algorithm-v1/tests -v
```

`run_examples.py` reads three original project development snapshots (crescent,
envelope, mooncake) without loading GT or tuning profiles. It separately
generates clearly labeled, genuine development SVG/PSD sources and targeted
ring, tradeoff, diagonal/fringe and unsupported-blend cases. It records source
hashes before/after, actual failures and output locators in `examples.json`.
New runs do not use the frozen FLD ID namespace or overwrite existing outputs.

## Actual outputs for the next algorithm

- `fabrication-input.json`: real **b2.input/1**, exact RC-A ColorSlots, observed
  Component provenance and source → analysis → P0-04C → canonical transforms.
- `fabrication-result.json`: shared **b2.result/1**, actual hole-free BASE and
  VISIBLE geometries, exposures, split groups, measured seams and final relations.
- `artifact-locations.json`: portable artifact-ID → relative-file lookup. Verify
  each file against the corresponding identity before consuming it.
- `fabrication-geometry.json`: actual GeoJSON objects keyed by Piece ID,
  `exposure:<index>`, Seam ID, and `source:<SplitGroup ID>`. Geometry inherits
  selected vector segments using P0-04C's existing flattening rule.
- `relation-evidence.json`: measured contact/overlap, actual source-layer
  visibility witnesses, final source mappings/support and seam measurements.
- `candidate-comparison.json`: every retained alternative and hard rejection,
  actual Base colors, exposed/interior seam proxy, piece/vertex counts and reasons.
- `geometry-checks.json`: independent reread, conservation, topology and final
  Piece render measurements. A failed/unbound record cannot yield passing checks.
- `structural-assessment.json`: **b2.structure/1** tied to result SHA. Geometry
  checks may pass; purification/source semantics and aggregate remain
  `REVIEW_REQUIRED`. Manufacturing is `NOT_EVALUATED`; production export is NO.
- `index.html`: actual input/purified/observed, Base/exposure, pieces, seams,
  independent rerender, differences and located unresolved Region diagnostics.
- `algorithm-recipe.json`: effective configuration, implementation LF-byte
  hashes and dependency versions. `execution.json` alone holds local paths/time.
- `m4/`: actual source snapshot, effective alpha, arrays, selected-vector graph,
  M4-only diagnostics and stable algorithm identity. New runs are not frozen GT.

Failure leaves `failure.json` with the real error, completed stages and residual
files; no final complete report is published before all required outputs exist.
This is exception handling, not a power-loss atomic transaction. Residual
intermediate JSON does not constitute a completed/accepted algorithm run.

## Decision and numerical semantics

See [M6_STRATEGY.md](M6_STRATEGY.md) and [M7_STRATEGY.md](M7_STRATEGY.md).
Source layers provide located visual evidence, not automatic assembly order.
The finite Base/solid alternatives are reviewed again against final Piece IDs.
Missing visual evidence is UNRESOLVED; independently proven final non-overlap
can make it NON_BLOCKING. Unspecified pairs remain NOT_EVALUATED.

No ordinary VISIBLE hidden completion, global same-color merge, Region Repair,
bridge, hole fill, pixel-contour fallback, buffer or boundary repair is enabled.
Area/length numerical residual limits verify the inherited geometry; they do
not license an additional M7 boundary displacement. All small positive pieces
remain present, even when they are clearly impractical and require review.

The final render uses actual persisted Piece geometry/ColorSlots and topological
support order, not labels. Pixel centers exactly on an original color boundary
may belong to either adjacent color; raw differences and those exact ties are
reported separately. Interior mismatches still fail. New split-seam centers
must not erase foreground. Original alpha voids, threshold voids and a Region's
inner ring filled by another Region are not conflated.

RGB change counts and geometric agreement are not human quality ratings.
`falseMerge`, `falseSplit`, manual acceptability and physical cutting thresholds
are not invented. No M8–M11, sizing, material model, export or product UI is added.

See [VERIFICATION.md](VERIFICATION.md) for the executable evidence map and clean
checkout commands, and [VISUAL_REVIEW.md](VISUAL_REVIEW.md) for located agent
observations and explicit human-quality limitations.
