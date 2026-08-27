# External Gate Review Packet

Read-only consolidation of existing reports. No proposal rerun, parameter change, GT/fixture/contract modification, RC selection, policy approval, or Repair Apply occurred.

## Freeze / review state

- Gate 1: `PENDING_EXTERNAL_GATE_1_REVIEW`
- Gate 2: `PENDING_EXTERNAL_GATE_2_REVIEW`; `PROVISIONAL_UNTIL_GATE_1_RC_FREEZE`
- CURRENT_GATE_2_REPRESENTATIVE = `RC-A`
- Repair Apply: `NOT_EXECUTED`
- Region Core: `IMPLEMENTATION_COMPLETE` / `FREEZE_CANDIDATE` / `BLOCKED_DATA_G02_SHADOW`
- B1.3 formal manual review: `PENDING_B1_3_MANUAL_REVIEW`

## Gate 1 — Representative Color

Aggregate definitions: mean/P95 are means of existing per-region metrics; median is the median of existing per-region medians. Existing outputs do not define a relation-inversion threshold, so inversion counts are `NOT_AVAILABLE`.

| Profile | RC | Mean ΔE00 | Median ΔE00 | Mean P95 ΔE00 | Contam. | Determinism | MUST_MERGE inv. | MUST_SEPARATE inv. | PROTECTED inv. | Total inv. | Runtime ms | Regions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cp-b-aggressive_rc-a | RC-A | 2.388946 | 0.254645 | 6.149519 | 21.45363 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 9376.1702 | 707 |
| cp-b-aggressive_rc-a | RC-B | 2.506522 | 0.347882 | 6.284868 | 23.523312 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 16706.115 | 707 |
| cp-b-aggressive_rc-a | RC-C | 2.409012 | 0.254645 | 6.264702 | 23.318821 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 10540.0369 | 707 |
| cp-b-aggressive_rc-a | RC-D | 2.39712 | 0.254644 | 6.470078 | 23.126166 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 18252.2432 | 707 |
| cp-b-balanced_rc-a | RC-A | 5.104376 | 1.545824 | 9.250283 | 21.520136 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 27337.1684 | 2222 |
| cp-b-balanced_rc-a | RC-B | 5.911893 | 1.519147 | 12.313415 | 19.461587 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 34323.398 | 2222 |
| cp-b-balanced_rc-a | RC-C | 5.564036 | 1.44461 | 12.368578 | 25.933991 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 28595.2204 | 2222 |
| cp-b-balanced_rc-a | RC-D | 5.072564 | 1.612931 | 10.812572 | 23.485303 | PASS: 8 largest-region sentinels, not per-region triple execution | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | 36419.7674 | 2222 |

### Case-level results

