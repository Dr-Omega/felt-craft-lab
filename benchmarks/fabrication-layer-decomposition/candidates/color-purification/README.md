# P0-04B1.2 Color Region Semantics + Alpha Topology PoC

This is an isolated benchmark-only PoC. It does not change alpha, production image processing, background removal, or Fabrication Piece / layer-decomposition behavior.

## Candidates and representative color methods

- CP-A: OpenCV `pyrMeanShiftFiltering`, followed by 8-connected local Lab edge components. It does not use a generic graph segmenter after Mean Shift.
- CP-B: deterministic row-major seeded 8-connected CIEDE2000 region growing. Admission requires both `localEdgeThreshold` against the queue neighbour and `regionMeanThreshold` against the current running Lab mean. It does not use graph connected-components as its proposal core.
- CP-C: `DEPENDENCY_UNAVAILABLE`. VTracer watershed was not installed and is never replaced by a different algorithm.
- RC-A: Lab median; RC-B: dominant Lab histogram cell median; RC-C: deterministic local-density mode.

All candidates expose `conservative`, `balanced`, and `aggressive` settings in `configs/profiles.json`. Representative-color selection is independent of candidate selection.

## Alpha and labels

Input alpha is frozen and output alpha must be bit-identical. B1.2 distinguishes `structural_label_map.npz` from `pixel_label_map.npz`: the former has positive labels only for `alpha >= structuralAlphaThreshold`; the latter assigns every non-transparent pixel. A low-alpha fringe inherits a nearby structural ID within `fringeMaxPropagationDistancePx`, or is recorded as label `-1` (`ORPHAN_FRINGE`) while its source RGB/alpha remains untouched.

Representative colors use a configurable core sampling area: pixels below `coreAlphaMin` and pixels closer than `coreDistancePx` to the region edge are excluded first. A small region safely falls back to its eligible/full region instead of being deleted. Proposal `smallRegionStrategy=keep` keeps every local component; `merge_adjacent_local` merges a component smaller than `smallRegionArea` only into a directly touching neighbour within `smallRegionMergeDeltaE`, preferring the smallest Lab distance and then longest shared edge. No global same-colour merge or deletion is permitted. Both values are written to every `run_config.json`.

## Metrics

Color variance is the mean per-channel variance in CIE Lab, calculated over the candidate's final local regions before and after purification. Because representative assignment intentionally makes a final region uniform, `within_region_color_variance_after` only validates unification; it is not evidence that the proposed region partition is correct. `false_merge_count`, `false_split_count`, and `manual_quality_grade` are not inferable from B0's structural GT, so the first two are `null` and the grade is `PENDING_MANUAL_REVIEW`.

`region_count_before` is a fixed, candidate-independent raw local fragmentation baseline: 8-connected raw-Lab edge components with DeltaE threshold 5.0. It is not a ground-truth count and does not use candidate configuration. Four concepts are deliberately distinct: Pixel Fragment, Geometry Component, Local Color Region, and experimental Color Group / Color Identity. Disconnected regions can share a Color Group but never share or change geometry masks.

`region_count_ratio_to_gt` remains for historical continuity only and is explicitly `SEMANTICALLY_APPROXIMATE`: B0 `expectedColorRegions.approximateCount` is not a one-to-one target for connected Local Color Regions. The primary B1.2 diagnostic compares `color_group_count_after` to that approximate count: PASS at 0.5–5, WARN at 0.25–0.5 or 5–15, FAIL below 0.25 or above 15. `ColorGroupStatus=EXPERIMENTAL`; grouping is conservative and never changes geometry.

Every metrics file contains alpha topology summaries for alpha >0 and >=32/64/128/192/224, including component count, largest/median area and tiny-component bands. `boundary_shift_state` disambiguates `1.0`: `NO_CANDIDATE_BOUNDARY`, `NO_REFERENCE_BOUNDARY`, or `BOTH_EMPTY` is diagnostic evidence, not a normal maximum value.

`boundary_shift` is deterministic and candidate-independent: derive internal boundaries where adjacent non-background candidate labels differ; derive source reference boundaries where adjacent active input pixels differ by at least `strongEdgeDeltaE` in Lab; calculate the symmetric mean nearest-boundary distance and divide by image diagonal. Both empty is `0`; exactly one empty is `1`.

## Run

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-poc.txt
.\.venv\Scripts\python.exe src\runner.py --profiles balanced,aggressive --candidates CP-A,CP-B --representatives RC-A
```

The runner reads every frozen fixture, records its SHA before and after the run, and writes only under `outputs/color-purification/` and `reports/color-purification/`.

The selected run writes compact `regions.json.gz` summaries rather than repeated pretty `regions.json` files. Human-review contact sheets are generated under `reports/color-purification/contact-sheets/` and are never candidate input.

## B1.1 supersession note

Previous generated output from `2301aa59d7278f54874c219c5e2689ee6153d8ea` is superseded because it had severe over-segmentation and CP-B did not implement its declared region-growing contract.
