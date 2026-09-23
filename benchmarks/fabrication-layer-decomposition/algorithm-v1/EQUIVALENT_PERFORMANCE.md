# Equivalent-performance audit batch

Fixed comparison base: `2cc7bf7ebbf1f56b53c9a142019dd09ec216b696`.
Branch: `audit/fabrication-m4-m7-equivalent-performance`.

## Measured cause and deliberately limited change

An external cProfile run of the real crescent on the fixed base identified
`_actual_parents` inside repeated `validate_plan` calls as the principal hotspot:
760 validations, 29,666,198 `_intersects_area` calls. Inclusive times overlap;
they are not independent stages and must not be added. The existing shared
TypeScript validator accounted for a much smaller part of that profile, so its
compilation, execution, canonicalization and hashing are unchanged.

`solid_plans._AreaIndex` constructs invocation-local STRtrees for sources and
actual parents. Envelope queries are only a conservative broad phase. The exact
strict-bounds/positive-intersection-area predicate is retained; result indices
are sorted to restore original input order, including duplicate geometries.
Only that pure predicate is memoized, keyed by the two complete WKB operands.
Immutable geometry bounds and WKB are prepared once per index/query rather
than serialized once per candidate pair. An intermediate profile exposed that
serialization cost and motivated the latter change.

The index is reconstructed from the current call's sources and parents.
No plan-ID verdict, declaration, provenance, source/color identity, relation,
split-group membership, score or evidence is cached. Existing checks, parent
recovery, complete physical seams, independent persisted-file reread and actual
shared validation still run. No geometry tolerance, profile, candidate, ranking,
resolution, partition or frozen algorithm was changed.

## Regressions

`tests/test_equivalent_performance.py` adds five tests for exact broad-phase
parity (duplicates, contacts, tiny positive areas, holes and empty indexes),
both full geometry cache keys (including equal envelopes with different
interiors), and warm-cache rejection of changed colors, sources, provenance,
geometry, split membership and physical seams. The prior suites and adversarial
persisted-result tests are retained unchanged. See `VERIFICATION.md` for the
six suite roots, shared contract suite and six current read-only validators.
The known obsolete `validate_region_core_contract.py` failure remains separately
reported; it is not counted as a passing current gate.

## Measurement and review evidence

The accompanying evidence bundle contains the external measurement harness,
raw per-command logs, profiles, interleaved uninstrumented B1/O1/O2/B2/B3/O3
runs, exact result comparisons and the post-commit clean-checkout verification.
Baseline and candidate use the same machine, interpreter, dependencies, inputs,
configuration and full nine-case workflow (eight successes, one expected PSD
refusal). They run serially in new output directories. Imports and per-checkout
first TypeScript compilation are separated from repeat observations. Profiling
numbers and historical 492.20/53.31/121.38 observations are never used as the
before/after performance comparison. Peak Python process memory excludes child
Node processes and is labeled as such, not presented as total system memory.

Pixel/label arrays, exact colors, vectors, candidate set/order, Base/exposure and
Piece geometry, split groups, seams, scores, relations and independent reread
statistics are compared exactly. The sole cross-version identity exception is
the changed implementation recipe artifact and its enclosing result identity;
new-version development/clean stable identities must match byte-for-byte.

Old 2cc7bf7 audit material remains read-only and separately inventoried. The
visual overview references actual PNGs and located source-pixel coordinates;
fragment counts or exact render-back parity are not human quality approval.

INDEPENDENT_FINAL_AUDIT=PENDING
VISUAL_QUALITY=PENDING_MANUAL_REVIEW
MANUFACTURING=NOT_EVALUATED
PRODUCTION_EXPORT_ELIGIBLE=NO
M8_STARTED_BY_THIS_BATCH=NO
