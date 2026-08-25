# Fabrication-Aware Layer Decomposition Benchmark

This directory is a frozen evaluation baseline for two future, non-production PoCs:

- Local Color Purification
- Generic Fabrication Layer Decomposition

It is not a production feature. It does not call an image provider, change ImageService/I2I behavior, or contain a color, segmentation, piece, layer-graph, or fabrication-cost algorithm.

## Input domain and fixture classes

Formal fixtures are project-acceptable PNGs with RGBA input, a single subject, transparent alpha, broad color blocks, weak/no gradient, weak/no shadow, weak/no texture, simple contours, and no strong perspective. `fixtureType: project_real` means an existing project asset/output was copied unchanged and its original repository source is recorded in `sourceAudit.originalSourcePath`. `synthetic_unit` is reserved for a clearly-labelled, narrow algorithm unit test and must never be mixed into project-real conclusions.

`categoryHint` is only for human review. Generic benchmark algorithms must not read it, branch on it, or use it as a semantic prior.

## Ground truth level

The first GT level is structural rather than pixel-perfect: approximate color-region count, must-separate/must-merge relations, reasonable piece-count range, required below relations, void policy, manufacturing notes, known difficulty, and manual judgement notes. It deliberately avoids invented stable piece IDs where an assessor cannot define them consistently.

Benchmark fixtures/GT一旦进入正式比较阶段，不得为了让算法分数更好而随算法实现修改。 If a GT is actually incorrect, record a separate correction reason and review it independently.

## Future metric contracts

Color Purification records: `region_count_before`, `region_count_after`, `small_component_count_before`, `small_component_count_after`, `within_region_color_variance_before`, `within_region_color_variance_after`, `boundary_shift`, `false_merge_count`, `false_split_count`, and `manual_quality_grade` (`A` direct-to-decomposition, `B` acceptable, `C` small repair, `D` clearly wrong, `F` unusable).

Generic Decomposition records: `candidate_count`, `selected_base_candidate`, `piece_count`, `layer_edge_count`, `cycle_detected`, `reconstruction_label_accuracy`, `boundary_error`, `small_piece_count`, `thin_feature_count`, `total_piece_area`, `total_cut_perimeter`, `manual_correction_count`, `visual_quality_grade`, and `fabrication_quality_grade`. Visual and fabrication quality must remain separate; no single total score may hide either failure.

The manifest reserves future candidates only: CP-A OpenCV Mean Shift, CP-B Lab/DeltaE/region growing/local representative color, CP-C VTracer Watershed; RC-A Lab median, RC-B histogram mode, RC-C Mean Shift mode; GD-A generic geometry algorithm; BL-VTRACER; and possible BL-LAYERD. None is implemented or installed here.

## Outputs and audit rules

`candidates/`, `outputs/`, and `reports/` are for later algorithm runs. This stage does not write comparison results. Validators are read-only and fail closed; they never repair a fixture, GT, or manifest. Formal results must identify the manifest/contract version and preserve manual visual and fabrication grades separately.

## Commands

From this directory (with the repository backend Pillow environment available):

```powershell
python tools/validate_benchmark.py
python tools/inspect_fixture.py FLD-001
```

`validate_benchmark.py` checks all fixture/GT links, schema-level contract fields, legal geometry tags, image decoding/mode/dimensions, and unknown GT references. `inspect_fixture.py` only reads one fixture and prints a compact summary; it never writes image data, Base64, or pixel dumps.

## Current gaps

See [FIXTURE_GAP_REPORT.md](FIXTURE_GAP_REPORT.md). The initial eight audited fixtures cover G01 and G03–G10. A verified project-real G02 AI color-drift image is still required, and the target set remains approximately 20 rather than eight.
