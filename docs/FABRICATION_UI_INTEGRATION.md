# Existing algorithm → desktop UI integration

Branch: `integration/fabrication-ui-v1`.
Algorithm baseline: `3db501d218e8929140689549a7bc0738409187cd` (unchanged).
UI/assets: selected recent hand-drawn shell, Canvas frame/tools and exploded-view
components from `feature/projection/explode-ui-v2`,
`de25cc12baaf55a9b8a6befb5543cf6c0e9d3208` (remote checked October 1).
The retired early Canvas skin is not the visual baseline. No entire branch merge;
existing resource access, Canvas engine, persistence and core-pattern guards remain.
Library/create page internals and authentication are not a wholesale SXY UI migration.

## Connected workflow

1. Open **去背景与分层** and choose PNG/JPEG, or save the editor draft and send
   its actual flattened canvas using **整幅作品拆分换色**. **选中元素分层换色**
   instead exports only that visible object in local coordinates, preserving its
   outer scene transform and order in `scene-binding.json`.
2. Main validates image bytes and creates an isolated UUID job. Only one job runs
   at a time; background and fabrication each have a 600-second limit.
3. Existing **BiRefNet General** adapter supplies alpha. Original decoded RGB and
   that explicit alpha enter the existing straight-RGBA handoff. No extra RGB
   multiplication, no inferred alpha encoding, no claim of decontamination.
   Alternatively select **输入已有透明前景**, which rejects opaque/empty inputs.
4. The public guarded runtime runs `aggressive` + `practical-auto` +
   `whole-silhouette-base/1`, including its persisted independent replay.
5. Display actual foreground, design, complete-piece SVG, hidden domains, seams,
   numbered pieces, rerender and monochrome assembly steps. The existing Three.js
   UI receives full-size images rendered from the **actual complete geometry** of
   each work step, not mock layers or sticker stacking order.

Monochrome work steps and material overlap depth are separate. Explosion spacing
is a display aid, not physical thickness. Hiding the first step changes the view
only, not the design, result, background removal or base geometry.

## Run locally

Requires Node dependencies, the existing algorithm Python environment, a Python
environment with the project's rembg/ONNX dependencies, and an already installed
`birefnet-general.onnx` cache. No model download or alternative-model fallback.

```powershell
npm ci
./scripts/start-fabrication.ps1 -AlgorithmPython '<algorithm-env>/Scripts/python.exe' -BackgroundPython '<rembg-env>/Scripts/python.exe' -ModelCache '<existing rembg-cache directory>'
```

The launcher sets `FELT_FABRICATION_PYTHON`, `FELT_BACKGROUND_PYTHON`,
`FELT_BIREFNET_CACHE`, `TYPESCRIPT_TSC`, and `NODE_PATH`. The last two allow the
existing shared TypeScript validator to execute without copying shared code.
The application is currently **development-desktop integration**, not a packaged
Python/model distribution. Packaged builds explicitly refuse these operations.

Outputs/logs are under Electron `userData/fabrication-jobs/<UUID>`, outside the
source checkout. `background.*.log`, `fabrication.*.log`, `foreground-record.json`,
the complete runtime artifacts, `view.json`, and `desktop-job.json` are retained.
Main only serves manifest PNG/SVG assets inside that job's resolved directory.
The renderer cannot choose subprocess arguments, output directories or recipes.

## Verification

```powershell
npm run typecheck
npm run build
node node_modules/vitest/vitest.mjs run
& '<algorithm-env>/Scripts/python.exe' -m unittest discover -s backend/fabrication -p 'test_*.py'
# With the runtime environment variables above and Playwright available in the
# parent workspace, run the actual Electron public-entry smoke test:
node scripts/check-fabrication-electron.cjs '<actual input>' '<new evidence directory>'
```

Real smoke input: user persimmon JPEG, SHA256
`15a0f357c555ed2d8b95612a14e056cbcded4bcd95307f6218e28240c945deb7`.
Actual run: BiRefNet → runtime → independent replay → UI, 3 pieces / 3 monochrome
steps / material depth 2. The automatic selected base is light green; this is the
existing algorithm's selection, **not** a claim that the requested orange-base
visual preference or overall visual quality has passed. No UI-side recoloring.

