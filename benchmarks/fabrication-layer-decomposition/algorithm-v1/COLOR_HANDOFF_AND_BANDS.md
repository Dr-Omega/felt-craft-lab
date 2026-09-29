# Explicit colour handoff and bounded transition candidates

This increment follows geometry commit `efe42a148dbeaebb2dbbf18e6d43bf6ef1f273b5`.
It changes the explicitly selected practical-auto path, not the baseline path,
frozen background adapter/model, mask or frozen kernels.

## Saved alpha handoff (separate B1 commit)

`run_algorithm(..., saved_alpha_path=...)` / `--saved-alpha` explicitly pairs
decoded original JPEG/PNG RGB with an existing 8-bit L PNG mask. It does not
infer a new mask, rotate the coordinate frame, guess premultiplication, divide
by alpha or recover background-unmixed colours. Ordinary RGBA remains ordinary
RGBA; the new operation is opt-in. Inputs and output isolation are validated
before writes. Original bytes, mask bytes and derived PNG are separately bound
to result artifacts and recipe; independent reread regenerates the derived PNG
and checks that M4 actually consumed it. Coherent rehashing of a wrongly darkened
derived image does not make it a valid handoff.

The fixed user JPEG/mask experiment shows 6 colours / 96 domains from the old
PNG, versus 3 colours / 3 domains with decoded original RGB and the same mask,
using exactly the old selector. This is B1's effect, not the new selector's.
The existing rembg cutout composition, not PNG storage or mask inference, is
where the original RGB was multiplied. Frozen/default inference is not changed.

## Transition candidates (B2)

The V2 source-supported seeds, missing-ink feedback and ownership solver remain.
V3 additionally joins consecutive weak colour bands for direct foreground-only
cross-section sampling. Endpoint samples must stay inside two distinct trusted
faces. Samples may not jump another protected detail or a transparent gap.
Evidence records exact positions, crossed labels, mixture fractions and local
residuals. A stable intermediate plateau is not removed just for fitting a
two-colour mixture. Ambiguous/unmeasured pixels keep their existing ownership.

There are at most 2048 global cross-sections, three actual full label candidates
and one correction round. KEEP, adjacent-MERGE and TWO-SIDE alternatives reuse
watershed. No coordinate/case/file/hash answer or reference palette is supplied.
Candidate changes are confined to directly supported transition pixels. Ranking
first protects all other local structure, then compares measured band ownership,
then component burden and change count. This remains an experimental proxy.
Complete KEEP labels and each candidate's lossless run-length changes are saved
with hashes; equal results are explicitly marked. Persisted design replay
recomputes all decisions instead of trusting this report or a cached PASS.

Known scope: this is a conservative band correction, not complete texture or
colour generalization. The corrected user input already has three domains;
V3 only changes four boundary pixels. Real regression results and final physical
pieces are reported separately in `geometry-color-evidence`. Domain count is
never presented as final-piece count. User quality and independent review remain
pending; manufacturing is not evaluated and production export remains disabled.