| Fixture | Profile | RC | Regions | Mean/Median/P95 ΔE00 | Contam. | Runtime ms | Relation evidence |
|---|---|---|---|---|---|---|---|
| FLD-001 | cp-b-aggressive_rc-a | RC-A | 108 | 1.799333/0.0/3.595153 | 29.854128 | 1739.8719 | NOT_AVAILABLE |
| FLD-001 | cp-b-aggressive_rc-a | RC-B | 108 | 1.820203/0.0/3.688189 | 32.285891 | 2015.1265 | NOT_AVAILABLE |
| FLD-001 | cp-b-aggressive_rc-a | RC-C | 108 | 1.799978/0.0/3.668866 | 31.870521 | 1779.4326 | NOT_AVAILABLE |
| FLD-001 | cp-b-aggressive_rc-a | RC-D | 108 | 1.803288/0.0/4.105806 | 31.853776 | 2064.3382 | NOT_AVAILABLE |
| FLD-002 | cp-b-aggressive_rc-a | RC-A | 13 | 3.406003/1.451027/8.835545 | 3.628474 | 317.4624 | NOT_AVAILABLE |
| FLD-002 | cp-b-aggressive_rc-a | RC-B | 13 | 3.395934/1.451027/8.598868 | 3.318878 | 1676.0139 | NOT_AVAILABLE |
| FLD-002 | cp-b-aggressive_rc-a | RC-C | 13 | 3.411259/1.451027/8.830332 | 3.323408 | 418.5085 | NOT_AVAILABLE |
| FLD-002 | cp-b-aggressive_rc-a | RC-D | 13 | 3.387383/1.321559/8.842913 | 3.617494 | 1138.1029 | NOT_AVAILABLE |
| FLD-003 | cp-b-aggressive_rc-a | RC-A | 18 | 2.298208/1.668861/6.504089 | 0.143808 | 481.8591 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-A', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-003 | cp-b-aggressive_rc-a | RC-B | 18 | 2.307354/1.668861/6.53988 | 0.006392 | 1429.8621 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-B', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-003 | cp-b-aggressive_rc-a | RC-C | 18 | 2.28931/1.668861/6.43206 | 0.042135 | 753.7323 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-C', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-003 | cp-b-aggressive_rc-a | RC-D | 18 | 2.289638/1.661551/6.462762 | 0.204683 | 2633.3172 | [{'distance': 1.0034912824630737, 'mappingStatus': 'MAPPED', 'method': 'RC-D', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-aggressive_rc-a | RC-A | 330 | 3.265988/0.937524/8.879997 | 18.325614 | 3915.189 | [{'distance': 14.78734302520752, 'mappingStatus': 'MAPPED', 'method': 'RC-A', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-aggressive_rc-a | RC-B | 330 | 3.490483/0.965081/9.114911 | 20.374372 | 4679.0501 | [{'distance': 14.719067573547363, 'mappingStatus': 'MAPPED', 'method': 'RC-B', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-aggressive_rc-a | RC-C | 330 | 3.311325/0.937524/9.092819 | 20.250572 | 4235.1488 | [{'distance': 14.78734302520752, 'mappingStatus': 'MAPPED', 'method': 'RC-C', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-aggressive_rc-a | RC-D | 330 | 3.288723/0.94128/9.193518 | 19.861186 | 5839.5961 | [{'distance': 14.719067573547363, 'mappingStatus': 'MAPPED', 'method': 'RC-D', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-005 | cp-b-aggressive_rc-a | RC-A | 68 | 0.852146/0.124686/1.928432 | 22.124846 | 534.9401 | NOT_AVAILABLE |
| FLD-005 | cp-b-aggressive_rc-a | RC-B | 68 | 0.854008/0.124686/1.93583 | 24.917209 | 954.2716 | NOT_AVAILABLE |
| FLD-005 | cp-b-aggressive_rc-a | RC-C | 68 | 0.852584/0.124686/1.931581 | 24.938148 | 641.5283 | NOT_AVAILABLE |
| FLD-005 | cp-b-aggressive_rc-a | RC-D | 68 | 0.851031/0.124686/2.220263 | 24.99289 | 1428.3702 | NOT_AVAILABLE |
| FLD-006 | cp-b-aggressive_rc-a | RC-A | 28 | 2.163724/0.722607/5.675186 | 13.468292 | 564.4129 | NOT_AVAILABLE |
| FLD-006 | cp-b-aggressive_rc-a | RC-B | 28 | 2.393643/0.722607/6.053176 | 17.354563 | 1485.8766 | NOT_AVAILABLE |
| FLD-006 | cp-b-aggressive_rc-a | RC-C | 28 | 2.163724/0.722607/5.675186 | 16.388726 | 736.619 | NOT_AVAILABLE |
| FLD-006 | cp-b-aggressive_rc-a | RC-D | 28 | 2.161687/0.719654/6.423926 | 15.727044 | 1747.9919 | NOT_AVAILABLE |
| FLD-007 | cp-b-aggressive_rc-a | RC-A | 104 | 1.241359/0.0/3.07546 | 31.12668 | 1316.4692 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-A', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-007 | cp-b-aggressive_rc-a | RC-B | 104 | 1.223642/0.0/3.057692 | 32.763047 | 3046.9595 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-B', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-007 | cp-b-aggressive_rc-a | RC-C | 104 | 1.231235/0.0/3.125962 | 32.39223 | 1358.7004 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-C', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-007 | cp-b-aggressive_rc-a | RC-D | 104 | 1.225755/0.0/3.108161 | 32.435111 | 1780.0956 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-D', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-008 | cp-b-aggressive_rc-a | RC-A | 38 | 2.200084/0.765607/4.926648 | 19.14429 | 505.9656 | NOT_AVAILABLE |
| FLD-008 | cp-b-aggressive_rc-a | RC-B | 38 | 2.25361/0.760039/4.961259 | 20.78019 | 1418.9547 | NOT_AVAILABLE |
| FLD-008 | cp-b-aggressive_rc-a | RC-C | 38 | 2.207214/0.765607/4.904007 | 20.901811 | 616.367 | NOT_AVAILABLE |
| FLD-008 | cp-b-aggressive_rc-a | RC-D | 38 | 2.200128/0.765607/5.570354 | 20.841136 | 1620.4311 | NOT_AVAILABLE |
| FLD-001 | cp-b-balanced_rc-a | RC-A | 497 | 3.331256/0.0/5.211129 | 30.182984 | 8284.6788 | NOT_AVAILABLE |
| FLD-001 | cp-b-balanced_rc-a | RC-B | 497 | 3.889891/0.0/7.513723 | 28.447312 | 8658.6506 | NOT_AVAILABLE |
| FLD-001 | cp-b-balanced_rc-a | RC-C | 497 | 3.677354/0.0/7.533752 | 34.287103 | 8330.0374 | NOT_AVAILABLE |
| FLD-001 | cp-b-balanced_rc-a | RC-D | 497 | 3.297021/0.0/6.481257 | 31.835477 | 8748.5218 | NOT_AVAILABLE |
| FLD-002 | cp-b-balanced_rc-a | RC-A | 74 | 6.916274/6.343152/12.452532 | 10.451754 | 722.1449 | NOT_AVAILABLE |
| FLD-002 | cp-b-balanced_rc-a | RC-B | 74 | 7.654318/6.259969/16.062778 | 7.181345 | 2019.373 | NOT_AVAILABLE |
| FLD-002 | cp-b-balanced_rc-a | RC-C | 74 | 7.402334/6.022186/16.062975 | 12.724893 | 774.3097 | NOT_AVAILABLE |
| FLD-002 | cp-b-balanced_rc-a | RC-D | 74 | 6.90812/6.335386/14.306251 | 12.231632 | 1404.2293 | NOT_AVAILABLE |
| FLD-003 | cp-b-balanced_rc-a | RC-A | 18 | 2.401188/1.711682/7.17025 | 0.133307 | 429.9862 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-A', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-003 | cp-b-balanced_rc-a | RC-B | 18 | 2.466346/1.711682/7.386523 | 0.0 | 1321.4066 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-B', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-003 | cp-b-balanced_rc-a | RC-C | 18 | 2.397772/1.711682/7.170872 | 0.062993 | 709.7568 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-C', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-003 | cp-b-balanced_rc-a | RC-D | 18 | 2.401678/1.711682/7.18592 | 0.127286 | 2409.489 | [{'distance': 1.4997045993804932, 'mappingStatus': 'MAPPED', 'method': 'RC-D', 'relationId': 'fld003-top-side-separate', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-balanced_rc-a | RC-A | 513 | 5.086373/1.997112/12.156498 | 16.443595 | 5369.6043 | [{'distance': 20.454294204711914, 'mappingStatus': 'MAPPED', 'method': 'RC-A', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-balanced_rc-a | RC-B | 513 | 5.844646/1.99119/14.21179 | 17.698469 | 6024.4289 | [{'distance': 20.454294204711914, 'mappingStatus': 'MAPPED', 'method': 'RC-B', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-balanced_rc-a | RC-C | 513 | 5.38863/1.669375/14.103683 | 19.31811 | 5627.4182 | [{'distance': 20.454294204711914, 'mappingStatus': 'MAPPED', 'method': 'RC-C', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-004 | cp-b-balanced_rc-a | RC-D | 513 | 5.065597/1.943511/12.944147 | 17.75333 | 7371.0278 | [{'distance': 20.454294204711914, 'mappingStatus': 'MAPPED', 'method': 'RC-D', 'relationId': 'fld004-disconnected-preserve', 'type': 'MUST_SEPARATE'}] |
| FLD-005 | cp-b-balanced_rc-a | RC-A | 200 | 3.812037/0.246814/5.826929 | 23.289835 | 1502.9696 | NOT_AVAILABLE |
| FLD-005 | cp-b-balanced_rc-a | RC-B | 200 | 4.704076/0.246814/8.996408 | 20.909097 | 1890.3196 | NOT_AVAILABLE |
| FLD-005 | cp-b-balanced_rc-a | RC-C | 200 | 4.238026/0.246814/8.599042 | 28.158479 | 1632.9786 | NOT_AVAILABLE |
| FLD-005 | cp-b-balanced_rc-a | RC-D | 200 | 3.780099/0.246814/7.325265 | 25.792224 | 2441.8397 | NOT_AVAILABLE |
| FLD-006 | cp-b-balanced_rc-a | RC-A | 421 | 7.170174/5.89078/11.63543 | 19.5055 | 6586.4027 | NOT_AVAILABLE |
| FLD-006 | cp-b-balanced_rc-a | RC-B | 421 | 8.216928/5.660511/16.298152 | 13.999702 | 7490.1538 | NOT_AVAILABLE |
| FLD-006 | cp-b-balanced_rc-a | RC-C | 421 | 7.829277/4.125947/16.55703 | 26.071359 | 6772.8404 | NOT_AVAILABLE |
| FLD-006 | cp-b-balanced_rc-a | RC-D | 421 | 7.125437/5.822735/14.34141 | 22.463775 | 7814.5309 | NOT_AVAILABLE |
| FLD-007 | cp-b-balanced_rc-a | RC-A | 121 | 2.1961/0.0/4.799145 | 26.125498 | 1227.1745 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-A', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-007 | cp-b-balanced_rc-a | RC-B | 121 | 2.237181/0.0/4.854174 | 28.26003 | 2909.1617 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-B', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-007 | cp-b-balanced_rc-a | RC-C | 121 | 2.212454/0.0/4.960792 | 27.569435 | 1310.0357 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-C', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-007 | cp-b-balanced_rc-a | RC-D | 121 | 2.170504/0.0/4.88158 | 27.623262 | 1777.1024 | [{'distance': None, 'mappingStatus': 'UNMAPPED', 'method': 'RC-D', 'relationId': 'fld007-hole-preserve', 'type': 'HOLE'}] |
| FLD-008 | cp-b-balanced_rc-a | RC-A | 378 | 6.548084/4.024698/10.66869 | 20.038199 | 3214.2074 | NOT_AVAILABLE |
| FLD-008 | cp-b-balanced_rc-a | RC-B | 378 | 7.732787/3.433218/15.253119 | 15.871536 | 4009.9038 | NOT_AVAILABLE |
| FLD-008 | cp-b-balanced_rc-a | RC-C | 378 | 7.325145/3.388871/15.595783 | 25.894262 | 3437.8436 | NOT_AVAILABLE |
| FLD-008 | cp-b-balanced_rc-a | RC-D | 378 | 6.510785/3.969069/12.916763 | 22.193419 | 4453.0265 | NOT_AVAILABLE |

