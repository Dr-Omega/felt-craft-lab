# OQT Selection Projection Focused Acceptance

## Scope and source

This is the V4.6 focused production-Electron acceptance for renderer-only
selection projection and Object Quick Tools (OQT). It is not FULL E2E and does
not change Shared Contracts, SceneDocument, persistence schema/workflow,
resolver/snapshot/catalog rules, AI/audio, or Electron security boundaries.

- Base branch source: `feature/material-library/ui-redesign`
- Base SHA: `c61886cc401f1a4d99d95c3caaaa8dad6ea54167`
- Branch: `feature/material-library/oqt-selection-projection`
- Tested implementation SHA: `a6eba360c07968c32fd72b66751c9057a31a8d90`
- Mode: built production Electron renderer; test-only Fabric smoke entry was
  not used
- Verdict: `OQT_SELECTION_FOCUSED_PASSED`

## Selection projection contract

The public runtime projection is plain data only: `objectId` plus logical
canvas bounds. It contains no Fabric object, DOM node, screen/DPR coordinate,
SceneDocument, resource URL, zIndex, or persistence data. The adapter emits
`selection:created`, `selection:updated`, `selection:cleared`,
`mouse:dblclick`, `object:moving`, `object:scaling`, `object:rotating`, and
`object:modified` through the selection event boundary. Unit coverage also
checks invalid-object/recovery-placeholder suppression, unsubscribe/dispose,
listener exception isolation, and the retina-safe logical-to-screen mapping.

## Real production UI results

All 16 focused assertions passed:

- Single click selected a sticker without opening OQT: PASS.
- Real double click opened OQT: PASS.
- OQT layer actions operated on the exact projected `objectId`: PASS.
- Forward/backward changed adjacent zIndex values and preserved continuity:
  PASS.
- Real mouse drag kept OQT projected to the moved logical bounds: PASS.
- Real mouse corner scale changed `0.46875` to `0.44069739382239387`, kept
  `scaleX === scaleY > 0`, and kept OQT open: PASS.
- Real mouse rotation changed angle to `9.74296645573645` and kept OQT open:
  PASS.
- The successful rotation control point was outside the captured OQT rectangle:
  PASS.
- Exact remove removed one object, kept remaining zIndex `1..2`, and showed
  the production remove toast: PASS.
- Toast undo restored the same `objectId`, exact transform, and exact Scene
  (ignoring only `updatedAt`): PASS.
- A layer mutation invalidated the remove toast: PASS.
- Blank canvas click closed OQT: PASS.
- Material sheet, background drawer, and return modal were mutually exclusive
  with OQT: PASS.
- Native `window.resizeTo(800, 600)` changed the visible canvas from `518x518`
  to `398x398`, reprojected OQT, and preserved Scene data: PASS.

The harness used real `Input.dispatchMouseEvent` mouse input for user actions.
It did not call `session.deleteSelected()`, `adapter.deleteSelected()`,
`adapter.deleteObject()`, or mutate Fabric objects. The only setup write was
seeding three explicit unlock rows in the disposable isolated Electron
profile; persistence reads were IndexedDB read-only.

## Geometry and persistence evidence

Fabric's retina backing canvas was `1440x1440` at DPR `1.5`, while the logical
SceneDocument and CSS event surface were `960x960` and `518x518`. Projection
uses logical SceneDocument dimensions with the CSS `getBoundingClientRect`
scale; it does not multiply by DPR. The lower/upper Fabric surfaces and the
visible frame were aligned.

The real UI saved ProjectRecords after initial add, layer changes, drag, scale,
rotation, remove, undo, and resize. Every inspected preview was a non-empty
PNG with `960x960` dimensions and `image/png` content type. Scene summaries
showed finite transforms, uniform positive scale, normalized angles, unique
objectIds, and continuous zIndex values.

## Errors and warnings

- Console errors: `0`
- Page errors: `0`
- Network errors: `0`
- Main process product errors: `0`
- Non-product observations: Electron DevTools listening banner and Chromium's
  Canvas2D `willReadFrequently` performance hint only.
- No CSP regression observed.

## Automated quality gates

- `npm.cmd run typecheck`: PASS (`tsc` node/web/test projects)
- `npm.cmd test -- --run`: PASS (`21` files, `197` Vitest tests; assets builder
  `8` tests passed)
- `npm.cmd run build`: PASS (production bundle)
- `npm.cmd run test:electron-resource`: PASS (resource protocol, PNG/audio/
  preview, and Fabric 5.3.0 smoke)
- Focused Electron script: PASS (`16/16` assertions)

## Evidence files

- `selection-events.json`
- `oqt-geometry.json`
- `remove-undo.json`
- `error-audit.json`
- `01_single_click_selection.png`
- `02_after_first_sticker.png`
- `03_after_second_sticker.png`
- `04_after_third_sticker.png`
- `05_single_click_selection.png`
- `06_double_click_oqt_open.png`
- `07_after_bring_forward.png`
- `08_after_send_backward.png`
- `08_after_drag_with_oqt.png`
- `09_after_corner_scale.png`
- `11_after_rotation.png`
- `12_after_remove.png`
- `13_after_remove_undo.png`
- `14_after_resize.png`

## Explicit scope boundaries

Selection persistence is not implemented by design. FULL E2E, product-wide
navigation, and unrelated editor workflows were not rerun in this focused
task. This does not supersede the existing FULL E2E baseline. Fabric JSON is
not a persistence format, and no Shared Contracts or SceneDocument fields were
changed.
