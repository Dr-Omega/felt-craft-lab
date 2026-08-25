# P0-04B1 Local Color Purification — PROVISIONAL

All conclusions are provisional until human review. `false_merge_count`, `false_split_count`, and manual grades are intentionally not fabricated.

| Run | Status | Mean ms | Mean regions after | Mean Lab variance | Mean boundary shift |
|---|---:|---:|---:|---:|---:|
| cp-a-balanced_rc-a | SUCCESS | 9899.461 | 1449.125 | 31.67971851 → 7.1e-07 | 0.01042602 |
| cp-a-balanced_rc-b | SUCCESS | 10049.67 | 1449.125 | 31.67971851 → 7.1e-07 | 0.01042602 |
| cp-a-balanced_rc-c | SUCCESS | 10444.848 | 1449.125 | 31.67971851 → 7.1e-07 | 0.01042602 |
| cp-b-balanced_rc-a | SUCCESS | 19823.504 | 2659.0 | 21.76090417 → 1.1e-07 | 0.01097674 |
| cp-b-balanced_rc-b | SUCCESS | 23928.771 | 2659.0 | 21.76090417 → 1.1e-07 | 0.01097674 |
| cp-b-balanced_rc-c | SUCCESS | 23424.784 | 2659.0 | 21.76090417 → 1.1e-07 | 0.01097674 |
| cp-c-balanced_rc-a | DEPENDENCY_UNAVAILABLE | — | — | — → — | — |
| cp-c-balanced_rc-b | DEPENDENCY_UNAVAILABLE | — | — | — → — | — |
| cp-c-balanced_rc-c | DEPENDENCY_UNAVAILABLE | — | — | — → — | — |

## Required interpretation

- Candidate stability, false merge/split risk, small-structure protection, representative-color stability, and failures require the linked manual review evidence.
- CP-C is unavailable, not substituted.
- G02 AI color-drift remains absent from the frozen fixture set; this limits conclusions about true AI drift.
