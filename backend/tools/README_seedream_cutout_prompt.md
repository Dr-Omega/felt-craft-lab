# Seedream Cutout Prompt V1/V2 Smoke

`smoke_seedream_cutout_prompt.py` is an internal, explicit paid smoke tool. Each fixed case makes one Seedream provider call, writes the direct provider response as `raw.png`/`raw.jpg`, then sends those same bytes through the existing finalization route and writes `final.png`. It never sends two requests for a raw/final pair.

Run V1 and V2 against the identical fixed S01–S08 cases:

```powershell
$env:IMAGE_PROFILE_CORE_PATTERN="felt-seedream45-ref8-v1"
python tools/smoke_seedream_cutout_prompt.py --profile v1 --save-dir .\cutout-prompt-smoke\v1 --real

$env:IMAGE_PROFILE_CORE_PATTERN="felt-seedream45-ref8-v2-cutout"
python tools/smoke_seedream_cutout_prompt.py --profile v2 --save-dir .\cutout-prompt-smoke\v2 --real
```

The CLI sets the selected profile for its own process as an extra guard. `--real` and `ARK_API_KEY` are both required. `metadata.json` records only case/profile/provider/model/reference-set/count and filenames; it never records a secret, prompt text, Base64, signed URL, or authorization header.

## Manual review

Inspect raw first:

- R1: model-created white outline
- R2: model-created sticker border
- R3: halo or glow
- R4: uniform solid background
- R5: background contrast versus white/light regions
- R6: requested subject count and relationship retained
- R7: stable color blocks with limited gradients

Then inspect final:

- F1: white/light subject accidentally deleted
- F2: white edge added or enlarged
- F3: silhouette damaged
- F4: internal structure accidentally removed

Diagnosis: a border already in raw is a prompt/model/reference-style issue; a border appearing only in final is postprocess/background-removal evidence. A complete light raw subject that disappears in final is a background-removal issue. If raw has clear contrast but final still deletes it, do not keep stacking prompt rules—return to the independent background-removal route.
