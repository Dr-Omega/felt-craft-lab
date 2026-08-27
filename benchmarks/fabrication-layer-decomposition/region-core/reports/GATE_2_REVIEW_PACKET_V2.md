# Gate 2 Review Packet V2

Status: `PENDING_EXTERNAL_GATE_2_REVIEW_V2`. Repair Apply remains `NOT_EXECUTED`.

Gate 1 is `APPROVED`; Region Core Production representative is frozen to `RC-A`. RC-B/C/D remain benchmark-only.

## Corrected shared-boundary metric

`sharedBoundaryCoverage = unique_shared_edge_count / min(regionA_perimeter_edge_count, regionB_perimeter_edge_count)`. Perimeters count exposed four-connected grid edges. The value is enforced in `[0,1]`. The rejected V1 field divided by region area, which allowed values above one for thin regions.

## Synthetic direct-edge evidence

| Fixture | Profile | Relation | Direct | Rep ΔE00 | Boundary mean/median/P90 | Persistence exact/1px | Coverage | Area ratio |
|---|---|---|---|---|---|---|---|---|
| RCF-001 | cp-b-balanced_rc-a | MUST_MERGE | True | 12.813428 | {'mean': 1.048095464706421, 'median': 1.048095464706421, 'p90': 1.048095464706421} | {'exact': 0.0, 'tolerance1px': 0.0} | 0.25641 | 0.95 |
| RCF-002 | cp-b-balanced_rc-a | PROTECTED_BOUNDARY | True | 22.809068 | {'mean': 22.809066772460938, 'median': 22.809066772460938, 'p90': 22.809066772460938} | {'exact': 1.0, 'tolerance1px': 1.0} | 0.25641 | 0.95 |
| RCF-001 | cp-b-aggressive_rc-a | MUST_MERGE | True | 12.813428 | {'mean': 1.0975028276443481, 'median': 1.0975028276443481, 'p90': 1.0975028276443481} | {'exact': 0.0, 'tolerance1px': 0.0} | 0.27027 | 0.772727 |
| RCF-002 | cp-b-aggressive_rc-a | PROTECTED_BOUNDARY | True | 22.809068 | {'mean': 22.809066772460938, 'median': 22.809066772460938, 'p90': 22.809066772460938} | {'exact': 1.0, 'tolerance1px': 1.0} | 0.25641 | 0.95 |

RCF-001 triggers `COHERENT_SPLIT_REPAIR` in all three policies for both profiles. RCF-002 is `PRESERVE` in all three policies because of the explicit `PROTECTED_BOUNDARY` veto.

## Semantic policies

| Policy | COHERENT_SPLIT_REPAIR | TINY_FRAGMENT_REPAIR |
|---|---|---|
| CONSERVATIVE | {"persistenceMax": 0.25, "representativeDeltaEMax": 16.0, "sharedBoundaryCoverageMin": 0.2, "sourceBoundaryP90Max": 3.0} | {"areaRatioMax": 0.04, "persistenceMax": 0.5, "representativeDeltaEMax": 12.0, "sharedBoundaryCoverageMin": 0.03, "smallerAreaMax": 64, "sourceBoundaryP90Max": 6.0} |
| MODERATE | {"persistenceMax": 0.5, "representativeDeltaEMax": 18.0, "sharedBoundaryCoverageMin": 0.15, "sourceBoundaryP90Max": 5.0} | {"areaRatioMax": 0.08, "persistenceMax": 0.75, "representativeDeltaEMax": 16.0, "sharedBoundaryCoverageMin": 0.01, "smallerAreaMax": 256, "sourceBoundaryP90Max": 10.0} |
| STRICT | {"persistenceMax": 0.1, "representativeDeltaEMax": 14.0, "sharedBoundaryCoverageMin": 0.25, "sourceBoundaryP90Max": 2.0} | {"areaRatioMax": 0.02, "persistenceMax": 0.25, "representativeDeltaEMax": 8.0, "sharedBoundaryCoverageMin": 0.05, "smallerAreaMax": 16, "sourceBoundaryP90Max": 4.0} |

SAFE_MERGE is the OR of the two routes after vetoes. Area ratio is absent from the coherent route and only participates in the tiny-fragment route.

## Profile / policy aggregate

