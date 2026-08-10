# V4.6 Editor UI Capability Gaps

This document records the public application-layer capability gaps for the
V4.6 editor UI. It does not change Shared Contracts, SceneDocument,
FabricEditorAdapter, or EditorSessionService semantics.

## 1. OQT selection, quick tools, and removal

- **Public capability:** `EditorSessionService` now exposes a renderer-only,
  read-only selection projection (`objectId` and logical Canvas bounds) through
  `subscribeSelection(listener)`. The adapter emits selected, geometry,
  double-click, and cleared events without leaking Fabric objects.
- **UI boundary:** `ObjectQuickTools` renders only `往前`, `往后`, and `拿掉`.
  Layer and removal actions call the Session by exact `objectId`; the UI does
  not keep Fabric instances, screen coordinates, or persisted selection state.
  `RemoveToast` offers a short-lived `撤销` action through Session undo.
- **Geometry boundary:** logical SceneDocument dimensions are mapped through
  the canvas CSS rect; retina backing dimensions are never treated as logical
  coordinates. The Fabric container and visible frame share the same CSS
  surface so real pointer hit testing follows the projection.
- **Status:** `RESOLVED_IN_OQT_SELECTION_PROJECTION`.

## 2. Dirty state and return gate

- **Current public capability:** Session lifecycle, recovery state, and pending
  operations are public, but there is no public dirty baseline or save-baseline
  comparison.
- **Minimum missing capability:** a read-only `isDirty` projection or equivalent
  change subscription backed by successful Draft/Project save baselines. It must
  not compare Fabric JSON in the page.
- **Status:** `TEMP_UI_FALLBACK`. The return flow retains its explicit save,
  discard, and continue choices; this is not a real dirty detector.

## 3. Fabric control theming

- **Current public capability:** Fabric control behavior is owned by the adapter;
  Vue cannot safely restyle controls through a public application API.
- **Minimum missing capability:** an adapter-level control theme mapping to V4.6
  tokens without changing SceneDocument.
- **Status:** `BLOCKED_BY_AUTHORIZATION`. This branch intentionally leaves it
  unchanged.

## 4. Undo/Redo capability projection

- **Current public capability:** Session exposes `undo()` and `redo()` commands,
  but `EditorSessionState` does not expose `canUndo` or `canRedo`.
- **Minimum missing capability:** a read-only history capability projection so
  the dock can disable unavailable commands without inspecting Fabric history.
- **Status:** `BLOCKED_BY_AUTHORIZATION`.

## 5. Resource category filtering

- `AssetRecord` has no category field. This UI therefore keeps the formal
  catalog's `全部` view and does not invent categories or change snapshot or
  unlock rules.
- **Status:** `CATEGORY_SOURCE_NOT_AVAILABLE`.

## Current completion boundary

The OQT selection projection is the only capability resolved in this branch.
Dirty tracking, Fabric control theming, Undo/Redo capability state, and
category filtering remain explicit follow-up gaps. No private Fabric state,
DOM inference, or frozen Contracts were used to bridge them.
