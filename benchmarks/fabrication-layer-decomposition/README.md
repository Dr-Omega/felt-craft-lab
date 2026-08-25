# Fabrication-Aware Layer Decomposition Benchmark

This directory is a frozen evaluation baseline for two future, non-production PoCs:

- Local Color Purification
- Generic Fabrication Layer Decomposition

It is not a production feature. It does not call an image provider, change ImageService/I2I behavior, or contain a color, segmentation, piece, layer-graph, or fabrication-cost algorithm.

## Input domain and fixture classes

Formal fixtures are project-acceptable PNGs with RGBA input, a single subject, transparent alpha, broad color blocks, weak/no gradient, weak/no shadow, weak/no texture, simple contours, and no strong perspective. `fixtureType: project_real` means an existing project asset/output was copied unchanged and its original repository source is recorded in `sourceAudit.originalSourcePath`. `synthetic_unit` is reserved for a clearly-labelled, narrow algorithm unit test and must never be mixed into project-real conclusions.

`categoryHint` is only for human review. Generic benchmark algorithms must not read it, branch on it, or use it as a semantic prior.

## Ground truth level

The first GT level is structural rather than pixel-perfect: approximate color-region count, color-slot separation/share relations, geometry-component separation, reasonable piece-count range, required below relations, void policy, manufacturing notes, known difficulty, and manual judgement notes. It deliberately avoids invented stable piece IDs where an assessor cannot define them consistently.

### Geometry is not color identity

`expectedGeometryComponents.mustRemainSeparate` describes distinct connected geometry/pieces. `expectedColorRelations.mustShareColor` describes a shared ColorSlot only. They are intentionally independent: for example, FLD-004's left and right rear petals remain two disconnected geometry components while sharing the same color. Do not represent that relationship as a geometry merge, and do not infer a merge merely because two pieces share a color.

### Global Void and solid-piece contract

A fabrication piece is closed and solid: it must not rely on its own transparent interior holes. A Global Void is a real background area in the final assembly topology. When a fixture must preserve one or more Global Voids, an automatic outcome must use `MULTI_SOLID_PIECE` so multiple solid pieces collectively surround the void, or it must be declared `MANUAL_REQUIRED`. A single holed fabrication piece is never a valid success outcome. This benchmark records the policy only; it does not implement a Global Void split algorithm.

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

`validate_benchmark.py` checks all fixture/GT links, strict fixture-ID path contracts, schema-level known fields (including nested objects), legal geometry tags, image decoding/mode/dimensions, declared transparency against actual alpha pixels, project-real source existence and copied-byte SHA equality, and unknown GT references. Its success count is calculated from the current manifest and GT files. `inspect_fixture.py` only reads one fixture and prints a compact summary; it never writes image data, Base64, or pixel dumps.

## Current gaps

See [FIXTURE_GAP_REPORT.md](FIXTURE_GAP_REPORT.md). The initial eight audited fixtures cover G01 and G03–G10. A verified project-real G02 AI color-drift image is still required, and the target set remains approximately 20 rather than eight.