| Profile | Policy | Edges | SAFE | PRESERVE | UNCERTAIN | Route triggers |
|---|---|---|---|---|---|---|
| cp-b-balanced_rc-a | STRICT | 1946 | 1 | 23 | 1922 | {'COHERENT_SPLIT_REPAIR': 1, 'TINY_FRAGMENT_REPAIR': 0} |
| cp-b-balanced_rc-a | CONSERVATIVE | 1946 | 1 | 23 | 1922 | {'COHERENT_SPLIT_REPAIR': 1, 'TINY_FRAGMENT_REPAIR': 0} |
| cp-b-balanced_rc-a | MODERATE | 1946 | 2 | 23 | 1921 | {'COHERENT_SPLIT_REPAIR': 2, 'TINY_FRAGMENT_REPAIR': 0} |
| cp-b-aggressive_rc-a | STRICT | 390 | 1 | 12 | 377 | {'COHERENT_SPLIT_REPAIR': 1, 'TINY_FRAGMENT_REPAIR': 0} |
| cp-b-aggressive_rc-a | CONSERVATIVE | 390 | 1 | 12 | 377 | {'COHERENT_SPLIT_REPAIR': 1, 'TINY_FRAGMENT_REPAIR': 0} |
| cp-b-aggressive_rc-a | MODERATE | 390 | 2 | 12 | 376 | {'COHERENT_SPLIT_REPAIR': 2, 'TINY_FRAGMENT_REPAIR': 0} |

## Relation GT predictions

