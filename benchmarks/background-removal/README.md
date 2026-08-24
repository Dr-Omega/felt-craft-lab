# Background-removal benchmark PoC

This directory is an isolated, CPU-only comparison harness.  It does not take
part in the gateway, candidate, asset, scene, or production post-process
pipelines.  Its purpose is to measure four fixed alternatives on felt-craft and
children's-illustration inputs:

| ID | Implementation | Intended runtime |
| --- | --- | --- |
| `current-rule` | `services.image_postprocess.remove_plain_background` | Pillow / CPU |
| `isnet-anime` | ISNet Anime | ONNX Runtime CPU through `rembg` |
| `birefnet-general-lite` | BiRefNet General Lite | ONNX Runtime CPU through `rembg` |
| `birefnet-general` | BiRefNet General | ONNX Runtime CPU through `rembg` |

`rembg` is a disposable benchmark adapter, not a production dependency or an
architecture decision.  The harness calls the current rule implementation
directly and keeps the model adapter behind `BackgroundRemover`.

## Dataset contract

Each case lives under `cases/BR-XXX/` and contains:

```
source.png | source.jpg | source.jpeg
ground_truth.png  # L/RGBA image: foreground = 255, background = 0
case.json
```

`case.json` has `caseId`, `category`, `description`, and
`criticalStructures`. Before an all-case run, every discovered case is checked
for a matching and unique `caseId`, a decodable source and GT of equal size, a
strictly binary GT (`{0,255}`), and a non-empty `criticalStructures` list. The
acceptance dataset is not complete until it has at least 15 valid reviewed
cases. Do not treat a partial run as a model decision.

`BR-001` is a small synthetic fixture: a cartoon doctor in a white coat on a
light-grey background.  It exists to catch the specific failure where a light
subject is removed with its backdrop; it is **not** a substitute for the 15
real reviewed cases that the owner must provide.

## Isolated environment and models

Install only into a separate virtual environment; do not add these packages to
`backend/requirements.txt`:

```powershell
python -m venv .venv-background-removal
.\.venv-background-removal\Scripts\Activate.ps1
pip install -r benchmarks/background-removal/requirements-benchmark.txt
```

The timed runner defaults to no model download and checks that every selected
model is already present and SHA-verified in the benchmark-only cache
(`benchmarks/background-removal/models/rembg-cache`). Use the explicit prepare
step for download/debug only; it is not a benchmark and acceptance mode rejects
`--allow-model-download`. The cache and output artefacts are ignored by Git.

Model provenance is in `model-manifest.json`. Before an acceptance conclusion,
the result must record installed `rembg`, `onnxruntime`, and Pillow versions;
the exact model revision/source; SHA-256; and a `VERIFIED` weight-licence
status. Before a public redistribution, verify the weight licence and checksum
at the pinned upstream release/model card; an open-source code licence is not
automatically a weight licence.

## Running

Generate (or regenerate) the checked-in illustrative fixture:

```powershell
python benchmarks/background-removal/scripts/create_example_case.py
```

Run only the rule algorithm on the known fixture:

```powershell
python benchmarks/background-removal/scripts/run_benchmark.py --case BR-001 --models current-rule
```

Prepare/download models separately when explicitly authorized (not timed):

```powershell
python benchmarks/background-removal/scripts/prepare_models.py --models all
```

Run a formal all-model acceptance benchmark only after cache SHA verification:

```powershell
python benchmarks/background-removal/scripts/run_benchmark.py --all-cases --models all
```

The formal command fails closed when fewer than 15 valid cases are present or a
selected artifact is absent/unverified. It preflights every selected artifact
before starting any timed session initialization or inference. Use a single
named case only for plumbing/debugging; it is never an acceptance run.

The only status that permits a model-selection conclusion is
`ACCEPTANCE_COMPLETE`. It requires a valid full dataset, every selected model
to initialize, every model/case result to succeed, every manual review to be
complete, and complete reproducibility records. `RUN_COMPLETE_UNREVIEWED` and
`RUN_COMPLETE_UNVERIFIED` are intentionally not acceptance outcomes.

## Measurement definitions

The shared `benchmark-config.json` defines the alpha threshold, warm run count,
interior-mask erosion kernel, and RSS sampling interval. No metric threshold is
hidden in code.

Performance records distinguish `initializeMs`, `firstInferenceMs`, and warm
inference timings. `processPeakRssMb` is high-frequency process RSS sampled
during initialization and inference; it is not a system-wide memory value.

- **subjectRetention**: fraction of GT foreground still non-transparent.
- **backgroundClearRate**: fraction of GT background now transparent.
- **internalHoleRate**: fraction of eroded GT foreground made transparent.
- **foregroundIoU**: binary foreground IoU; supporting evidence only.
- **outputAlphaStats**: transparent, semi-transparent, and opaque pixel ratios.

Every successful model/case result must later receive a human review:

```
boundaryQuality: A | B | C | D
criticalStructure: PASS | PARTIAL | FAIL
visibleInternalHole: true | false
hardFailReasons: largeSubjectDeletion | visibleInternalHole | criticalStructureLost | multiSubjectMissing
```

Any listed `hardFailReasons` value (or `criticalStructure: FAIL`) automatically
sets the result's `finalVerdict` to `FAIL` when the report is written.  The
result schema stores review fields as `null` until a person evaluates the
rendered comparison.

## Review finalization

Timed execution writes only `results/benchmark-run.json`; it never writes or
overwrites manual feedback. Copy the template to the ignored
`results/manual-reviews.json`, complete one entry per successful case/model,
then finalize without rerunning a model:

```powershell
python benchmarks/background-removal/scripts/finalize_benchmark.py
```

Finalization validates every review key, derives each final verdict, recomputes
status, and writes `benchmark-results.json`, `benchmark-summary.md`, and
`comparison.html`.

## Outputs

- `outputs/<model>/<caseId>.png` — emitted only after an actual successful run.
- `results/benchmark-run.json` — immutable-style raw execution result.
- `results/manual-reviews.json` — ignored, independently persisted manual review.
- `results/benchmark-results.json` — finalized machine-readable result.
- `results/benchmark-summary.md` — aggregate metrics, performance and matrix.
- `results/comparison.html` — horizontal source/GT/model inspection grid.

No generated image, model weight, base64 payload, or production asset directory
is committed here.
