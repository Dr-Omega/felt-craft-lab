# P0-04B1 Local Color Purification PoC

This is an isolated benchmark-only PoC. It does not change alpha, production image processing, background removal, or Fabrication Piece / layer-decomposition behavior.

## Candidates and representative color methods

- CP-A: OpenCV `pyrMeanShiftFiltering` proposal, followed by local connected Lab graph components.
- CP-B: deterministic Lab ΔE graph segmentation with 8-connected local-component expansion. It never treats equal or similar colors in disconnected places as one region.
- CP-C: `DEPENDENCY_UNAVAILABLE`. VTracer watershed was not installed and is never replaced by a different algorithm.
- RC-A: Lab median; RC-B: dominant Lab histogram cell median; RC-C: deterministic local-density mode.

All candidates expose `conservative`, `balanced`, and `aggressive` settings in `configs/profiles.json`. Representative-color selection is independent of candidate selection.

## Alpha and labels

Input alpha is frozen and output alpha must be bit-identical. `0` in `label_map.npz` is transparent/background; every positive ID is exactly one connected local component in that run. Label IDs are run-local, not permanent ColorSlot identities.

Representative colors use a configurable core sampling area: pixels below `coreAlphaMin` and pixels closer than `coreDistancePx` to the region edge are excluded first. A small region safely falls back to its eligible/full region instead of being deleted. The candidate proposal has a configurable local `proposalMinRegionArea`; any proposal smaller than it is merged only through its adjacent Lab graph, never globally. Both that value and `smallRegionStrategy` are written to every `run_config.json`.

## Metrics

Color variance is the mean per-channel variance in CIE Lab, calculated over the candidate's final local regions before and after purification. `false_merge_count`, `false_split_count`, and `manual_quality_grade` are not inferable from B0's structural GT, so the first two are `null` and the grade is `PENDING_MANUAL_REVIEW`.

`boundary_shift` is deterministic and candidate-independent: derive internal boundaries where adjacent non-background candidate labels differ; derive source reference boundaries where adjacent active input pixels differ by at least `strongEdgeDeltaE` in Lab; calculate the symmetric mean nearest-boundary distance and divide by image diagonal. Both empty is `0`; exactly one empty is `1`.

## Run

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-poc.txt
.\.venv\Scripts\python.exe src\runner.py --profiles balanced --candidates CP-A,CP-B,CP-C --representatives RC-A,RC-B,RC-C
```

The runner reads every frozen fixture, records its SHA before and after the run, and writes only under `outputs/color-purification/` and `reports/color-purification/`.
