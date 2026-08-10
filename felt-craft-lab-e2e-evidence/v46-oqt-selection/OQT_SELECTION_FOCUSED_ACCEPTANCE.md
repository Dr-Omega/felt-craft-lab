# OQT Selection Projection Focused Acceptance

## Scope

Focused acceptance of the renderer-only selection projection and Object Quick
Tools in the built production Electron renderer. This is not FULL E2E. The
run does not change Shared Contracts, SceneDocument, persistence, resolver,
catalog/snapshot rules, or Electron security boundaries.

## Result

`OQT_SELECTION_FOCUSED_PASSED`

The real production UI path passed: library → themed new Scene → real mouse
sticker additions → single-click selection → double-click OQT → layer actions
→ real drag with OQT open → real corner scale with OQT open → real rotation
with OQT open → remove toast → toast undo. The final run used only production
UI mouse input for these actions; no Session/Adapter delete or Fabric-object
mutation was invoked by the harness.

## Requested fields

- Verdict: `OQT_SELECTION_FOCUSED_PASSED`
- Branch: `feature/material-library/oqt-selection-projection`
- Tested source: `27b8f9c99b9642b88b74ae095db54e2539cbafda`
- Production mode: built Electron renderer; no test-only Fabric smoke page
- Single click selects a sticker and does not auto-open OQT: PASS
- Double click opens OQT: PASS
- OQT labels: `往前`, `往后`, `拿掉`
- OQT layer action uses exact projected object identity: PASS (real UI)
- Remove uses exact projected object identity: PASS (real UI)
- Remove toast text and undo affordance: PASS
- Toast undo restores through Session history: PASS
- OQT closes after removal: PASS
- Real drag with OQT open and projection follows geometry: PASS
- Real corner scale with OQT open: PASS
- Real rotation with OQT open: PASS
- Invalid object projection suppression: PASS (unit tests)
- Recovery placeholder suppression: PASS (unit tests)
- Listener unsubscribe: PASS (unit tests)
- Adapter dispose clears selection listeners: PASS (unit tests)
- Session subscription boundary before open/disposed: PASS (unit tests)
- Listener exception isolation: PASS (unit tests)
- Retina-safe logical-to-screen mapping: PASS (unit test/real Electron)
- Selection persistence: not implemented by design
- SceneDocument schema changes: none
- Fabric JSON persistence: none
- Console errors: 0
- Page errors: 0
- Network errors: 0
- Main process product errors: 0; only DevTools banner and Canvas2D
  `willReadFrequently` performance hint were observed

## Geometry correction

Fabric sets the HTML canvas backing dimensions to `1440x1440` at the Electron
test DPR of 1.5 while the SceneDocument logical canvas remains `960x960` and
the visible/event CSS surface is `518x518`. OQT projection now uses the stable
logical SceneDocument dimensions and the CSS `getBoundingClientRect`, so it
does not multiply by DPR or mistake retina backing size for logical geometry.
The Fabric container is explicitly constrained to the visible frame, keeping
real pointer hit testing aligned with the projected controls.

## Evidence

- `selection-events.json`
- `oqt-geometry.json`
- `remove-undo.json`
- `error-audit.json`
- `01_single_click_selection.png` through `13_after_resize.png`

The only setup operation was seeding explicit unlock rows in the isolated test
profile so the normal production unlocked-material path was reachable. The
profile is disposable and is not a product data change.