### Failure / difference evidence

No anomaly or inversion thresholds exist in prior reports. These entries retain the four-method values without assigning a verdict.

| Kind | Fixture | Profile | Four-RC values | Visual artifact |
|---|---|---|---|---|
| MUST_SEPARATE_PAIR_DISTANCE | FLD-003 | cp-b-aggressive_rc-a | {"RC-A": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-A", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}], "RC-B": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-B", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}], "RC-C": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-C", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}], "RC-D": [{"distance": 1.0034912824630737, "mappingStatus": "MAPPED", "method": "RC-D", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}]} | RC-A uses existing purified output; RC-B/RC-C/RC-D raster artifact NOT_AVAILABLE |
| MUST_SEPARATE_PAIR_DISTANCE | FLD-004 | cp-b-aggressive_rc-a | {"RC-A": [{"distance": 14.78734302520752, "mappingStatus": "MAPPED", "method": "RC-A", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}], "RC-B": [{"distance": 14.719067573547363, "mappingStatus": "MAPPED", "method": "RC-B", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}], "RC-C": [{"distance": 14.78734302520752, "mappingStatus": "MAPPED", "method": "RC-C", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}], "RC-D": [{"distance": 14.719067573547363, "mappingStatus": "MAPPED", "method": "RC-D", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}]} | RC-A uses existing purified output; RC-B/RC-C/RC-D raster artifact NOT_AVAILABLE |
| RUNTIME_COMPARISON | ALL | cp-b-aggressive_rc-a | {"RC-A": 9376.1702, "RC-B": 16706.115, "RC-C": 10540.0369, "RC-D": 18252.2432} | NOT_AVAILABLE |
| MUST_SEPARATE_PAIR_DISTANCE | FLD-003 | cp-b-balanced_rc-a | {"RC-A": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-A", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}], "RC-B": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-B", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}], "RC-C": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-C", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}], "RC-D": [{"distance": 1.4997045993804932, "mappingStatus": "MAPPED", "method": "RC-D", "relationId": "fld003-top-side-separate", "type": "MUST_SEPARATE"}]} | RC-A uses existing purified output; RC-B/RC-C/RC-D raster artifact NOT_AVAILABLE |
| MUST_SEPARATE_PAIR_DISTANCE | FLD-004 | cp-b-balanced_rc-a | {"RC-A": [{"distance": 20.454294204711914, "mappingStatus": "MAPPED", "method": "RC-A", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}], "RC-B": [{"distance": 20.454294204711914, "mappingStatus": "MAPPED", "method": "RC-B", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}], "RC-C": [{"distance": 20.454294204711914, "mappingStatus": "MAPPED", "method": "RC-C", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}], "RC-D": [{"distance": 20.454294204711914, "mappingStatus": "MAPPED", "method": "RC-D", "relationId": "fld004-disconnected-preserve", "type": "MUST_SEPARATE"}]} | RC-A uses existing purified output; RC-B/RC-C/RC-D raster artifact NOT_AVAILABLE |
| RUNTIME_COMPARISON | ALL | cp-b-balanced_rc-a | {"RC-A": 27337.1684, "RC-B": 34323.398, "RC-C": 28595.2204, "RC-D": 36419.7674} | NOT_AVAILABLE |

