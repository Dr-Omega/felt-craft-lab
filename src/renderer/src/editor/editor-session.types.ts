import type {
  AssetAccessState,
  AssetRecord,
  PersonalAssetRecord,
  PersonalAssetVersionRecord,
  SceneDocument
} from '@shared/contracts'
import type { FabricEditorAssetResolver, SceneImportResult, SceneRecoveryIssue } from './fabric-editor-adapter'
import type { EditorSelectionListener } from './editor-selection.types'
import type { EditorHistoryListener, EditorHistoryProjection } from './editor-history.types'

export type EditorSessionStatus = 'idle' | 'loading' | 'ready' | 'recovery' | 'disposed'

export interface EditorSessionState {
  status: EditorSessionStatus
  sceneId?: string
  pendingOperations: number
  recoveryIssues: readonly SceneRecoveryIssue[]
  canEdit: boolean
  isDirty: boolean
  canUndo: boolean
  canRedo: boolean
  canPrepareDraft: boolean
  canPrepareProject: boolean
}

export type EditorSessionListener = (state: EditorSessionState) => void

/**
 * The deliberately small adapter surface used by the session layer. Keeping
 * this interface here prevents Vue/application code from retaining Fabric
 * objects or depending on adapter implementation details.
 */
export interface EditorSessionAdapter {
  initialize(element: HTMLCanvasElement, scene: SceneDocument): void
  importScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<SceneImportResult>
  setBackground(asset: AssetRecord | null, access?: AssetAccessState): Promise<void>
  setPersonalBackground(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void>
  setCorePattern(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void>
  clearCorePattern(): void
  setSolidBackground(color: string): void
  setTransparentBackground(): void
  resizeCanvas(width: number, height: number): void
  addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number }): Promise<string>
  addPersonalElement(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord, position?: { left: number; top: number }): Promise<string>
  deleteObject(objectId: string): void
  deleteSelected(): void
  bringForward(objectId: string): void
  sendBackward(objectId: string): void
  bringToFront(objectId: string): void
  sendToBack(objectId: string): void
  bringSelectedForward(): void
  sendSelectedBackward(): void
  bringSelectedToFront(): void
  sendSelectedToBack(): void
  undo(): Promise<boolean>
  redo(): Promise<boolean>
  getHistoryProjection(): EditorHistoryProjection
  subscribeHistory(listener: EditorHistoryListener): () => void
  exportScene(): SceneDocument
  exportPng(): Promise<Blob>
  getRecoveryIssues(): readonly SceneRecoveryIssue[]
  subscribeSelection(listener: EditorSelectionListener): () => void
  dispose(): void
}

export type EditorSessionAdapterFactory = () => EditorSessionAdapter

export interface EditorSessionServiceOptions {
  createAdapter: EditorSessionAdapterFactory
}

export interface PreparedProjectSave {
  scene: SceneDocument
  previewPng: Blob
}
