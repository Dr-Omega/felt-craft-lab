# M4 color-purification runtime

This audit-only runtime consumes a caller-supplied foreground, runs the existing CP-B → RC-A → Region/Component → P0-04C vector chain, and emits observed-only candidates plus a static QC page. It does **not** perform or evaluate automatic background removal, select a Base, infer hidden contours or layer order, create final pieces, or authorize production/manufacturing export.

The single reusable processing API is `m4_runtime.run_runtime(...)`. It owns input normalization and always enforces protected-path, non-empty-output, and input/output-overlap checks before delegating to the private writer. Service callers must not import underscore-prefixed implementation functions.

## Run the project-real development example

From the repository root, using the existing color-purification environment:

```powershell
python benchmarks/fabrication-layer-decomposition/tools/run_m4_runtime.py `
  --image benchmarks/fabrication-layer-decomposition/fixtures/source/FLD-001.png `
  --foreground-mode embedded-alpha `
  --foreground-source PROJECT_REAL_READ_ONLY_FIXTURE_SOURCE_FLD-001 `
  --manual-confirmation PENDING_REVIEW `
  --profile aggressive `
  --runtime-id m4-dev-crescent-001 `
  --output tmp/m4-runtime-demo
```

The input is a read-only project-real fixture source, but the runtime ID and outputs are explicitly outside the frozen FLD evidence identity. Open `tmp/m4-runtime-demo/index.html`; its images are embedded, so the page remains self-contained. Delete or choose a new output directory before rerunning because the CLI refuses non-empty output directories.

For an external foreground mask, use a same-size PNG in mode `L` and replace the foreground arguments with:

```text
--foreground-mode external-mask --mask path/to/mask.png
```

An image with existing non-opaque alpha plus an external mask is rejected because no alpha-combination policy is defined. A fully opaque embedded-alpha input is rejected unless the caller adds `--whole-image-foreground`.

## Runtime products

- `purified.png` preserves the effective input alpha bit-for-bit.
- `structural_label_map.npz` is the geometry truth; `pixel_label_map.npz` retains low-alpha fringe and explicit `-1` orphan assignments.
- `regions.json` records Region identity and per-Region 4-connected Components.
- `boundary-graph.json` and `vector-result.json` contain shared directed edges and the selected 0.5-source-pixel V2 → V1 → V0 route.
- `observed-candidates.json` maps exactly one observed candidate to each `(runtimeId, Region, Component)` key. `finalCutGeometry`, Base, layer order, and assembly remain `null`; production export is false.
- `metrics.json`, `report.json`, and `index.html` carry no-GT/null semantics, hard-gate results, pending human review, provenance, warnings, and stage timing.

All output coordinates are source-pixel coordinates. The 0.5 value is a vector evidence tolerance, not a manufacturing tolerance.