### Visual review index

| Fixture | Original | RC-A | RC-B | RC-C | RC-D | Existing structural sheet |
|---|---|---|---|---|---|---|
| FLD-001 | fixtures/source/FLD-001.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-001/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-001.png |
| FLD-002 | fixtures/source/FLD-002.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-002/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-002.png |
| FLD-003 | fixtures/source/FLD-003.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-003/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-003.png |
| FLD-004 | fixtures/source/FLD-004.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-004/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-004.png |
| FLD-005 | fixtures/source/FLD-005.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-005/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-005.png |
| FLD-006 | fixtures/source/FLD-006.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-006/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-006.png |
| FLD-007 | fixtures/source/FLD-007.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-007/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-007.png |
| FLD-008 | fixtures/source/FLD-008.png | outputs/color-purification/cp-b-aggressive_rc-a/FLD-008/purified.png | NOT_AVAILABLE | NOT_AVAILABLE | NOT_AVAILABLE | reports/color-purification/contact-sheets/FLD-008.png |

## Gate 2 — Region Repair Evidence

CURRENT_GATE_2_REPRESENTATIVE = `RC-A`; `PROVISIONAL_UNTIL_GATE_1_RC_FREEZE`. Each threshold object below records `unlabelled_full_scope_quantiles`.

| Profile | Policy | SAFE_MERGE | PRESERVE | UNCERTAIN | Thresholds |
|---|---|---|---|---|---|
| cp-b-aggressive_rc-a | STRICT | 0 | 0 | 388 | {"areaRatioMax": 4.1924619534077726e-05, "derivation": "unlabelled_full_scope_quantiles", "persistenceMax": 0.9064730186553149, "representativeDeltaEMax": 68.6346172219494, "sharedBoundaryMin": 2.0, "sourceBoundaryP90Max": 51.69643802642822} |
| cp-b-aggressive_rc-a | CONSERVATIVE | 3 | 0 | 385 | {"areaRatioMax": 5.165022467847735e-05, "derivation": "unlabelled_full_scope_quantiles", "persistenceMax": 0.934652888953573, "representativeDeltaEMax": 75.64696065991858, "sharedBoundaryMin": 1.5, "sourceBoundaryP90Max": 60.121263122558595} |
| cp-b-aggressive_rc-a | MODERATE | 16 | 0 | 372 | {"areaRatioMax": 8.795626519561228e-05, "derivation": "unlabelled_full_scope_quantiles", "persistenceMax": 0.9965834428383705, "representativeDeltaEMax": 79.81986281710961, "sharedBoundaryMin": 1.1950000000000007, "sourceBoundaryP90Max": 63.882650756835936} |
| cp-b-balanced_rc-a | STRICT | 12 | 0 | 1932 | {"areaRatioMax": 3.328673190866121e-05, "derivation": "unlabelled_full_scope_quantiles", "persistenceMax": 0.6835242618981093, "representativeDeltaEMax": 45.198583164384985, "sharedBoundaryMin": 2.0, "sourceBoundaryP90Max": 45.18686790466309} |
| cp-b-balanced_rc-a | CONSERVATIVE | 65 | 0 | 1879 | {"areaRatioMax": 4.8088482808367394e-05, "derivation": "unlabelled_full_scope_quantiles", "persistenceMax": 0.7365738212270162, "representativeDeltaEMax": 51.5124521148354, "sharedBoundaryMin": 2.0, "sourceBoundaryP90Max": 52.975918197631835} |
| cp-b-balanced_rc-a | MODERATE | 223 | 0 | 1721 | {"areaRatioMax": 5.410124141067241e-05, "derivation": "unlabelled_full_scope_quantiles", "persistenceMax": 0.7365738212270162, "representativeDeltaEMax": 57.29401022908049, "sharedBoundaryMin": 1.5, "sourceBoundaryP90Max": 57.929249382019044} |

