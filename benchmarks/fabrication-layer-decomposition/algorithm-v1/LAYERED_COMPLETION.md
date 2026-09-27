# Opt-in full-piece layered completion V1

This is an experimental fabrication proposal, not an inference of the original
author's layer history and not visual or manufacturing approval. The existing
default remains `quality_mode="baseline", completion_strategy="legacy"`.

## Entry and reproduction

The public writer is `algorithm_runtime.run_algorithm`. Its output isolation
checks precede all writes, including failure records. The new switches are
independent: `quality_mode="layered-selection"` enables the new selection path;
`completion_strategy="layered-v1"` enables full-piece completion and ordering.
Use separate, absent/empty output directories for each comparison arm.

Run from the repository root with the existing project Python environment and
installed Node/TypeScript dependencies. `TYPESCRIPT_TSC` may point to the existing
`typescript/lib/tsc.js`; no dependency installation is implicit.

```sh
# Combined automatic selection and completion; no reference palette supplied.
python benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py --input /absolute/input.png --output /absolute/new-output --foreground-source "explicit embedded-alpha source provenance" --quality-mode layered-selection --completion-strategy layered-v1

# Actual public-entry three-/four-layer controls and pre-write isolation.
python -m unittest discover -s benchmarks/fabrication-layer-decomposition/algorithm-v1/tests -p test_layered_runtime.py -v

# Independent wire/geometry replay and coherently rehashed attacks.
python -m unittest discover -s benchmarks/fabrication-layer-decomposition/algorithm-v1/tests -p test_layered_contract.py -v
```

For completion-only, omit `--quality-mode`; for selection-only, omit
`--completion-strategy`. Existing design-colour comparisons can explicitly use
`--quality-mode design-colors`. A reference palette requires both
`--design-palette` and its `--palette-provenance`; it is a separate experiment,
not an automatic-mode prerequisite or hidden answer. Foreground cleanup is a
separate opt-in proposal and never overwrites original input.

## Geometry, source identity and persistence

Each final piece is one valid, connected, positive-area, hole-free polygon.
Its visible domain equals its full geometry minus the union of actual pieces
above it. Intermediate visible domains may have holes. Completion can cover a
lower or middle piece's hole only beneath actual upper material; positive-width
supported reconnection can join interrupted same-colour parts. Genuine
foreground gaps and transparency remain gaps. Fully hidden useless pieces are
rejected.

The DAG is **piece-level**, not one global ordering of colours. Full, visible
and hidden geometry, exact colour, visible Component/Region references,
occluders, physical cuts and proposed order are serialized in
`fabrication.layered-result/1`. `sourceDomainRole=OBSERVED_VISIBLE_ONLY`
separates measured visible sources from `inferredHiddenGeometry` and completion
hypotheses. `orderSemantics=PROPOSED_FABRICATION_NOT_ORIGINAL_LAYER_HISTORY`
prevents the fabrication order being presented as recovered author history.

`layered_contract.ts` validates this new wire and invokes the actual existing
shared M1 input validator. Its payload identity uses shared canonical JSON.
It does **not** call a layered result an old `b2.result/1` PASS. Python independently
reopens persisted geometry/order and freshly reconstructed Component domains:
structural-label 4-connectivity and raw boundary binding precede selected-curve
reconstruction. Source coverage, exact colour, full/visible/hidden domains,
actual occlusion, DAG, genuine holes, cut lines and lengths are recomputed.
Neither generation PASS caches nor recomputed hashes make a false mapping or
false geometry valid. Numbered and layer-by-layer displays use the checked
wire-derived plan, not the generator's in-memory plan.

`test_layered_runtime.py` generates visible-only nested controls and runs the
actual public pipeline through persisted shared validation, independent replay
and diagnostic images. It checks three and four real full-piece layers; hidden
ground-truth geometry is not supplied to the algorithm. These controls establish
mechanics, not real-image visual quality.

## Selection proxy and reporting

At most nine legal proposals are compared. Appearance conservation is a hard
geometry constraint. The common `layered-balanced-cost/1` proxy is:

```text
P + 4*M + 12*(L/sqrt(A)) + 0.2*(H/A) + 0.02*V + 0.5*(D-1)
```

Here `P` is piece count; `M` counts pieces of area at most four source-coordinate
square units; `L` is exposed same-colour material-cut length; `A` is foreground
area; `H` is summed hidden material area; `V` is full-piece vertex count; and `D`
is overlap-DAG depth. These fixed, cross-image weights are experimental proxies,
not measured manufacturing utility or human approval. Covered physical cuts
remain recorded separately from exposed cut lengths and ordinary overlap edges.
The persisted verifier independently recomputes the metrics and cost.

Raster comparisons report `rawRasterMismatchPixelCount`,
`sharedBoundaryTiePixelCount`, and `interiorMismatchPixelCount`. Only a pixel
centre exactly on an inherited shared source boundary may take either adjacent
exact colour. Such ties do not mean byte-identical rasters; displaced geometry
or an interior mismatch cannot pass this exception.

## Compatibility and limits

Frozen CP-B/RC-A, Region Core, P0-04C, B2-V0 and their evidence are unchanged.
The existing 844-file frozen manifest remains the byte-verification scope;
actual verification logs, not this document, establish its result. No R4,
background-removal or formal branch update is part of this opt-in strategy.
Legacy algorithm and geometry semantics remain the default. The shared adapter
also corrects NOTE_01 by describing `.npz` artifacts as `application/x-npz`,
instead of `application/json`; this is a media-type correction, not a geometry
change.

Runtime success and exact construction of the selected design do not establish
that the design itself is desirable. Report visible regressions and failed or
timed-out cases explicitly. Independent review and user visual acceptance stay
pending, manufacturing is not evaluated, production export is **NO**, and this
work does not start M8.
