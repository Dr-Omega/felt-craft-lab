# P0-04B1.1 Local Color Purification — PROVISIONAL

Previous HEAD: `2301aa59d7278f54874c219c5e2689ee6153d8ea`. Its generated output is superseded because of severe over-segmentation and a CP-B contract mismatch.

All conclusions are provisional until human review. `false_merge_count`, `false_split_count`, and manual grades are intentionally not fabricated.

`within_region_color_variance_after` verifies only that each chosen region was unified. It cannot establish that its region proposal was correct; use the GT region-count diagnostics and human review for that question.

| Run | Status | Mean ms | Mean regions after | Mean / max GT ratio | Mean small components | Mean boundary shift |
|---|---:|---:|---:|---:|---:|---:|
| cp-a-aggressive_rc-a | SUCCESS | 2798.258 | 58.25 | 15.75625 / 35.0 | 57.25 | 0.64547598 |
| cp-a-balanced_rc-a | SUCCESS | 4586.163 | 249.75 | 84.31607 / 354.5 | 248.5 | 0.14587969 |
| cp-a-conservative_rc-a | SUCCESS | 5128.893 | 307.875 | 99.50893 / 383.0 | 306.5 | 0.13554408 |
| cp-b-aggressive_rc-a | SUCCESS | 2851.279 | 45.625 | 12.14018 / 35.0 | 44.625 | 0.6493917 |
| cp-b-balanced_rc-a | SUCCESS | 3780.212 | 146.375 | 48.24643 / 211.5 | 145.25 | 0.51005761 |
| cp-b-conservative_rc-a | SUCCESS | 4063.98 | 180.625 | 59.35268 / 263.0 | 179.375 | 0.38503975 |

## Per-fixture diagnostics

