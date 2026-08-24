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
source.png | source.jpg
ground_truth.png  # L/RGBA image: foreground = 255, background = 0
case.json
```

`case.json` has `caseId`, `category`, `description`, and
`criticalStructures`.  The acceptance dataset is not complete until it has at
least 15 reviewed cases.  Do not treat a partial run as a model decision.

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

The runner defaults to no model download.  Place weights in the benchmark-only
cache (`benchmarks/background-removal/models/rembg-cache`) or pass
`--allow-model-download` to allow the optional `rembg` adapter to fetch them.
The cache and output artefacts are ignored by Git.

Model provenance is in `model-manifest.json`.  Before a public redistribution,
verify the weight licence and checksum at the pinned upstream release/model
card; an open-source code licence is not automatically a weight licence.

## Running

Generate (or regenerate) the checked-in illustrative fixture:

```powershell
python benchmarks/background-removal/scripts/create_example_case.py
```

Run only the rule algorithm on the known fixture:

```powershell
python benchmarks/background-removal/scripts/run_benchmark.py --case BR-001 --models current-rule
```

Run all four models after installing the optional dependencies and reviewing
their model provenance:

```powershell
python benchmarks/background-removal/scripts/run_benchmark.py --all-cases --models all --allow-model-download
```

The latter command fails closed when fewer than 15 cases are present.  Use a
single named case only for plumbing/debugging; it is never an acceptance run.

## Measurement definitions

The shared `benchmark-config.json` defines the alpha threshold, warm run count,
and interior-mask erosion kernel.  No metric threshold is hidden in code.

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

## Outputs

- `outputs/<model>/<caseId>.png` — emitted only after an actual successful run.
- `results/benchmark-results.json` — machine-readable results and environment.
- `results/benchmark-summary.md` — aggregate metrics, performance and matrix.
- `results/comparison.html` — horizontal source/GT/model inspection grid.

No generated image, model weight, base64 payload, or production asset directory
is committed here.
