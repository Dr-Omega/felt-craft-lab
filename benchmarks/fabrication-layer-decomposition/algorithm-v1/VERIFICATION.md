# Verification and completion evidence map

This file identifies executable evidence, not a blanket algorithm/quality PASS.
All commands run from the repository root with an isolated Python 3.12
environment containing `algorithm-v1/requirements.txt`. The actual test counts,
exit codes, logs, commit and run hashes belong to the accompanying batch report.
Do not infer human acceptance from test counts.

## Requirement → implementation → regression

| Requirement | Implementation | Executable evidence |
|---|---|---|
| Effective-alpha structure and fringe checked independently | `tools/m4_checks.py:validate_labels` | `tests/test_m4_closure.py` missing/extra/misassigned labels, alpha/dtype/frame faults |
| Actual selected vector rings, IDs and preview | `candidate_polygons`, `m4_runtime._numbered_preview` | M4 closure edge/direction/hole/route/Component mutation tests |
| Input snapshots, deterministic identity, write failure and output isolation | `m4_runtime.run_runtime`, `algorithm_runtime.run_algorithm` | M4 closure and `test_algorithm_runtime.py`; actual decode/import-order/fallback and page failures |
| Exact M1 input without fake solids | `m1_adapter.build_input`, shared `validateFabricationInput` | `test_m1_adapter.py`, shared standalone/embedded input parity tests |
| Finite real PSD/SVG and rejection boundaries | `layered_sources.py` | `test_layered_sources.py`, actual generated files in `run_examples.py` |
| Located visual directions and unknowns | `relations.visual_relations` | `test_relations.py`, excluded-layer/letterbox integration counterexamples |
| Final Piece support, remapping, independence and conflicts | `relations.assembly_relations` | same tests: support, all-pair IDs, conflict/cycle rejection and exact-cache parity |
| Actual Base choices, hole-free splits, conservation and complete seams | `solid_plans.py` | `test_solid_plans.py`, ring/tradeoff and three project sources |
| Real b2.result/1, pending b2.structure/1 | `result_wire.py` and real shared TypeScript bridge | `test_result_wire.py`; geometry/evidence/results tied by SHA, no aggregate PASS |
| Independent render of persisted actual Piece geometry | `rerender.py` | `test_rerender.py`; byte/ref/frame/geometry/void/seam/ordering faults, original-boundary tie semantics |
| Full flat and layered path, truthful failed path, reproducibility | `algorithm_runtime.py`, `run_examples.py` | integration/adversarial tests plus complete regenerated example directories |
| Human effects are separate | `VISUAL_REVIEW.md` and actual images | three located project inspections; quality pending, false merge/split unassessed |

## Full test commands

Use the following six Python discovery roots with
`PYTHON -m unittest discover -s ROOT -v`:

```text
benchmarks/fabrication-layer-decomposition/algorithm-v1/tests
benchmarks/fabrication-layer-decomposition/tests
benchmarks/fabrication-layer-decomposition/candidates/color-purification/tests
benchmarks/fabrication-layer-decomposition/region-core/tests
benchmarks/fabrication-layer-decomposition/vector-edge-smoothing/tests
benchmarks/fabrication-layer-decomposition/fabrication-decomposition/tests
```

Run the repository's existing Node/Vitest environment (no dependency install by
the runtime): `node NODE_MODULES/vitest/vitest.mjs run tests/shared/fabrication-contract.test.ts`.
Set `NODE_PATH=NODE_MODULES` and `TYPESCRIPT_TSC=NODE_MODULES/typescript/lib/tsc.js`
when using external preinstalled dependencies. An esbuild sandbox denial is a
test-launch failure, not a failed assertion; preserve that log and rerun with
authorized local process access.

## Read-only upstream gates

Run each with `PYTHON benchmarks/fabrication-layer-decomposition/tools/NAME.py`:

```text
validate_benchmark
validate_region_core
validate_region_core_freeze
validate_vector_edge_smoothing
validate_vector_edge_smoothing_freeze
validate_b2_v0
```

Compare the tracked candidate/kernel/fixture/output/report/schema file bytes
before and after. Also compare frozen tracked paths against the task base Git
blobs, not only each other. No old hash or frozen output may be regenerated to
make a gate green. The test suites retain their original tests, including their
existing temporary fault-injection behavior; final byte snapshots must agree.

An additionally executed **legacy** `validate_region_core_contract.py` fails on
the unchanged baseline with `KeyError: artifactSha256`: it requires an obsolete
top-level field while the frozen records use `artifacts`/`provenance`. Its exit
status is a failure and must remain visible in the report. The current Region
Core validator and Region Core freeze gate are separate and must actually pass.
Do not patch frozen records or pretend every utility returned exit zero.
`validate_representative_determinism.py` is not a read-only validator: it writes
frozen evidence, so existing determinism evidence is instead checked by the
read-only freeze gate.

## Clean checkout and real evidence

After the normal commit, create a new detached clean worktree with
`git -c core.autocrlf=false worktree add --detach NEW_PATH COMMIT`. This is a
per-command LF checkout choice, not a global Git setting or business-file
rewrite. Run all six test suites, shared tests, upstream gates and
`PYTHON benchmarks/fabrication-layer-decomposition/algorithm-v1/run_examples.py --output NEW_EMPTY_OUTPUT`.

Compare each successful example's stable `fabrication-result.json` identity,
selected plan, actual geometry, input object and geometry-checks bytes between
the development and clean-checkout runs. Paths/durations in `execution.json`
and source locators in `examples.json` are intentionally not stable identity.
Verify every recorded artifact digest and the source snapshots. The deliberately
unsupported PSD must have an explicit failure with no completed report/result.

The local report should include full branch/base/commit/remote SHAs, actual
commands and log locations, per-case source hashes, timings and geometry
results. Normal push only to the batch audit branch; formal M3/B2 and original
M4/R4 worktrees remain unchanged. Stop at an audit candidate, not M8 or a
production release.
