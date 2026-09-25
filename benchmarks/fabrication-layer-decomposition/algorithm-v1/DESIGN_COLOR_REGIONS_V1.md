# Design colours and spatial selections — opt-in candidate

Base: `a85fb5102157d56fd8fc74d597f0ccf840b84236`.
Branch: `audit/fabrication-design-color-regions-v1`.

The old default CP-B / RC-A, shared Region/vector implementation, M7 geometry
checks and Base ranking are retained. `design-colors` changes the proposed
design, not the interpretation of old frozen evidence. `design-cleanup` is the
foreground-only causal control. All new results remain unconfirmed candidates.

## Public invocation

Use the existing `algorithm_runtime.py --input INPUT.png --output NEW_EMPTY_DIR
--foreground-source SOURCE_DESCRIPTION --quality-mode design-colors`.
Add `--foreground-cleanup` to enable a separately recorded unconfirmed exterior
island hypothesis. Automatic palette inference is the default. Optional
`--design-palette '[[0,0,0],[250,205,0]]' --palette-provenance DESCRIPTION` is an
explicit diagnostic reference, never a hidden answer used by automatic mode.
Python callers use the same guarded `run_algorithm` or M4 `run_runtime` API.

## Method and limitations

1. Quantized robust core colours propose a variable number of modes. The modes
   are tested for spatial coherence, density and actual neighbouring colour
   steps. Fragmented or gradual colour clouds can share a design identity;
   supported close modes with a real abrupt boundary can remain distinct.
   Automatic modes closer than the declared initial Lab clustering radius
   can still merge; this is not a guarantee for arbitrarily close design inks.
2. Compact exterior islands are a separate alpha-domain proposal. It requires
   proximity, lack of supported palette identity, neutral/light appearance,
   no protected hole/extended detail, and a fit to locally supported foreground
   colour plus exterior colour. Area alone cannot authorize deletion. The
   original and full-resolution alpha change map are retained.
3. Full-resolution design-label assignment includes local exterior mixing and
   robust provisional spatial support. Old CP-B labels are not hard constraints:
   different old regions may share one new identity, and competing colour cores
   can split an old region. Exact small design marks and coherent thin details
   are protected. Adjacent colour support is reconstructed; disconnected same
   colour motifs are never joined through missing foreground.
   Exterior mixtures cannot seed a second design colour. Non-exact exterior
   ringing samples may use a compatible locally supported interior core;
   an exact single-pixel design-colour mark on the same edge remains protected.
4. RC-A representatives are recomputed on the new labels. Region/Component,
   shared vectors, ColorSlots, M1 provenance, Base, actual Pieces, relationships,
   physical seams and independently persisted reread/rerender are regenerated.
   Invalid M7 candidates are recorded/rejected by the existing strict gate;
   no tolerance or completeness requirement is relaxed.

This remains a proposal, not artistic-intent inference with a guarantee.
Ambiguous low-contrast tiny marks, intentional light islands near a body,
smooth intentional gradients and severe texture are possible failure modes.
Reference palettes help separate inference failures from reconstruction failures.
No image names, hashes, IDs, coordinates, target outline or fixed colour count
are available to the algorithm. Fixture coordinates belong only to controls.

## Evidence and reproduction

`run_design_color_examples.py --output NEW_DIR` runs the three project sources
with baseline / cleanup-only / colours-only / combined / reference.
`run_design_color_examples.py --controls --output OTHER_NEW_DIR` runs the known
five/six-colour tile designs and a separate nine-colour ribbon design family,
each with clean/texture/tint/edge variants. Variants are not independent designs.
Real references are explicitly diagnostic, not ground truth. Controls and
truths are generated separately from the algorithm and saved in the output.

Run all existing tests and the six read-only validators listed in
`VERIFICATION.md`, plus the new `test_design_color_regions.py` and
`test_design_color_pipeline.py` included by normal discovery. Compare every
frozen tracked blob to the fixed base. After committing, repeat in a clean
checkout and compare stable result identities, actual labels and geometry.

The upload package reports real outcomes, failure cases and non-overlapping
stage timings. Unknown real-image merge/split/detail quality is null, never
zero or PASS. Exact B→C checks are not A→B visual acceptance. No manufacturing
assessment, production export, M8 or formal-branch release is authorized here.

The development mooncake initially produced a self-touching ring at a
transition-colour island; all existing V2/V1/V0 routes correctly remained
unusable under the selected-polygon gate. The fix targets unsupported
boundary-colour assignment, not polygon repair, buffering or a relaxed gate.
The failing small-image regression and its exact-edge-detail counterexample
are in `test_design_color_regions.py`. Prototype failures remain separate from
final candidate runs in the evidence package. Remaining mooncake small
Components are not automatically declared intentional or visually approved.
The initial `556459b` proposal retained 11 small light edge Components (at most 16 pixels),
including a one-pixel selection at (477, 207). These are located observations,
not algorithm inputs or a claim that all fragmentation is solved. Known-design
colour representatives also retain a maximum five-level RGB channel offset on
the tint perturbation: correct selections do not imply exact original-ink recovery.

## Follow-up to the artifact review of 556459b

The preview renderer now unions independent Polygon-part masks for each colour.
A part clears only its own holes: its drawing order cannot erase a valid nested
same-colour part. This changes diagnostic PNG rendering, not persisted geometry,
true alpha holes, M7 checks, candidate selection, or seam records. Regression
tests exercise both part orders and retain a real empty central hole.
The same nested-domain regression exercises appearance, physical-seam and
numbered-reference preview options at native and supersampled scales, with
exact order-invariance and unchanged input-domain/plan declarations.

`design-colour-regions/2` also reconciles a previously unsupported ownership case.
After existing assignment, a complete connected colour component may change
owner only when all its pixels lack an exact palette-ink match, lie in the
exterior-connected uncertainty band, lack their own local colour-core support,
and have exactly one surrounding design identity with local core support.
The band is bounded by the existing local-support radius; neither existing
numeric thresholds nor an area cutoff are increased. Decisions use a snapshot,
not a cascade in which earlier changes become evidence for later ones.

This is label reownership, not foreground deletion or hole filling. Exact tiny
marks, components containing supported competing ink, weak interior details
without an exterior transition path, and true alpha holes are counterexamples
in the regression suite. A larger uncertain boundary component is also tested
to show that the decision is not small-area deletion. Each accepted change
records every changed coordinate, both design identities and its unconfirmed
status. Persisted reread regenerates these declarations from the input; even a
coherently rehashed false ownership claim is rejected.
An additional automatic/reference counterexample keeps two supported close
design inks distinct, a one-pixel black frame and internal line, an intentional
disconnected small decoration, and a genuine hole. Automatic mode receives only
RGBA; its test truth and reference palette are never passed to that call.

An intentionally ambiguous mark satisfying all these conditions can still be
reassigned. Therefore the new design remains a proposal requiring A-to-B visual
review. B-to-C coverage, physical seams and independent rerender are checked
without relaxing existing geometry gates. Three real sources and perturbations
of three synthetic designs do not establish general real-multicolour quality.
