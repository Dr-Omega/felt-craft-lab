# P0-04B1.2 Color Region Semantics + Alpha Topology — PROVISIONAL

Previous HEAD: `2301aa59d7278f54874c219c5e2689ee6153d8ea`. Its generated output is superseded because of severe over-segmentation and a CP-B contract mismatch.

All conclusions are provisional until human review. `false_merge_count`, `false_split_count`, and manual grades are intentionally not fabricated.

`within_region_color_variance_after` verifies only that each chosen region was unified. It cannot establish that its region proposal was correct. `region_count_ratio_to_gt` is retained only as `SEMANTICALLY_APPROXIMATE`; B0 expectedColorRegions is compared diagnostically to experimental Color Groups, not directly to connected local labels.

| Run | Status | Mean ms | Mean Local Regions | Mean Color Groups | Mean / max group:GT ratio | Mean small components | Mean boundary shift |
|---|---:|---:|---:|---:|---:|---:|---:|
| cp-a-aggressive_rc-a | SUCCESS | 2547.593 | 58.25 | 6.0 | 2.16339 / 7.5 | 57.25 | 0.64547598 |
| cp-a-balanced_rc-a | SUCCESS | 4220.91 | 249.75 | 37.5 | 13.92679 / 60.0 | 248.5 | 0.14587969 |
| cp-b-aggressive_rc-a | SUCCESS | 7295.371 | 88.375 | 10.625 | 3.45357 / 11.5 | 80.125 | 0.01876406 |
| cp-b-balanced_rc-a | SUCCESS | 9747.94 | 277.75 | 22.25 | 7.76875 / 34.5 | 267.625 | 0.0025188 |

## Per-fixture diagnostics

