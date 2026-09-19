# V4.6 Editor UI Capability Gaps

This document records the application-layer capabilities required by the
V4.6 editor. It does not change Shared Contracts, SceneDocument,
Persistence, Resolver, Snapshot, or the canonical 960x960 Canvas.

## 1. OQT selection, quick tools, and removal

- **Public capability:** `EditorSessionService` exposes a renderer-only,
  read-only selection projection (`objectId` and logical Canvas bounds) through
  `subscribeSelection(listener)`.
- **UI boundary:** `ObjectQuickTools` calls Session commands by exact
  `objectId`; it never stores Fabric objects or persisted selection state.
- **Geometry boundary:** logical SceneDocument dimensions are mapped through
  the visible Canvas CSS rectangle. Retina backing dimensions are never used
  as logical coordinates.
- **Status:** `RESOLVED_IN_OQT_SELECTION_PROJECTION`.

## 2. Dirty state and save baseline

- **Public capability:** `EditorSessionState.isDirty` is derived from runtime
  History Projection revisions. It is not based on Fabric JSON or a persisted
  Scene field.
- **Baseline:** `EditorSessionService.markSaved()` records the current
  history revision after an outer Draft/Project persistence write succeeds.
  `prepareDraftSave()` and `prepareProjectSave()` never mark the session clean.
- **Launch semantics:** a new work session starts dirty; successfully opened
  Draft and Project sessions are marked clean by `EditorPage` after import.
- **Return gate:** clean Draft/Project sessions return directly to Library;
  dirty sessions, including untouched new work, use the Return Save Modal.
- **Status:** `RESOLVED_IN_EDITOR_STATE_CONTROLS`.

## 3. History capability projection

- **Public capability:** `EditorHistoryProjection` contains only
  `revision`, `canUndo`, and `canRedo`.
- **Adapter boundary:** `FabricEditorAdapter.subscribeHistory(listener)`
  emits only after a stable history entry/index is committed. Undo and redo
  reuse the target entry revision; a new mutation receives a new runtime
  revision and truncates the redo branch.
- **Session boundary:** `EditorSessionState` projects `canUndo` and `canRedo`.
  The Dock disables commands using those values, `busy`, and `canEdit`; Vue
  does not inspect Fabric history.
- **Status:** `RESOLVED_IN_EDITOR_STATE_CONTROLS`.

## 4. Fabric selection-control theme

- **Public API only:** the adapter applies `V46_FABRIC_CONTROL_THEME` through
  Fabric Object options and the public `object.controls` / `Control` API.
  No private Fabric fields, DOM overlays, or test-only hit-test controls are
  used.
- **Frozen tokens:** border `#E8A572`, white handle fill `#FFFFFF`,
  `#E8A572` handle stroke, circular handles, compact 8px visible controls,
  and a 40px public rotation-control offset with a larger touch target.
- **Coverage:** new Stickers, imported Scene Stickers, history-restored
  Stickers, and recovery placeholders receive the same adapter-level theme.
  Transform semantics remain unchanged: centered origin, uniform positive
  scaling, normalized rotation, no flip, no skew, drag, Safe Fit, and zIndex
  serialization are not altered.
- **Status:** `RESOLVED_IN_EDITOR_STATE_CONTROLS`.

## 5. Public API limitation

Fabric 5.3.0 exposes public control sizing and touch-area properties, but it
does not provide a global CSS-pixel guarantee independent of display scaling.
The implementation therefore prioritizes correct frozen colors, circular
handles, a clear selection ring, a reachable rotation control, and real mouse
interaction at supported window sizes.

- **Status:** `RESOLVED_WITH_PUBLIC_API_LIMITATION`.

## 6. Resource category filtering

`AssetRecord` has no category field. The editor retains the formal catalog's
available `all` view and does not invent categories or change snapshot/unlock
rules.

- **Status:** `CATEGORY_SOURCE_NOT_AVAILABLE`.

## Current completion boundary

OQT selection projection, dirty state, History Projection, Undo/Redo capability
state, return gating, and the V4.6 Fabric control theme are resolved in the
`editor-state-controls` implementation. Category filtering remains blocked by
the frozen source contract. No persistence schema or product boundary is
changed by these renderer-only capabilities.