The above pipeline evidence predates the interactive color edit. Subsequent UI
checks reuse a copy of that genuine job, without rerunning model/geometry or
rewriting the original evidence.

## Step 2: editable whole-layer colors

- Select a **work layer**, not a single piece. Every piece in that work layer uses
  its selected RGB. Identically colored layers at other levels are independent.
- Free hue wheel, saturation/value, RGB channels, native color input, and preset
  palette are connected to live assembly, full-layer images and 3D textures.
- Tinting retains mask alpha and complete-piece geometry. Original diagnostics,
  source image and geometry result remain unchanged, under a separately labeled
  original-results disclosure. Changed color is not a new geometric audit PASS.
- `layer-colors.json` is a versioned edit sidecar bound to result SHA, exact piece
  membership, immutable order and optional originating Canvas scene/object.
  Main validates it, saves by atomic file replacement, and rejects stale revisions.
- Internal `layerIndex=0` is the bottom work layer. Outer Canvas `zIndex` remains
  the existing Element-tier `1..N`, with background below and core-pattern in its
  existing fixed tier. These are different namespaces, not material thickness.
  The original scene snapshot persists all outer order/transform information.
- Save explicitly before leaving; last completed job and saved edits can resume
  after application restart. This restoration is display/editing, not a replay PASS.
- Flattened whole-scene input does not infer original per-element layer ownership.
  Use selected-element processing when that ownership is required.

UI check: `node scripts/check-layer-colors-electron.cjs <completed-job-dir> <new-evidence-dir>`.
It copies actual results into an isolated test profile and verifies preset/RGB/wheel,
other layers unchanged, save/restart restoration, unchanged view bytes, and real
Three.js display. SXY shell/Canvas and compact viewport are also inspected.

Tests cover malformed input, missing environment, opaque/empty foreground,
straight RGB/alpha preservation, concurrent jobs, stage failure, timeout,
invalid result status and manifest path escapes. Browser smoke checks real images,
3D canvas, slider, first-step toggles and return navigation, at desktop and compact
desktop sizes. Screenshots/raw outputs are outside the repository.

Known existing failure: `fabric-editor-adapter.test.ts` concurrent sticker loads
are cancelled by invalid synchronous canvas resize. Reproduced on the unchanged
`3db501d` worktree with the same dependencies (52 pass / 1 fail); not repaired in
this integration. It is not a fabrication-pipeline failure.

Prior integration verification: typecheck and build PASS; 418 Vitest tests,
417 PASS / 1 reproduced baseline failure; all 3 Python handoff tests PASS. Real
BiRefNet desktop runs and a real opaque-input rejection UI run PASS. Browser
page errors: none; document horizontal overflow: none. Existing CRLF package
files retain their line endings; whitespace check uses `cr-at-eol`.

## Movable layer editor and local PSD exports (2026-10-01)

The latest dismantling visual source is the user's local `拆分页` folder, not
the previously inspected GitHub branch. Unmodified exports are in
`assets/ui/dismantle/`; the non-rendering range guide is not a visible asset.
The original Fabric Canvas remains in place. The complete archive's 绘画页
exports provide its frame; dismantling backgrounds are not displayed. Only the
movable panel and layer-thumbnail artwork are used for in-scene layer editing.

- Canvas single click selects; double click exposes quick tools; **编辑** opens
  the element-anchored editor without navigating away from the Canvas.
- Prefer available space on the right, otherwise left; choose the larger side
  and clamp/scroll if neither fits. Resize recomputes viewport placement.
- Layer thumbnails appear top-first (highest layerIndex first), but canonical
  painting order remains bottom-first. Selection edits the complete work layer,
  never changes order or individual piece membership. No drag reorder was added.
- The color wheel, RGB controls and initial 12-color palette stay in the panel's
  right column. Left list and right controls scroll independently. Dirty close
  requires an explicit discard; saving disables color/close actions.
