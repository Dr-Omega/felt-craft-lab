# P0-04B1 Local Color Purification PoC

This is an isolated benchmark-only PoC. It does not change alpha, production image processing, background removal, or Fabrication Piece / layer-decomposition behavior.

## Candidates and representative color methods

- CP-A: OpenCV `pyrMeanShiftFiltering`, followed by 8-connected local Lab edge components. It does not use a generic graph segmenter after Mean Shift.
- CP-B: deterministic seeded 8-connected Lab spatial region growing. A candidate is admitted only when its local CIEDE2000 edge distance is within `labDeltaECell`; recorded as `deltaEMethod=CIEDE2000`.
- CP-C: `DEPENDENCY_UNAVAILABLE`. VTracer watershed was not installed and is never replaced by a different algorithm.
- RC-A: Lab median; RC-B: dominant Lab histogram cell median; RC-C: deterministic local-density mode.

All candidates expose `conservative`, `balanced`, and `aggressive` settings in `configs/profiles.json`. Representative-color selection is independent of candidate selection.

## Alpha and labels

Input alpha is frozen and output alpha must be bit-identical. `0` in `label_map.npz` is transparent/background; every positive ID is exactly one connected local component in that run. Label IDs are run-local, not permanent ColorSlot identities.

Representative colors use a configurable core sampling area: pixels below `coreAlphaMin` and pixels closer than `coreDistancePx` to the region edge are excluded first. A small region safely falls back to its eligible/full region instead of being deleted. Proposal `smallRegionStrategy=keep` keeps every local component; `merge_adjacent_local` merges a component smaller than `smallRegionArea` only into a directly touching neighbour within `smallRegionMergeDeltaE`, preferring the smallest Lab distance and then longest shared edge. No global same-colour merge or deletion is permitted. Both values are written to every `run_config.json`.

## Metrics

Color variance is the mean per-channel variance in CIE Lab, calculated over the candidate's final local regions before and after purification. Because representative assignment intentionally makes a final region uniform, `within_region_color_variance_after` only validates unification; it is not evidence that the proposed region partition is correct. `false_merge_count`, `false_split_count`, and `manual_quality_grade` are not inferable from B0's structural GT, so the first two are `null` and the grade is `PENDING_MANUAL_REVIEW`.

`region_count_before` is a fixed, candidate-independent raw local fragmentation baseline: 8-connected raw-Lab edge components with DeltaE threshold 5.0. It is not a ground-truth count and does not use candidate configuration. The structural diagnostics `ground_truth_approx_region_count`, `region_count_ratio_to_gt`, `small_component_ratio_after`, mean/median/p10 region area, and `region_count_order_gate` expose order-of-magnitude splits. The PoC diagnostic gate is PASS at ratio <=5, WARN at <=15, FAIL above 15; it is not a production acceptance threshold.

`boundary_shift` is deterministic and candidate-independent: derive internal boundaries where adjacent non-background candidate labels differ; derive source reference boundaries where adjacent active input pixels differ by at least `strongEdgeDeltaE` in Lab; calculate the symmetric mean nearest-boundary distance and divide by image diagonal. Both empty is `0`; exactly one empty is `1`.

## Run

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-poc.txt
.\.venv\Scripts\python.exe src\runner.py --profiles conservative,balanced,aggressive --candidates CP-A,CP-B --representatives RC-A
```

The runner reads every frozen fixture, records its SHA before and after the run, and writes only under `outputs/color-purification/` and `reports/color-purification/`.

## B1.1 supersession note

Previous generated output from `2301aa59d7278f54874c219c5e2689ee6153d8ea` is superseded because it had severe over-segmentation and CP-B did not implement its declared region-growing contract.
