# Practical automatic construction — opt-in V1

Run the existing guarded API/CLI with `quality_mode='practical-auto'` /
`--quality-mode practical-auto`. This owns automatic design selection, visible-
evidence cleanup and bounded completion; no reference palette or seam override
is accepted. Existing defaults and old strategies remain available unchanged.
The source and original alpha remain separate from the derived design.

The selector uses supported surface interiors and contrast-qualified fine
features as markers, then foreground-constrained edge flooding. Broad coherent
near-colour faces are not reduced to a fixed palette size. Locally explained
two-ink point transitions are not protected just because they happen to match
another palette colour. Shared contours and Component domain binding follow
the selected full-resolution labels using the existing geometry gates.

Exterior cleanup jointly uses topology, width/shape, distance to a trusted body,
interior colour support and actual visible boundary samples. It does not inspect
fully transparent RGB or assume a white matte. A deliberate isolated point that
coincides with repeated edge-transition colours can still be ambiguous. All
removals are unconfirmed proposals, never manual approvals; real holes and
supported independent decorations are protected.

The same-design solid baseline is actually validated and persisted before any
improvement search. A child worker explores at most six existing completion
proposals until whole-run second 420, reserving 180 of the uniform 600 seconds
for final verification. Search failure/timeout keeps that baseline, with stderr
and per-trial progress. If layered conversion was not proven, the original
validated `b2.result/1` contract is explicitly retained instead of a layered PASS.
This does not guarantee that baseline construction or final validation themselves
fit the full-run budget; a supervising batch timeout reports such runs as failures.

Same-design candidates must preserve actual visible colour/source domains.
The experimental selection order is fragment-risk tier, exposed cut length,
piece count and physical layering burden. Risk measures identify both micro
pieces and long narrow strips; they are not deletion permissions or human truth.
Reusing the old Base is not a new hidden-completion benefit.

`PreviewStages` exposes content-bound pure CP-B/RC-A/selection reuse for short
development loops and strict completion/ranking calls. It returns
`PREVIEW_NOT_ACCEPTANCE`, never a cached acceptance PASS. Loaded source/dependency
changes require a new process; input/config changes miss the cache. Generation
uses private M1 assembly without the redundant initial full design replay.
Public M1 reconstruction and the final persisted read still independently replay
the source/design and reconstruct Component bindings and selected geometry.

Tests: `python -m unittest discover -s
benchmarks/fabrication-layer-decomposition/algorithm-v1/tests -p 'test_practical*.py' -v`.
Run the six discovery roots and six current read-only validators documented in
`VERIFICATION.md`; the known legacy helper failure remains separate. Frozen raw
Git bytes must be checked in an LF checkout, not silently rewritten in an
existing CRLF worktree. Final real-case and clean evidence is delivered separately.

INDEPENDENT_REVIEW=PENDING
USER_VISUAL_ACCEPTANCE=PENDING
MANUFACTURING=NOT_EVALUATED
PRODUCTION_EXPORT_ELIGIBLE=NO