- Unprocessed Canvas elements call existing public fabrication IPC on Edit.
  Already-transparent element exports use embedded alpha; opaque inputs use
  BiRefNet General. Pending close does
  not kill the worker. Completed editable jobs are looked up by exact input bytes
  and scene/object binding; loaded source digest and persisted binding are checked.
- Preview changes the selected object in the original Canvas. “应用到画布” writes
  an immutable personal PNG/version and replaces that object's resource while
  preserving object ID, transform and outer stack order. Close keeps applied
  edits; unapplied edits require discard. Undo/redo pins the prior/new version.
- The immutable asset version links to the real job, source SHA, exact layer
  membership and per-version color snapshot. Project save/reopen retains both
  scene pixels and further layer editing. Job colors use revision conflict checks.
- “加入已分层素材” reuses the most recent completed job through real IPC, without
  rerunning algorithms. Standalone job binding may be null; scene ownership is
  recorded separately, not invented as algorithm Component provenance.

Verification: typecheck/build PASS; 425 Vitest assertions, 424 PASS and the same
one previously reproduced concurrent-load baseline failure. 28 targeted
placement/editor/recolor assertions PASS. Actual Electron evidence:
`../fabrication-ui-evidence/dismantle-popup-06/` (checks.json and screenshots).
It covers real Canvas material addition, single-click selection, double-click
quick tools and edit opening; completed genuine result reuse (no algorithm rerun),
top-first list, whole-layer palette/RGB/wheel editing, save/restart, original
view bytes unchanged, dirty close, left/right layout and 960×640 resize.
Side-switch screenshots move only the display element through the test harness;
they do not imply different pipeline geometry. Canvas tests use the repository's
existing test-only unlock flag in an isolated profile; normal builds keep it off.

## Boundaries

- No changes to algorithm/frozen files, background-removal, R4, formal branches,
  auth/plaza, story cards or manufacturing/export.
- Editor composition is flattened for this image pipeline; original editable
  scene is saved as a draft. Sticker object identities are not fabricated as
  Component identities.
- Whole-layer recolor and originating Canvas writeback are implemented;
  individual-piece recolor is intentionally unavailable. A full job history
  browser and packaged Python/model distribution are not implemented.
- Model/input failure is shown as failure; never replaced by a demo or old PASS.
- Geometric success does not imply visual acceptance. Independent review and user
  visual acceptance remain PENDING; manufacturing NOT_EVALUATED; production NO.

This is a local integration candidate, not a deployment or a merge to main.

## Genuine multi-layer Canvas verification (2026-10-02)

`scripts/check-real-canvas-recolor.cjs <completed-job-dir> <new-evidence-dir>`
copies genuine job `660bc681-a105-4842-ab0b-508a704997c5` to an isolated profile.
No fabrication IPC is mocked. The saved persimmon has three actual work layers;
only layer 3 (orange fruit) is changed to purple. The two green layer images and
their membership remain byte-identical. Native Canvas preview, applied pixels,
undo, redo, project save/process restart and reopening the same editable layers
are exercised; no model or geometry rerun is claimed.

The separate single-layer lotus fixture in `check-in-scene-preview-electron.cjs`
is a local exploratory helper, not included in the integration commit. It tests
UI mechanics only, NOT genuine lotus decomposition or algorithm quality.

Final checks: typecheck and build PASS; targeted renderer/color tests 45/45;
full Vitest 434 discovered, 433 passed, 1 unchanged baseline concurrent-load
failure noted above; Python handoff tests 3/3. Real Electron checks are recorded
in `../fabrication-ui-evidence/real-canvas-recolor-05/checks.json` with screenshots.
373,916 native Canvas pixels changed inside the actual fruit-layer alpha domain;
0 changed outside it. Both other actual layer images remained byte-identical.
Full-scene undo, redo and process-restart restoration matched pixel-for-pixel.
Desktop 1440×900 and compact 960×640 were checked; no page errors.

## Creation Steps 1–2 wiring (2026-10-02)