| Fixture | Kind | Profile | Policy | Relation | Type | Pairs | Edges | Prediction | False safe |
|---|---|---|---|---|---|---|---|---|---|
| FLD-003 | project_real | cp-b-balanced_rc-a | STRICT | fld003-top-side-separate | MUST_SEPARATE | [[2, 18]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-003 | project_real | cp-b-balanced_rc-a | CONSERVATIVE | fld003-top-side-separate | MUST_SEPARATE | [[2, 18]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-003 | project_real | cp-b-balanced_rc-a | MODERATE | fld003-top-side-separate | MUST_SEPARATE | [[2, 18]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-004 | project_real | cp-b-balanced_rc-a | STRICT | fld004-disconnected-preserve | MUST_SEPARATE | [[16, 509]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-004 | project_real | cp-b-balanced_rc-a | CONSERVATIVE | fld004-disconnected-preserve | MUST_SEPARATE | [[16, 509]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-004 | project_real | cp-b-balanced_rc-a | MODERATE | fld004-disconnected-preserve | MUST_SEPARATE | [[16, 509]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-007 | project_real | cp-b-balanced_rc-a | STRICT | fld007-hole-preserve | HOLE | [] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-007 | project_real | cp-b-balanced_rc-a | CONSERVATIVE | fld007-hole-preserve | HOLE | [] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-007 | project_real | cp-b-balanced_rc-a | MODERATE | fld007-hole-preserve | HOLE | [] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| RCF-001 | synthetic | cp-b-balanced_rc-a | STRICT | rcf001-drift-merge | MUST_MERGE | [[1, 2]] | 1 | ['SAFE_MERGE'] | False |
| RCF-001 | synthetic | cp-b-balanced_rc-a | CONSERVATIVE | rcf001-drift-merge | MUST_MERGE | [[1, 2]] | 1 | ['SAFE_MERGE'] | False |
| RCF-001 | synthetic | cp-b-balanced_rc-a | MODERATE | rcf001-drift-merge | MUST_MERGE | [[1, 2]] | 1 | ['SAFE_MERGE'] | False |
| RCF-002 | synthetic | cp-b-balanced_rc-a | STRICT | rcf002-shadow-protected | PROTECTED_BOUNDARY | [[1, 2]] | 1 | ['PRESERVE'] | False |
| RCF-002 | synthetic | cp-b-balanced_rc-a | CONSERVATIVE | rcf002-shadow-protected | PROTECTED_BOUNDARY | [[1, 2]] | 1 | ['PRESERVE'] | False |
| RCF-002 | synthetic | cp-b-balanced_rc-a | MODERATE | rcf002-shadow-protected | PROTECTED_BOUNDARY | [[1, 2]] | 1 | ['PRESERVE'] | False |
| FLD-003 | project_real | cp-b-aggressive_rc-a | STRICT | fld003-top-side-separate | MUST_SEPARATE | [[3, 18]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-003 | project_real | cp-b-aggressive_rc-a | CONSERVATIVE | fld003-top-side-separate | MUST_SEPARATE | [[3, 18]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-003 | project_real | cp-b-aggressive_rc-a | MODERATE | fld003-top-side-separate | MUST_SEPARATE | [[3, 18]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-004 | project_real | cp-b-aggressive_rc-a | STRICT | fld004-disconnected-preserve | MUST_SEPARATE | [[14, 326]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-004 | project_real | cp-b-aggressive_rc-a | CONSERVATIVE | fld004-disconnected-preserve | MUST_SEPARATE | [[14, 326]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-004 | project_real | cp-b-aggressive_rc-a | MODERATE | fld004-disconnected-preserve | MUST_SEPARATE | [[14, 326]] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-007 | project_real | cp-b-aggressive_rc-a | STRICT | fld007-hole-preserve | HOLE | [] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-007 | project_real | cp-b-aggressive_rc-a | CONSERVATIVE | fld007-hole-preserve | HOLE | [] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| FLD-007 | project_real | cp-b-aggressive_rc-a | MODERATE | fld007-hole-preserve | HOLE | [] | 0 | ['NOT_EVALUABLE_NON_ADJACENT'] | False |
| RCF-001 | synthetic | cp-b-aggressive_rc-a | STRICT | rcf001-drift-merge | MUST_MERGE | [[1, 2]] | 1 | ['SAFE_MERGE'] | False |
| RCF-001 | synthetic | cp-b-aggressive_rc-a | CONSERVATIVE | rcf001-drift-merge | MUST_MERGE | [[1, 2]] | 1 | ['SAFE_MERGE'] | False |
| RCF-001 | synthetic | cp-b-aggressive_rc-a | MODERATE | rcf001-drift-merge | MUST_MERGE | [[1, 2]] | 1 | ['SAFE_MERGE'] | False |
| RCF-002 | synthetic | cp-b-aggressive_rc-a | STRICT | rcf002-shadow-protected | PROTECTED_BOUNDARY | [[1, 2]] | 1 | ['PRESERVE'] | False |
| RCF-002 | synthetic | cp-b-aggressive_rc-a | CONSERVATIVE | rcf002-shadow-protected | PROTECTED_BOUNDARY | [[1, 2]] | 1 | ['PRESERVE'] | False |
| RCF-002 | synthetic | cp-b-aggressive_rc-a | MODERATE | rcf002-shadow-protected | PROTECTED_BOUNDARY | [[1, 2]] | 1 | ['PRESERVE'] | False |

## GT metrics

| Profile | Policy | Evaluable | MUST_MERGE | Recall | Negative | False safe | Precision |
|---|---|---|---|---|---|---|---|
| cp-b-balanced_rc-a | STRICT | 2 | 1 | 1.0 | 1 | 0 | 1.0 |
| cp-b-balanced_rc-a | CONSERVATIVE | 2 | 1 | 1.0 | 1 | 0 | 1.0 |
| cp-b-balanced_rc-a | MODERATE | 2 | 1 | 1.0 | 1 | 0 | 1.0 |
| cp-b-aggressive_rc-a | STRICT | 2 | 1 | 1.0 | 1 | 0 | 1.0 |
| cp-b-aggressive_rc-a | CONSERVATIVE | 2 | 1 | 1.0 | 1 | 0 | 1.0 |
| cp-b-aggressive_rc-a | MODERATE | 2 | 1 | 1.0 | 1 | 0 | 1.0 |

Metrics currently cover synthetic direct-edge GT only. They are not project-real precision/recall claims.

## All SAFE_MERGE candidates

| Fixture | Kind | Profile | Policy | Regions | Route(s) | Rep ΔE | Boundary P90 | Persistence | Coverage | Area ratio |
|---|---|---|---|---|---|---|---|---|---|---|
| FLD-006 | project_real | cp-b-balanced_rc-a | MODERATE | 24/233 | ['COHERENT_SPLIT_REPAIR'] | 11.743696 | 3.265674 | {'exact': 0.07258064516129033, 'tolerance1px': 0.49193548387096775} | 1.0 | 0.006776 |
| RCF-001 | synthetic | cp-b-balanced_rc-a | STRICT | 1/2 | ['COHERENT_SPLIT_REPAIR'] | 12.813428 | 1.048095 | {'exact': 0.0, 'tolerance1px': 0.0} | 0.25641 | 0.95 |
| RCF-001 | synthetic | cp-b-balanced_rc-a | CONSERVATIVE | 1/2 | ['COHERENT_SPLIT_REPAIR'] | 12.813428 | 1.048095 | {'exact': 0.0, 'tolerance1px': 0.0} | 0.25641 | 0.95 |
| RCF-001 | synthetic | cp-b-balanced_rc-a | MODERATE | 1/2 | ['COHERENT_SPLIT_REPAIR'] | 12.813428 | 1.048095 | {'exact': 0.0, 'tolerance1px': 0.0} | 0.25641 | 0.95 |
| FLD-006 | project_real | cp-b-aggressive_rc-a | MODERATE | 6/22 | ['COHERENT_SPLIT_REPAIR'] | 11.743696 | 3.381308 | {'exact': 0.07692307692307693, 'tolerance1px': 0.49145299145299143} | 1.0 | 0.005257 |
| RCF-001 | synthetic | cp-b-aggressive_rc-a | STRICT | 1/2 | ['COHERENT_SPLIT_REPAIR'] | 12.813428 | 1.097503 | {'exact': 0.0, 'tolerance1px': 0.0} | 0.27027 | 0.772727 |
| RCF-001 | synthetic | cp-b-aggressive_rc-a | CONSERVATIVE | 1/2 | ['COHERENT_SPLIT_REPAIR'] | 12.813428 | 1.097503 | {'exact': 0.0, 'tolerance1px': 0.0} | 0.27027 | 0.772727 |
| RCF-001 | synthetic | cp-b-aggressive_rc-a | MODERATE | 1/2 | ['COHERENT_SPLIT_REPAIR'] | 12.813428 | 1.097503 | {'exact': 0.0, 'tolerance1px': 0.0} | 0.27027 | 0.772727 |

## All PRESERVE candidates

| Fixture | Kind | Profile | Regions | Policies | Vetoes | Rep ΔE | Coverage |
|---|---|---|---|---|---|---|---|
| FLD-007 | project_real | cp-b-balanced_rc-a | 1/2 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 37.827862 | 0.480583 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 1/18 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 9.725622 | 0.007782 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/14 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 20.636816 | 0.508197 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/15 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 41.857482 | 0.484629 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/18 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 43.886612 | 0.476654 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/28 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 30.293553 | 0.502591 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/41 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 38.997414 | 0.470356 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/43 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 44.028643 | 0.5 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/52 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 40.508671 | 0.478632 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/55 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 40.892016 | 0.493961 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/56 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 24.833619 | 0.5 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/59 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 39.238459 | 0.446429 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/65 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 42.261677 | 0.5 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/67 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 40.063953 | 0.489796 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/69 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 38.182524 | 0.047414 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/82 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 45.338265 | 0.479167 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/89 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 18.059675 | 0.5 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/106 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 38.096891 | 0.5 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/110 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 41.496835 | 0.483871 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 2/119 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 39.285658 | 0.210145 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 18/82 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 3.618945 | 0.001946 |
| FLD-007 | project_real | cp-b-balanced_rc-a | 89/119 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 27.193273 | 0.254529 |
| RCF-002 | synthetic | cp-b-balanced_rc-a | 1/2 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['PROTECTED_BOUNDARY'] | 22.809068 | 0.25641 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/3 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 39.542396 | 0.477964 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/11 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 40.692882 | 0.48017 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/15 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 36.666974 | 0.512535 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/28 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 38.052518 | 0.496667 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/29 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 38.308206 | 0.5 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/49 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 32.486404 | 0.472222 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/52 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 39.861296 | 0.493056 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/53 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 39.529057 | 0.488858 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/61 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 42.671448 | 0.482143 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/87 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 42.421707 | 0.471429 |
| FLD-007 | project_real | cp-b-aggressive_rc-a | 1/94 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['TOPOLOGY_GLOBAL_VOID'] | 42.103784 | 0.46 |
| RCF-002 | synthetic | cp-b-aggressive_rc-a | 1/2 | ['STRICT', 'CONSERVATIVE', 'MODERATE'] | ['PROTECTED_BOUNDARY'] | 22.809068 | 0.25641 |

## False Safe Merge

Count: `0`.

## Adjacent project-real human review

- Markdown: `adjacent-relation-review/ADJACENT_RELATION_REVIEW.md`
- JSON: `adjacent-relation-review/ADJACENT_RELATION_REVIEW.json`
- Status: `PENDING_HUMAN_RELATION_LABELS`; no semantic GT was generated automatically.

## State

- Gate 2: `PENDING_EXTERNAL_GATE_2_REVIEW_V2`
- Repair Apply: `NOT_EXECUTED`
- Region Core: `IMPLEMENTATION_COMPLETE` / `FREEZE_CANDIDATE` / `BLOCKED_DATA_G02_SHADOW`
