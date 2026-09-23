# Same-machine measured results

Base `2cc7bf7ebbf1f56b53c9a142019dd09ec216b696`; candidate implementation
is the accompanying `solid_plans.py`. Raw measurement records bind its SHA-256
and each generated recipe. This is an interactive Windows workstation, not a
latency SLO or statistical-significance claim.

## Method

- Serial order B1/O1/O2/B2/B3/O3; no concurrent benchmark or test suites.
- Same i9-13980HX (24 cores / 32 threads), 33,959,829,504 physical memory bytes,
  Windows 11 build 26200, Python 3.12.14, Node 24.14.1.
- NumPy 2.2.6, OpenCV headless 4.12.0.88, Pillow 12.3.0, scikit-image 0.25.2,
  Shapely 2.1.2, SciPy 1.18.1; same original input snapshots and configuration.
- Separate new output directories. First run uses a fresh checkout-specific
  TypeScript compile cache; repeats reuse it. Imports recorded separately;
  filesystem caches not flushed. First synthetic ring includes first compilation;
  all real cases follow it and other synthetic cases in each process.
- Table uses the outer complete case timer in `examples.json`, including its
  result-record/read work, not the slightly shorter internal `execution.json`
  timer. Full-process workflow totals additionally include all nine cases and
  summary output. No profiling or function wrappers in these six runs.
- cProfile and function-memory sampling runs are separate localization evidence,
  not inputs to speed ratios. Their cumulative times overlap. Historical
  492.20 / 53.31 / 121.38 observations are not used.

## Per-case seconds: every run and median

| Case | Baseline 1 / 2 / 3 | Candidate 1 / 2 / 3 | Median before → after | Median reduction |
|---|---|---|---|---|
| Crescent | 475.871 / 483.768 / 467.064 | 200.606 / 183.344 / 185.261 | 475.871 → 185.261 | 61.07% |
| Envelope | 51.589 / 54.554 / 48.186 | 41.539 / 35.122 / 37.651 | 51.589 → 37.651 | 27.02% |
| Mooncake | 125.664 / 123.601 / 116.690 | 84.670 / 82.492 / 76.574 | 123.601 → 82.492 | 33.26% |
| Synthetic ring | 1.339 / 0.840 / 0.809 | 1.370 / 0.773 / 0.874 | 0.840 → 0.874 | -4.04% |
| Base tradeoff | 0.707 / 0.702 / 0.701 | 0.678 / 0.734 / 0.718 | 0.702 → 0.718 | -2.25% |
| Diagonal/fringe | 0.538 / 0.581 / 0.559 | 0.550 / 0.837 / 0.545 | 0.559 → 0.550 | 1.59% |
| Legal SVG | 0.744 / 0.662 / 0.570 | 0.673 / 0.666 / 0.596 | 0.662 → 0.666 | -0.69% |
| Legal PSD | 0.699 / 0.640 / 0.678 | 0.821 / 0.746 / 0.575 | 0.678 → 0.746 | -10.06% |
| Unsupported PSD, expected refusal | 0.027 / 0.023 / 0.019 | 0.020 / 0.022 / 0.022 | 0.023 → 0.022 | Not a successful-processing speed claim |

Small cases do **not** show reliable broad improvement: the ring, tradeoff, SVG
and PSD medians are slightly higher, with tens-of-milliseconds differences and
visible variation. Retaining the small index is supported by the substantial
large real-case benefit, not by claiming every function/case got faster.

Full nine-case workflow: baseline 657.207 / 665.422 / 635.306 seconds;
candidate 330.959 / 304.768 / 302.845 seconds. Median 657.207 → 304.768 seconds
(53.63% lower). No candidates, relationships, diagnostics, final file reread or
shared checks were omitted.

## Memory

Windows process high-water measurements over each complete nine-case Python
process; excludes child Node and is not total system memory or exclusive
function allocation:

| Metric (bytes) | Baseline runs | Candidate runs | Median before → after |
|---|---|---|---|
| Peak working set / RSS | 358998016 / 351436800 / 353910784 | 348229632 / 343441408 / 350220288 | 353910784 → 348229632 |
| Peak private committed bytes | 1951637504 / 1943969792 / 1946624000 | 1940254720 / 1935347712 / 1942097920 | 1946624000 → 1940254720 |

Memory is broadly similar; these three observations are not evidence of a
general memory-saving guarantee. Separate profile samples record whole-process
RSS/private bytes at hot-function entry/exit; they are not transient exclusive
per-function peaks and must not be summed across parents and children.

## Correctness and evidence boundaries

Initial baseline/candidate comparison passed all eight exact algorithm cases
and the expected unsupported PSD refusal. The accompanying final parity summary
adds every repeated run and committed clean-checkout identity comparison.
The six Python suites plus shared contract suite discovered/passed 281 tests
(original 276 retained + 5), with 0 failures/errors/skips in the completed
development verification. Six current validators passed and 844 frozen files
matched original raw Git blobs. Final clean-checkout logs are delivered alongside.

The obsolete `validate_region_core_contract.py` still fails with
`KeyError: 'artifactSha256'`; it is not a passing current gate. An initial
sandbox-only Vitest startup failure was rerun successfully with filesystem
access; both logs remain visible. The first baseline profile's post-run memory
collector had a Windows HANDLE binding error; its successful algorithm/profile
data is retained for localization only, with no invented peak-memory result.

See `VISUAL_FINDINGS.md` and the standalone actual-image `overview.html` for
located observations. Exact rerendering/algorithm parity is not human quality
approval. Final independent audit and manual visual review remain pending;
manufacturing is not evaluated and production export is not eligible.