### Relation-level evidence

| Fixture | Profile | Policy | Relation | Type | Region pair(s) | Edges | Decision | Vetoes | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| FLD-003 | cp-b-aggressive_rc-a | STRICT | fld003-top-side-separate | MUST_SEPARATE | [[3, 18]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-003 | cp-b-aggressive_rc-a | CONSERVATIVE | fld003-top-side-separate | MUST_SEPARATE | [[3, 18]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-003 | cp-b-aggressive_rc-a | MODERATE | fld003-top-side-separate | MUST_SEPARATE | [[3, 18]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-004 | cp-b-aggressive_rc-a | STRICT | fld004-disconnected-preserve | MUST_SEPARATE | [[14, 326]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-004 | cp-b-aggressive_rc-a | CONSERVATIVE | fld004-disconnected-preserve | MUST_SEPARATE | [[14, 326]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-004 | cp-b-aggressive_rc-a | MODERATE | fld004-disconnected-preserve | MUST_SEPARATE | [[14, 326]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-007 | cp-b-aggressive_rc-a | STRICT | fld007-hole-preserve | HOLE | [] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-007 | cp-b-aggressive_rc-a | CONSERVATIVE | fld007-hole-preserve | HOLE | [] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-007 | cp-b-aggressive_rc-a | MODERATE | fld007-hole-preserve | HOLE | [] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-003 | cp-b-balanced_rc-a | STRICT | fld003-top-side-separate | MUST_SEPARATE | [[2, 18]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-003 | cp-b-balanced_rc-a | CONSERVATIVE | fld003-top-side-separate | MUST_SEPARATE | [[2, 18]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-003 | cp-b-balanced_rc-a | MODERATE | fld003-top-side-separate | MUST_SEPARATE | [[2, 18]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-004 | cp-b-balanced_rc-a | STRICT | fld004-disconnected-preserve | MUST_SEPARATE | [[16, 509]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-004 | cp-b-balanced_rc-a | CONSERVATIVE | fld004-disconnected-preserve | MUST_SEPARATE | [[16, 509]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-004 | cp-b-balanced_rc-a | MODERATE | fld004-disconnected-preserve | MUST_SEPARATE | [[16, 509]] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-007 | cp-b-balanced_rc-a | STRICT | fld007-hole-preserve | HOLE | [] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-007 | cp-b-balanced_rc-a | CONSERVATIVE | fld007-hole-preserve | HOLE | [] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |
| FLD-007 | cp-b-balanced_rc-a | MODERATE | fld007-hole-preserve | HOLE | [] | 0 | NOT_EVALUABLE_NON_ADJACENT | [] | NOT_AVAILABLE: no direct GT RAG edge |

All existing Relation GT entries are non-adjacent or HOLE-only in the current raw maps. Therefore they have no direct edge evidence and cannot establish policy precision/recall. No direct MUST_SEPARATE / PROTECTED_BOUNDARY / HOLE SAFE_MERGE appears in the report; that is not a proof of safety.

### Unlabeled edge distributions

| Profile | Metric | Count | Min | P10 | P25 | Median | P75 | P90 | Max |
|---|---|---|---|---|---|---|---|---|---|
| cp-b-aggressive_rc-a | representativeDeltaE00 | 388 | 1.362756 | 40.099879 | 74.076609 | 81.33514 | 87.856138 | 94.86611 | 99.164731 |
| cp-b-aggressive_rc-a | sourceBoundaryP90DeltaE00 | 388 | 2.611969 | 33.287964 | 58.880901 | 65.198044 | 71.915405 | 76.762344 | 87.258301 |
| cp-b-aggressive_rc-a | exactBoundaryPersistence | 388 | 0.504488 | 0.594922 | 0.781019 | 0.931143 | 0.954017 | 0.954017 | 0.954017 |
| cp-b-aggressive_rc-a | tolerance1PxBoundaryPersistence | 388 | 0.82144 | 0.906473 | 0.926023 | 0.996583 | 0.99851 | 0.99851 | 0.99851 |
| cp-b-aggressive_rc-a | sharedBoundaryToSmallerPerimeter | 388 | 0.008865 | 0.154282 | 0.769231 | 1.046154 | 1.5 | 2.0 | 2.0 |
| cp-b-balanced_rc-a | representativeDeltaE00 | 1944 | 2.401627 | 42.429093 | 49.383085 | 59.360393 | 72.400606 | 84.066928 | 99.164731 |
| cp-b-balanced_rc-a | sourceBoundaryP90DeltaE00 | 1944 | 3.265674 | 41.66787 | 51.159233 | 59.366749 | 66.570824 | 73.21801 | 87.258301 |
| cp-b-balanced_rc-a | exactBoundaryPersistence | 1944 | 0.524371 | 0.580982 | 0.582116 | 0.645003 | 0.83277 | 0.876214 | 0.876214 |
| cp-b-balanced_rc-a | tolerance1PxBoundaryPersistence | 1944 | 0.61916 | 0.683524 | 0.736574 | 0.795179 | 0.923077 | 0.923433 | 0.951302 |
| cp-b-balanced_rc-a | sharedBoundaryToSmallerPerimeter | 1944 | 0.000817 | 1.0 | 1.2 | 1.5 | 2.0 | 2.0 | 2.0 |

## Synthetic stress cases

### RCF-001 — AI drift
- Relation GT: `{"fixtureId": "RCF-001", "regions": [{"regionKey": "left_drift", "kind": "SUBJECT_REGION", "anchors": [[24, 32]]}, {"regionKey": "right_drift", "kind": "SUBJECT_REGION", "anchors": [[72, 32]]}], "relations": [{"relationId": "rcf001-drift-merge", "type": "MUST_MERGE", "regionKeys": ["left_drift", "right_drift"], "notes": "Synthetic low-amplitude AI-style color drift in one semantic fill."}]}`
- Gate 1: NOT_AVAILABLE: no CP-B map/run exists; rerun is prohibited.
- Gate 2: NOT_AVAILABLE: no CP-B map/run exists; rerun is prohibited.

### RCF-002 — intentional shadow
- Relation GT: `{"fixtureId": "RCF-002", "regions": [{"regionKey": "lit_surface", "kind": "SUBJECT_REGION", "anchors": [[24, 32]]}, {"regionKey": "intentional_shadow", "kind": "SUBJECT_REGION", "anchors": [[72, 32]]}], "relations": [{"relationId": "rcf002-shadow-protected", "type": "PROTECTED_BOUNDARY", "regionKeys": ["lit_surface", "intentional_shadow"], "notes": "Synthetic intentional shadow boundary must not become a SAFE_MERGE."}]}`
- Gate 1: NOT_AVAILABLE: no CP-B map/run exists; rerun is prohibited.
- Gate 2: NOT_AVAILABLE: no CP-B map/run exists; rerun is prohibited.

## Existing project-real fixtures

| Fixture | Profile | Raw regions | Relation GT | Gate 2 S/P/U |
|---|---|---|---|---|
| FLD-001 | cp-b-aggressive_rc-a | 108 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 71}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 71}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 71}} |
| FLD-001 | cp-b-balanced_rc-a | 497 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 494}, "CONSERVATIVE": {"SAFE_MERGE": 33, "PRESERVE": 0, "UNCERTAIN": 461}, "MODERATE": {"SAFE_MERGE": 170, "PRESERVE": 0, "UNCERTAIN": 324}} |
| FLD-002 | cp-b-aggressive_rc-a | 13 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 14}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 14}, "MODERATE": {"SAFE_MERGE": 2, "PRESERVE": 0, "UNCERTAIN": 12}} |
| FLD-002 | cp-b-balanced_rc-a | 74 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 74}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 74}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 74}} |
| FLD-003 | cp-b-aggressive_rc-a | 18 | ['fld003-top-side-separate'] | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 17}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 17}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 17}} |
| FLD-003 | cp-b-balanced_rc-a | 18 | ['fld003-top-side-separate'] | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 17}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 17}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 17}} |
| FLD-004 | cp-b-aggressive_rc-a | 330 | ['fld004-disconnected-preserve'] | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 181}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 181}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 181}} |
| FLD-004 | cp-b-balanced_rc-a | 513 | ['fld004-disconnected-preserve'] | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 360}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 360}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 360}} |
| FLD-005 | cp-b-aggressive_rc-a | 68 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 29}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 29}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 29}} |
| FLD-005 | cp-b-balanced_rc-a | 200 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 164}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 164}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 164}} |
| FLD-006 | cp-b-aggressive_rc-a | 28 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 26}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 26}, "MODERATE": {"SAFE_MERGE": 5, "PRESERVE": 0, "UNCERTAIN": 21}} |
| FLD-006 | cp-b-balanced_rc-a | 421 | none | {"STRICT": {"SAFE_MERGE": 12, "PRESERVE": 0, "UNCERTAIN": 407}, "CONSERVATIVE": {"SAFE_MERGE": 32, "PRESERVE": 0, "UNCERTAIN": 387}, "MODERATE": {"SAFE_MERGE": 53, "PRESERVE": 0, "UNCERTAIN": 366}} |
| FLD-007 | cp-b-aggressive_rc-a | 104 | ['fld007-hole-preserve'] | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 11}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 11}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 11}} |
| FLD-007 | cp-b-balanced_rc-a | 121 | ['fld007-hole-preserve'] | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 27}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 27}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 27}} |
| FLD-008 | cp-b-aggressive_rc-a | 38 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 39}, "CONSERVATIVE": {"SAFE_MERGE": 3, "PRESERVE": 0, "UNCERTAIN": 36}, "MODERATE": {"SAFE_MERGE": 9, "PRESERVE": 0, "UNCERTAIN": 30}} |
| FLD-008 | cp-b-balanced_rc-a | 378 | none | {"STRICT": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 389}, "CONSERVATIVE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 389}, "MODERATE": {"SAFE_MERGE": 0, "PRESERVE": 0, "UNCERTAIN": 389}} |

These eight fixtures are not project-real G02 AI Color Drift or Intentional Shadow final evidence.

## Source data

See `sourceReports` in the JSON packet for the complete existing-report provenance.