Scope is the user's red box, not story cards or manufacturing. Supplied PNG
controls are mapped in `assets/ui/creation/README.md`.

| Canvas interaction | Implementation / boundary |
| --- | --- |
| 添加图片 → 直接上传图片 | JPEG/PNG decode, 10MB and dimension checks; original file untouched; JPEG serialized to PNG at original dimensions. Confirmation persists a personal element in the CURRENT scene. |
| 添加图片 → 语音输入生图 | Existing CreationIntent and Main AI gateway reused in a floating dialog; supplied start/pause/resume/done/reset recording artwork. Text fallback retained. Accepted candidate becomes a personal element without navigating away or replacing the scene. |
| Confirm new image | Automatically opens the real element decomposition workflow; embedded alpha is reused, opaque input requests configured BiRefNet General. No sample layers on failure. |
| 背景 / 素材 | Existing catalog and access checks retained; background drawer positioning corrected for DrawingFrame and hidden drawer removed from keyboard navigation. |
| Double click → 编辑 | Whole-layer wheel/RGB/palette recolor on original Canvas, not an isolated recolor page. A new decomposition can also be applied without changing a color. |
| 保存 | Existing project save/reopen; object ordering and element-local layer ordering retained. |

Microphone permission cancellation/unmount releases the late stream. Pause and
resume use the same recording; record session stops after 60 seconds. Candidate
insertion errors remain visible and retryable; an unconfigured AI service is NOT
substituted by an example picture. New-image intake is disabled during layer editing.

Verification commands (from this worktree):

```text
npm run typecheck
npm run build
npx vitest run --reporter=json --outputFile=../fabrication-ui-evidence/step12-full-tests.json
node scripts/check-canvas-intake.cjs <real-transparent-source.png> <new-evidence-directory> [copy-of-previous-test-profile]
node scripts/check-canvas-upload-errors.cjs <new-evidence-directory>
node scripts/check-real-canvas-recolor.cjs <real-completed-job-directory> <new-evidence-directory>
```

Electron catalog tests use the existing test-only
`VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS=true` build in isolated profiles; ordinary
builds leave access rules unchanged. `check-canvas-intake` configures the existing
local algorithm Python environment for **actual** decomposition. Its ASR and
image endpoint are a **loopback HTTP fixture**, not mocked fabrication IPC and
not a live cloud generation result. Main authentication, response validation,
candidate acceptance, file ingestion and scene insertion are actually exercised.
The optional previous-profile argument only avoids repeating the completed
upload leg; a newly accepted image still goes through real decomposition.

Evidence (outside source tree):
- `../fabrication-ui-evidence/step12-canvas-02/`: real upload, background/sticker,
  three real layers, in-scene recolor/save/restart, voice transport/candidate
  preview/cancel, desktop and compact screenshots.
- `../fabrication-ui-evidence/step12-voice-03/`: reuses that saved scene; recorded
  voice and accepted HTTP fixture candidate inserted into the original scene,
  actual downstream decomposition/application/save/reopen.
- `../fabrication-ui-evidence/step12-errors-final/`: ordinary build, damaged image rejection,
  JPEG 80×60 decode without resizing, unavailable ASR, missing runtime rejected
  with zero fake layers.
- `../fabrication-ui-evidence/step12-recolor-regression-01/`: actual three-layer
  recolor regression; unchanged other layers, exact undo/redo/restart scene parity.

Unit results: 450 discovered / 449 passed / 1 failed / 0 skipped. The only failure
is the independently reproduced pre-existing concurrent-sticker test documented
above. All 16 newly added image-boundary/recording lifetime tests passed.

Remaining deployment prerequisite: the real AI Gateway at the configured URL
was not running in this environment. Real microphone-to-cloud ASR and real
image-provider quality are **not verified** by the fixture. Configure/start the
existing Gateway and its provider credentials before live use; never put keys
in renderer code. Python/BiRefNet distribution remains the existing development
integration boundary, not a packaged production implementation. This change
does not modify any frozen algorithms or claim a manufacturing/visual PASS.
