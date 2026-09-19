# M3-A Background Removal acceptance entry status

Status: `PLUMBING_ONLY_NOT_ACCEPTANCE`.

## Current dataset

- Required reviewed acceptance cases: **15**.
- Complete cases present: **1** (`BR-001`).
- Project-real reviewed acceptance cases present: **0**.
- `BR-001` is synthetic plumbing evidence only. It cannot substitute for a
  reviewed acceptance dataset or support a model-selection conclusion.

`DATASET_READY_FOR_ACCEPTANCE = NO`.

## Formal entry gates

Before `--all-cases` can produce `ACCEPTANCE_COMPLETE`, the benchmark needs:

1. Fifteen or more complete, project-real reviewed cases following the case
   contract.
2. The exact environment in `acceptance-environment.json`: Python 3.12.x,
   rembg 2.0.81, onnxruntime 1.29.0, Pillow 12.3.0, numpy 2.5.2, and psutil
   7.2.2.
3. Each selected non-rule model artifact already present in the isolated cache
   with the manifest SHA, exact revision, and verified weight licence.
4. A complete human review for every successful model/case result.

No model is selected by this report. No model weights are included or fetched.