| Run | Fixture | GT approx | Regions | GT ratio (gate) | Small components | Boundary shift | Elapsed ms |
|---|---|---:|---:|---:|---:|---:|---:|
| cp-a-conservative_rc-a | FLD-001 | 2 | 766 | 383.0 (FAIL) | 765 | 0.00193326 | 12570.971 |
| cp-a-conservative_rc-a | FLD-002 | 4 | 111 | 27.75 (FAIL) | 109 | 0.03230453 | 1707.956 |
| cp-a-conservative_rc-a | FLD-003 | 5 | 1 | 0.2 (PASS) | 0 | 1.0 | 1668.971 |
| cp-a-conservative_rc-a | FLD-004 | 7 | 267 | 38.14285714 (FAIL) | 266 | 0.01183538 | 5428.861 |
| cp-a-conservative_rc-a | FLD-005 | 4 | 385 | 96.25 (FAIL) | 383 | 0.01083818 | 3110.21 |
| cp-a-conservative_rc-a | FLD-006 | 7 | 227 | 32.42857143 (FAIL) | 225 | 0.00449596 | 7019.027 |
| cp-a-conservative_rc-a | FLD-007 | 2 | 257 | 128.5 (FAIL) | 256 | 0.00961905 | 4226.674 |
| cp-a-conservative_rc-a | FLD-008 | 5 | 449 | 89.8 (FAIL) | 448 | 0.01332629 | 5298.474 |
| cp-a-balanced_rc-a | FLD-001 | 2 | 709 | 354.5 (FAIL) | 708 | 0.00174992 | 12885.082 |
| cp-a-balanced_rc-a | FLD-002 | 4 | 104 | 26.0 (FAIL) | 103 | 0.03103731 | 1697.455 |
| cp-a-balanced_rc-a | FLD-003 | 5 | 1 | 0.2 (PASS) | 0 | 1.0 | 2085.371 |
| cp-a-balanced_rc-a | FLD-004 | 7 | 160 | 22.85714286 (FAIL) | 159 | 0.09170817 | 4479.422 |
| cp-a-balanced_rc-a | FLD-005 | 4 | 280 | 70.0 (FAIL) | 278 | 0.01252127 | 2438.229 |
| cp-a-balanced_rc-a | FLD-006 | 7 | 137 | 19.57142857 (FAIL) | 135 | 0.00540599 | 5149.475 |
| cp-a-balanced_rc-a | FLD-007 | 2 | 200 | 100.0 (FAIL) | 199 | 0.01207678 | 3432.517 |
| cp-a-balanced_rc-a | FLD-008 | 5 | 407 | 81.4 (FAIL) | 406 | 0.01253806 | 4521.752 |
| cp-a-aggressive_rc-a | FLD-001 | 2 | 60 | 30.0 (FAIL) | 59 | 0.01630567 | 4144.622 |
| cp-a-aggressive_rc-a | FLD-002 | 4 | 6 | 1.5 (PASS) | 5 | 0.13319238 | 1253.887 |
| cp-a-aggressive_rc-a | FLD-003 | 5 | 1 | 0.2 (PASS) | 0 | 1.0 | 2035.871 |
| cp-a-aggressive_rc-a | FLD-004 | 7 | 145 | 20.71428571 (FAIL) | 144 | 1.0 | 4277.324 |
| cp-a-aggressive_rc-a | FLD-005 | 4 | 39 | 9.75 (WARN) | 38 | 1.0 | 1087.115 |
| cp-a-aggressive_rc-a | FLD-006 | 7 | 2 | 0.28571429 (PASS) | 1 | 1.0 | 4145.583 |
| cp-a-aggressive_rc-a | FLD-007 | 2 | 70 | 35.0 (FAIL) | 69 | 1.0 | 2609.722 |
| cp-a-aggressive_rc-a | FLD-008 | 5 | 143 | 28.6 (FAIL) | 142 | 0.01430981 | 2831.938 |
| cp-b-conservative_rc-a | FLD-001 | 2 | 526 | 263.0 (FAIL) | 525 | 0.00282047 | 10610.433 |
| cp-b-conservative_rc-a | FLD-002 | 4 | 53 | 13.25 (WARN) | 51 | 0.03346314 | 1670.692 |
| cp-b-conservative_rc-a | FLD-003 | 5 | 1 | 0.2 (PASS) | 0 | 1.0 | 2411.36 |
| cp-b-conservative_rc-a | FLD-004 | 7 | 142 | 20.28571429 (FAIL) | 141 | 1.0 | 3991.404 |
| cp-b-conservative_rc-a | FLD-005 | 4 | 276 | 69.0 (FAIL) | 274 | 0.01417853 | 2510.381 |
| cp-b-conservative_rc-a | FLD-006 | 7 | 23 | 3.28571429 (PASS) | 22 | 0.01541628 | 4315.641 |
| cp-b-conservative_rc-a | FLD-007 | 2 | 70 | 35.0 (FAIL) | 69 | 1.0 | 2739.523 |
| cp-b-conservative_rc-a | FLD-008 | 5 | 354 | 70.8 (FAIL) | 353 | 0.01443961 | 4262.408 |
| cp-b-balanced_rc-a | FLD-001 | 2 | 423 | 211.5 (FAIL) | 422 | 0.00342561 | 8927.009 |
| cp-b-balanced_rc-a | FLD-002 | 4 | 36 | 9.0 (WARN) | 35 | 0.04316808 | 1463.54 |
| cp-b-balanced_rc-a | FLD-003 | 5 | 1 | 0.2 (PASS) | 0 | 1.0 | 2541.356 |
| cp-b-balanced_rc-a | FLD-004 | 7 | 142 | 20.28571429 (FAIL) | 141 | 1.0 | 3960.889 |
| cp-b-balanced_rc-a | FLD-005 | 4 | 206 | 51.5 (FAIL) | 204 | 0.01901272 | 2117.866 |
| cp-b-balanced_rc-a | FLD-006 | 7 | 2 | 0.28571429 (PASS) | 1 | 1.0 | 4272.818 |
| cp-b-balanced_rc-a | FLD-007 | 2 | 70 | 35.0 (FAIL) | 69 | 1.0 | 2885.712 |
| cp-b-balanced_rc-a | FLD-008 | 5 | 291 | 58.2 (FAIL) | 290 | 0.01485448 | 4072.505 |
| cp-b-aggressive_rc-a | FLD-001 | 2 | 30 | 15.0 (WARN) | 29 | 0.0445889 | 4172.994 |
| cp-b-aggressive_rc-a | FLD-002 | 4 | 8 | 2.0 (PASS) | 7 | 0.13031614 | 1374.585 |
| cp-b-aggressive_rc-a | FLD-003 | 5 | 1 | 0.2 (PASS) | 0 | 1.0 | 2457.576 |
| cp-b-aggressive_rc-a | FLD-004 | 7 | 142 | 20.28571429 (FAIL) | 141 | 1.0 | 3956.151 |
| cp-b-aggressive_rc-a | FLD-005 | 4 | 39 | 9.75 (WARN) | 38 | 1.0 | 1267.848 |
| cp-b-aggressive_rc-a | FLD-006 | 7 | 2 | 0.28571429 (PASS) | 1 | 1.0 | 4243.272 |
| cp-b-aggressive_rc-a | FLD-007 | 2 | 70 | 35.0 (FAIL) | 69 | 1.0 | 2822.519 |
| cp-b-aggressive_rc-a | FLD-008 | 5 | 73 | 14.6 (WARN) | 72 | 0.02022855 | 2515.29 |

## Required interpretation

- Candidate stability, false merge/split risk, small-structure protection, representative-color stability, and failures require the linked manual review evidence.
- CP-C is unavailable, not substituted.
- G02 AI color-drift remains absent from the frozen fixture set; this limits conclusions about true AI drift.