| Run | Fixture | Geometry components | Local regions | Color groups | GT approx | Group:GT ratio (gate) | Fringe/orphan | Boundary shift | Elapsed ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cp-a-balanced_rc-a | FLD-001 | 20 | 709 | 120 | 2 | 60.0 (FAIL) | 0/0 | 0.00174992 (NORMAL) | 11553.712 |
| cp-a-balanced_rc-a | FLD-002 | 1 | 104 | 36 | 4 | 9.0 (WARN) | 0/0 | 0.03103731 (NORMAL) | 1485.802 |
| cp-a-balanced_rc-a | FLD-003 | 1 | 1 | 1 | 5 | 0.2 (FAIL) | 0/0 | 1.0 (NO_CANDIDATE_BOUNDARY) | 1743.943 |
| cp-a-balanced_rc-a | FLD-004 | 142 | 160 | 12 | 7 | 1.71428571 (PASS) | 0/0 | 0.09170817 (NORMAL) | 4118.802 |
| cp-a-balanced_rc-a | FLD-005 | 39 | 280 | 48 | 4 | 12.0 (WARN) | 0/0 | 0.01252127 (NORMAL) | 1945.773 |
| cp-a-balanced_rc-a | FLD-006 | 2 | 137 | 7 | 7 | 1.0 (PASS) | 0/0 | 0.00540599 (NORMAL) | 5079.42 |
| cp-a-balanced_rc-a | FLD-007 | 70 | 200 | 41 | 2 | 20.5 (FAIL) | 0/0 | 0.01207678 (NORMAL) | 3321.311 |
| cp-a-balanced_rc-a | FLD-008 | 1 | 407 | 35 | 5 | 7.0 (WARN) | 0/0 | 0.01253806 (NORMAL) | 4518.518 |
| cp-a-aggressive_rc-a | FLD-001 | 20 | 60 | 15 | 2 | 7.5 (WARN) | 0/0 | 0.01630567 (NORMAL) | 3572.556 |
| cp-a-aggressive_rc-a | FLD-002 | 1 | 6 | 3 | 4 | 0.75 (PASS) | 0/0 | 0.13319238 (NORMAL) | 1257.675 |
| cp-a-aggressive_rc-a | FLD-003 | 1 | 1 | 1 | 5 | 0.2 (FAIL) | 0/0 | 1.0 (NO_CANDIDATE_BOUNDARY) | 1820.691 |
| cp-a-aggressive_rc-a | FLD-004 | 142 | 145 | 4 | 7 | 0.57142857 (PASS) | 0/0 | 1.0 (NO_CANDIDATE_BOUNDARY) | 4195.061 |
| cp-a-aggressive_rc-a | FLD-005 | 39 | 39 | 2 | 4 | 0.5 (PASS) | 0/0 | 1.0 (NO_CANDIDATE_BOUNDARY) | 943.015 |
| cp-a-aggressive_rc-a | FLD-006 | 2 | 2 | 2 | 7 | 0.28571429 (WARN) | 0/0 | 1.0 (NO_CANDIDATE_BOUNDARY) | 3376.537 |
| cp-a-aggressive_rc-a | FLD-007 | 70 | 70 | 11 | 2 | 5.5 (WARN) | 0/0 | 1.0 (NO_CANDIDATE_BOUNDARY) | 2517.27 |
| cp-a-aggressive_rc-a | FLD-008 | 1 | 143 | 10 | 5 | 2.0 (PASS) | 0/0 | 0.01430981 (NORMAL) | 2697.938 |
| cp-b-balanced_rc-a | FLD-001 | 20 | 497 | 69 | 2 | 34.5 (FAIL) | 0/0 | 0.00027828 (NORMAL) | 12385.198 |
| cp-b-balanced_rc-a | FLD-002 | 1 | 74 | 12 | 4 | 3.0 (PASS) | 0/0 | 0.00089948 (NORMAL) | 7133.119 |
| cp-b-balanced_rc-a | FLD-003 | 1 | 18 | 4 | 5 | 0.8 (PASS) | 0/0 | 0.01508677 (NORMAL) | 6176.355 |
| cp-b-balanced_rc-a | FLD-004 | 142 | 513 | 23 | 7 | 3.28571429 (PASS) | 0/0 | 0.00013109 (NORMAL) | 21104.785 |
| cp-b-balanced_rc-a | FLD-005 | 39 | 200 | 19 | 4 | 4.75 (PASS) | 0/0 | 0.00051001 (NORMAL) | 3254.891 |
| cp-b-balanced_rc-a | FLD-006 | 2 | 421 | 12 | 7 | 1.71428571 (PASS) | 0/0 | 0.00252091 (NORMAL) | 12071.107 |
| cp-b-balanced_rc-a | FLD-007 | 70 | 121 | 21 | 2 | 10.5 (WARN) | 0/0 | 0.00020884 (NORMAL) | 7616.119 |
| cp-b-balanced_rc-a | FLD-008 | 1 | 378 | 18 | 5 | 3.6 (PASS) | 0/0 | 0.00051503 (NORMAL) | 8241.945 |
| cp-b-aggressive_rc-a | FLD-001 | 20 | 108 | 23 | 2 | 11.5 (WARN) | 0/0 | 0.00091733 (NORMAL) | 5273.41 |
| cp-b-aggressive_rc-a | FLD-002 | 1 | 13 | 6 | 4 | 1.5 (PASS) | 0/0 | 0.00272533 (NORMAL) | 5640.203 |
| cp-b-aggressive_rc-a | FLD-003 | 1 | 18 | 4 | 5 | 0.8 (PASS) | 0/0 | 0.12524788 (NORMAL) | 5392.862 |
| cp-b-aggressive_rc-a | FLD-004 | 142 | 330 | 19 | 7 | 2.71428571 (PASS) | 0/0 | 0.00035533 (NORMAL) | 17114.928 |
| cp-b-aggressive_rc-a | FLD-005 | 39 | 68 | 6 | 4 | 1.5 (PASS) | 0/0 | 0.00078225 (NORMAL) | 3229.113 |
| cp-b-aggressive_rc-a | FLD-006 | 2 | 28 | 5 | 7 | 0.71428571 (PASS) | 0/0 | 0.00433651 (NORMAL) | 8100.204 |
| cp-b-aggressive_rc-a | FLD-007 | 70 | 104 | 15 | 2 | 7.5 (WARN) | 0/0 | 0.01254038 (NORMAL) | 7561.851 |
| cp-b-aggressive_rc-a | FLD-008 | 1 | 38 | 7 | 5 | 1.4 (PASS) | 0/0 | 0.00320746 (NORMAL) | 6050.397 |

## Required interpretation

- Candidate stability, false merge/split risk, small-structure protection, representative-color stability, and failures require the linked manual review evidence.
- CP-C is unavailable, not substituted.
- G02 AI color-drift remains absent from the frozen fixture set; this limits conclusions about true AI drift.
