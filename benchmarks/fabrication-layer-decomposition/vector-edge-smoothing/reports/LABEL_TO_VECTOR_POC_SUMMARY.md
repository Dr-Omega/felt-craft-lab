# P0-04C Label-to-Vector Edge Smoothing PoC

Status: `POC_EVIDENCE_COMPLETE_PENDING_EXTERNAL_VECTOR_REVIEW`

V0 byte-identical: 16/16

No V1/V2 winner or production tolerance is selected.

| Profile | Case | Route | Tol px | Hard Gate | Symmetric max px | Area error | Lines | Cubics | Fallbacks |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| cp-b-aggressive_rc-a | FLD-001 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 5593 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-001 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.560880 | 0.00000000 | 4225 | 0 | 21 |
| cp-b-aggressive_rc-a | FLD-001 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.560880 | 0.00000000 | 3704 | 280 | 73 |
| cp-b-aggressive_rc-a | FLD-001 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 0.957013 | 0.00000909 | 5563 | 0 | 343 |
| cp-b-aggressive_rc-a | FLD-001 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.027390 | 0.00001817 | 5211 | 165 | 211 |
| cp-b-aggressive_rc-a | FLD-001 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 0.957013 | 0.00000909 | 5570 | 0 | 346 |
| cp-b-aggressive_rc-a | FLD-001 | V2_SMOOTH_BEZIER | 2.0 | PASS | 1.978653 | 0.00127208 | 2567 | 407 | 15 |
| cp-b-aggressive_rc-a | FLD-002 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 9862 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-002 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561249 | 0.00000000 | 2551 | 0 | 1 |
| cp-b-aggressive_rc-a | FLD-002 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561249 | 0.00000000 | 2551 | 12 | 19 |
| cp-b-aggressive_rc-a | FLD-002 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00140135 | 5389 | 0 | 29 |
| cp-b-aggressive_rc-a | FLD-002 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.062500 | 0.00157254 | 5092 | 36 | 18 |
| cp-b-aggressive_rc-a | FLD-002 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 1.958468 | 0.00222797 | 5307 | 0 | 29 |
| cp-b-aggressive_rc-a | FLD-002 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.015266 | 0.00249944 | 3577 | 125 | 13 |
| cp-b-aggressive_rc-a | FLD-003 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 11977 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-003 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561915 | 0.00000000 | 7798 | 0 | 4 |
| cp-b-aggressive_rc-a | FLD-003 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561915 | 0.00000000 | 7790 | 9 | 28 |
| cp-b-aggressive_rc-a | FLD-003 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00001483 | 6893 | 0 | 20 |
| cp-b-aggressive_rc-a | FLD-003 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.062500 | 0.00001483 | 6796 | 68 | 30 |
| cp-b-aggressive_rc-a | FLD-003 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 2.030308 | 0.00027290 | 6571 | 0 | 20 |
| cp-b-aggressive_rc-a | FLD-003 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.054422 | 0.00027290 | 6433 | 175 | 21 |
| cp-b-aggressive_rc-a | FLD-004 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 19425 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-004 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561249 | 0.00000000 | 13023 | 0 | 99 |
| cp-b-aggressive_rc-a | FLD-004 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561249 | 0.00000000 | 11683 | 806 | 186 |
| cp-b-aggressive_rc-a | FLD-004 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 0.062500 | 0.00000000 | 19425 | 0 | 1143 |
| cp-b-aggressive_rc-a | FLD-004 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.046566 | 0.00002157 | 17201 | 654 | 574 |
| cp-b-aggressive_rc-a | FLD-004 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 0.062500 | 0.00000000 | 19425 | 0 | 1143 |
| cp-b-aggressive_rc-a | FLD-004 | V2_SMOOTH_BEZIER | 2.0 | PASS | 1.681322 | 0.00006471 | 17135 | 622 | 571 |
| cp-b-aggressive_rc-a | FLD-005 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 7534 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-005 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561742 | 0.00000000 | 1755 | 0 | 1 |
| cp-b-aggressive_rc-a | FLD-005 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561742 | 0.00000000 | 1553 | 106 | 23 |
| cp-b-aggressive_rc-a | FLD-005 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 0.062500 | 0.00000000 | 7386 | 0 | 121 |
| cp-b-aggressive_rc-a | FLD-005 | V2_SMOOTH_BEZIER | 1.0 | PASS | 0.894818 | 0.00001400 | 6799 | 62 | 73 |
| cp-b-aggressive_rc-a | FLD-005 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 0.062500 | 0.00000000 | 7386 | 0 | 121 |
| cp-b-aggressive_rc-a | FLD-005 | V2_SMOOTH_BEZIER | 2.0 | PASS | 0.878176 | 0.00001400 | 6799 | 62 | 73 |
| cp-b-aggressive_rc-a | FLD-006 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 8509 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-006 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561742 | 0.00000000 | 6293 | 0 | 6 |
| cp-b-aggressive_rc-a | FLD-006 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561742 | 0.00000000 | 6228 | 35 | 26 |
| cp-b-aggressive_rc-a | FLD-006 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00000779 | 8063 | 0 | 72 |
| cp-b-aggressive_rc-a | FLD-006 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.044321 | 0.00001169 | 6928 | 148 | 15 |
| cp-b-aggressive_rc-a | FLD-006 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 2.038113 | 0.00000779 | 8049 | 0 | 73 |
| cp-b-aggressive_rc-a | FLD-006 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.031446 | 0.00116135 | 4847 | 212 | 7 |
| cp-b-aggressive_rc-a | FLD-007 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 10424 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-007 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.562360 | 0.00000000 | 5564 | 0 | 43 |
| cp-b-aggressive_rc-a | FLD-007 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.562360 | 0.00000000 | 5054 | 278 | 114 |
| cp-b-aggressive_rc-a | FLD-007 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 0.062500 | 0.00000000 | 10424 | 0 | 311 |
| cp-b-aggressive_rc-a | FLD-007 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.057623 | 0.00000729 | 8719 | 322 | 152 |
| cp-b-aggressive_rc-a | FLD-007 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 0.062500 | 0.00000000 | 10424 | 0 | 311 |
| cp-b-aggressive_rc-a | FLD-007 | V2_SMOOTH_BEZIER | 2.0 | PASS | 1.575920 | 0.00010454 | 9616 | 184 | 205 |
| cp-b-aggressive_rc-a | FLD-008 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 14202 | 0 | 0 |
| cp-b-aggressive_rc-a | FLD-008 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561915 | 0.00000000 | 6707 | 0 | 3 |
| cp-b-aggressive_rc-a | FLD-008 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561915 | 0.00000000 | 6488 | 139 | 79 |
| cp-b-aggressive_rc-a | FLD-008 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 0.062500 | 0.00000000 | 14202 | 0 | 221 |
| cp-b-aggressive_rc-a | FLD-008 | V2_SMOOTH_BEZIER | 1.0 | PASS | 0.708433 | 0.00000000 | 14086 | 47 | 174 |
| cp-b-aggressive_rc-a | FLD-008 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 0.062500 | 0.00000000 | 14202 | 0 | 221 |
| cp-b-aggressive_rc-a | FLD-008 | V2_SMOOTH_BEZIER | 2.0 | PASS | 0.708433 | 0.00000000 | 14086 | 47 | 174 |
| cp-b-balanced_rc-a | FLD-001 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 6811 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-001 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.560880 | 0.00000000 | 4171 | 0 | 20 |
| cp-b-balanced_rc-a | FLD-001 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.560961 | 0.00000000 | 2282 | 962 | 86 |
| cp-b-balanced_rc-a | FLD-001 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00000909 | 6726 | 0 | 1469 |
| cp-b-balanced_rc-a | FLD-001 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.062500 | 0.00020898 | 1134 | 1355 | 25 |
| cp-b-balanced_rc-a | FLD-001 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 1.958682 | 0.00000000 | 6738 | 0 | 1476 |
| cp-b-balanced_rc-a | FLD-001 | V2_SMOOTH_BEZIER | 2.0 | PASS | 1.846990 | 0.00041797 | 326 | 1361 | 14 |
| cp-b-balanced_rc-a | FLD-002 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 9333 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-002 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.562499 | 0.00000000 | 2247 | 0 | 1 |
| cp-b-balanced_rc-a | FLD-002 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.562499 | 0.00000000 | 2145 | 60 | 7 |
| cp-b-balanced_rc-a | FLD-002 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00074836 | 4501 | 0 | 165 |
| cp-b-balanced_rc-a | FLD-002 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.062500 | 0.00077282 | 935 | 180 | 5 |
| cp-b-balanced_rc-a | FLD-002 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 2.048756 | 0.00087798 | 4336 | 0 | 165 |
| cp-b-balanced_rc-a | FLD-002 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.048756 | 0.00088287 | 719 | 240 | 2 |
| cp-b-balanced_rc-a | FLD-003 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 11841 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-003 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561249 | 0.00000000 | 6492 | 0 | 4 |
| cp-b-balanced_rc-a | FLD-003 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561249 | 0.00000000 | 6442 | 35 | 34 |
| cp-b-balanced_rc-a | FLD-003 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00014238 | 4534 | 0 | 58 |
| cp-b-balanced_rc-a | FLD-003 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.062500 | 0.00014238 | 4467 | 45 | 69 |
| cp-b-balanced_rc-a | FLD-003 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 2.062500 | 0.00009492 | 4089 | 0 | 58 |
| cp-b-balanced_rc-a | FLD-003 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.054607 | 0.00067928 | 3842 | 266 | 58 |
| cp-b-balanced_rc-a | FLD-004 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 20626 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-004 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.562360 | 0.00000000 | 12324 | 0 | 98 |
| cp-b-balanced_rc-a | FLD-004 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.562360 | 0.00000000 | 10943 | 877 | 196 |
| cp-b-balanced_rc-a | FLD-004 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.049135 | 0.00000000 | 20584 | 0 | 1467 |
| cp-b-balanced_rc-a | FLD-004 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.054244 | 0.00007280 | 12561 | 1456 | 124 |
| cp-b-balanced_rc-a | FLD-004 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 0.846979 | 0.00000000 | 20619 | 0 | 1468 |
| cp-b-balanced_rc-a | FLD-004 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.055264 | 0.00022378 | 9400 | 1469 | 145 |
| cp-b-balanced_rc-a | FLD-005 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 6898 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-005 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561526 | 0.00000000 | 2023 | 0 | 1 |
| cp-b-balanced_rc-a | FLD-005 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561526 | 0.00000000 | 1413 | 319 | 14 |
| cp-b-balanced_rc-a | FLD-005 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00164505 | 2417 | 0 | 394 |
| cp-b-balanced_rc-a | FLD-005 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.060481 | 0.00013300 | 363 | 484 | 9 |
| cp-b-balanced_rc-a | FLD-005 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 2.032239 | 0.00243607 | 2345 | 0 | 394 |
| cp-b-balanced_rc-a | FLD-005 | V2_SMOOTH_BEZIER | 2.0 | PASS | 1.993418 | 0.00028001 | 251 | 545 | 2 |
| cp-b-balanced_rc-a | FLD-006 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 10351 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-006 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561526 | 0.00000000 | 7725 | 0 | 7 |
| cp-b-balanced_rc-a | FLD-006 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561526 | 0.00000000 | 6635 | 586 | 46 |
| cp-b-balanced_rc-a | FLD-006 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.062500 | 0.00023773 | 8467 | 0 | 1001 |
| cp-b-balanced_rc-a | FLD-006 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.062500 | 0.00016368 | 4909 | 1127 | 11 |
| cp-b-balanced_rc-a | FLD-006 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 1.988987 | 0.00107562 | 8679 | 0 | 1049 |
| cp-b-balanced_rc-a | FLD-006 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.050709 | 0.00037023 | 4886 | 1129 | 13 |
| cp-b-balanced_rc-a | FLD-007 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 12977 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-007 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.562360 | 0.00000000 | 7235 | 0 | 52 |
| cp-b-balanced_rc-a | FLD-007 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.562360 | 0.00000000 | 6717 | 285 | 124 |
| cp-b-balanced_rc-a | FLD-007 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 0.805281 | 0.00000000 | 12958 | 0 | 333 |
| cp-b-balanced_rc-a | FLD-007 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.061881 | 0.00002188 | 11324 | 292 | 174 |
| cp-b-balanced_rc-a | FLD-007 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 1.083991 | 0.00000000 | 12955 | 0 | 333 |
| cp-b-balanced_rc-a | FLD-007 | V2_SMOOTH_BEZIER | 2.0 | PASS | 1.873413 | 0.00015073 | 11629 | 233 | 188 |
| cp-b-balanced_rc-a | FLD-008 | V0_EXACT_PIXEL_BOUNDARY | - | PASS | 0.000000 | 0.00000000 | 12465 | 0 | 0 |
| cp-b-balanced_rc-a | FLD-008 | V1_SIMPLIFIED_POLYGON | 0.5 | PASS | 0.561742 | 0.00000000 | 6039 | 0 | 7 |
| cp-b-balanced_rc-a | FLD-008 | V2_SMOOTH_BEZIER | 0.5 | PASS | 0.561742 | 0.00000000 | 4792 | 684 | 75 |
| cp-b-balanced_rc-a | FLD-008 | V1_SIMPLIFIED_POLYGON | 1.0 | PASS | 1.054778 | 0.00001312 | 12358 | 0 | 1254 |
| cp-b-balanced_rc-a | FLD-008 | V2_SMOOTH_BEZIER | 1.0 | PASS | 1.059341 | 0.00020002 | 7482 | 1080 | 107 |
| cp-b-balanced_rc-a | FLD-008 | V1_SIMPLIFIED_POLYGON | 2.0 | PASS | 1.935229 | 0.00001312 | 12455 | 0 | 1270 |
| cp-b-balanced_rc-a | FLD-008 | V2_SMOOTH_BEZIER | 2.0 | PASS | 2.057457 | 0.00047545 | 4578 | 1178 | 86 |

## Safety interpretation

All shared boundaries are fitted once and referenced by direction. Any ambiguous curve is locally downgraded V2→V1→V0. FLD-007 retains all 29 structural zero-component holes; the six B0 principal voids remain a separate diagnostic and no small hole is deleted.

## External decision required

Review the same-scale contact sheets for smoothness, tip/corner retention, thin features, and hand-cut suitability. This PoC does not promote either route to Production.
