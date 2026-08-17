export {
  FabricEditorAdapter,
  V46_FABRIC_CONTROL_THEME,
  applyFabricControlTheme,
  normalizeSceneAngle
} from './fabric-editor-adapter'
export type {
  FabricCanvasPort,
  FabricEditorAdapterOptions,
  FabricEditorAssetResolver,
  FabricEditorRuntime,
  FabricObjectPort,
  LoadedResource,
  SceneObjectKind,
  SceneImportResult,
  SceneRecoveryIssue
} from './fabric-editor-adapter'
export type { EditorHistoryListener, EditorHistoryProjection } from './editor-history.types'
export { EditorSessionService } from './editor-session.service'
export type {
  EditorSelectionBounds,
  EditorSelectionEvent,
  EditorSelectionListener,
  EditorSelectionProjection
} from './editor-selection.types'
export type {
  EditorSessionAdapter,
  EditorSessionAdapterFactory,
  EditorSessionListener,
  EditorSessionServiceOptions,
  EditorSessionState,
  EditorSessionStatus,
  PreparedProjectSave
} from './editor-session.types'
