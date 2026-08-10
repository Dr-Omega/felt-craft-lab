# OQT Selection Projection Focused Acceptance

## Scope

This is a focused production Electron acceptance run for the renderer-only
selection projection and Object Quick Tools. It is not FULL E2E and does not
change the UI branch, Shared Contracts, SceneDocument, persistence, resolver,
or Electron security boundary.

## Result

`OQT_SELECTION_FOCUSED_WITH_MINOR_ISSUES`

The core production UI path passed: library → themed new Scene → real mouse
sticker additions → double-click selection → quick-tool layer actions → remove
toast → toast undo. Unit coverage for geometry projection and listener cleanup
also passed. The only minor/test issue is the existing production display
surface mismatch documented in `oqt-geometry.json`; it prevented a reliable
focused GUI assertion that OQT follows a real drag, so that assertion remains
NOT_TESTED rather than being called PASS.

## Requested fields

- Verdict: `OQT_SELECTION_FOCUSED_WITH_MINOR_ISSUES`
- Branch: `feature/material-library/oqt-selection-projection`
- Tested source: `c61886cc401f1a4d99d95c3caaaa8dad6ea54167` (before the final evidence-only commit)
- Production mode: built Electron renderer, no test-only Fabric smoke page
- Single click selects a sticker and does not auto-open OQT: PASS
- Double click opens OQT: PASS
- OQT labels: `往前`, `往后`, `拿掉`
- OQT layer action uses exact projected object identity: PASS (real UI)
- Remove uses exact projected object identity: PASS (real UI)
- Remove toast text and undo affordance: PASS
- Toast undo restores through Session history: PASS
- OQT closes after removal: PASS
- Geometry projection event coverage: PASS (unit tests)
- Real drag with OQT open: NOT_TESTED / TEST_ISSUE (surface mismatch)
- Real corner scale with OQT open: NOT_TESTED / TEST_ISSUE (surface mismatch)
- Real rotation with OQT open: NOT_TESTED / TEST_ISSUE (surface mismatch)
- Invalid object projection suppression: PASS (unit tests)
- Recovery placeholder suppression: PASS (unit tests)
- Listener unsubscribe: PASS (unit tests)
- Adapter dispose clears selection listeners: PASS (unit tests)
- Session subscription boundary before open/disposed: PASS (unit tests)
- Listener exception isolation: PASS (unit tests)
- Logical-to-screen mapping implementation: PASS (code review/unit boundary)
- Selection persistence: not implemented by design
- SceneDocument schema changes: none
- Fabric JSON persistence: none
- Canvas/display surface mismatch: MINOR TEST ISSUE, pre-existing shell geometry
- Console errors: 0
- Page errors: 0
- Main process errors: 0 (only DevTools banner and Canvas2D performance hint)

## Evidence

- `selection-events.json`
- `oqt-geometry.json`
- `remove-undo.json`
- `error-audit.json`
- `01_single_click_selection.png` through `13_after_resize.png`

All critical actions were dispatched as real mouse input to the production
Electron window. The harness did not call `session.deleteSelected`,
`adapter.deleteSelected`, `adapter.deleteObject`, or mutate Fabric objects.
The only setup operation was seeding explicit unlock rows in the isolated test
profile so production UI could reach the normal unlocked-material path.
