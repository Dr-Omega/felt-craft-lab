import { toSharedError, validateSceneDocument } from '@shared/contracts'
import type {
  AssetAccessState,
  AssetRecord,
  PersonalAssetRecord,
  PersonalAssetVersionRecord,
  SceneDocument,
  SharedError,
  SharedErrorCode
} from '@shared/contracts'
import type { FabricEditorAssetResolver, SceneImportResult, SceneRecoveryIssue } from './fabric-editor-adapter'
import type {
  EditorSessionAdapter,
  EditorSessionAdapterFactory,
  EditorSessionListener,
  EditorSessionServiceOptions,
  EditorSessionState,
  EditorSessionStatus,
  PreparedProjectSave
} from './editor-session.types'
import type { EditorSelectionListener } from './editor-selection.types'
import type { EditorHistoryProjection } from './editor-history.types'

function sessionError(code: SharedErrorCode, message: string): SharedError {
  return { code, message, retryable: false }
}

function normalizedError(error: unknown, fallbackCode: SharedErrorCode): SharedError {
  return toSharedError(error, fallbackCode)
}

function isActiveStatus(status: EditorSessionStatus): boolean {
  return status === 'ready' || status === 'recovery'
}

/**
 * Application orchestration around FabricEditorAdapter. SceneDocument remains
 * the only persistence boundary; this service owns lifecycle, save gates, and
 * subscriptions but never stores Fabric JSON or a second scene model.
 */
export class EditorSessionService {
  private readonly createAdapter: EditorSessionAdapterFactory
  private readonly listeners = new Set<EditorSessionListener>()
  private readonly selectionSubscriptions = new Set<() => void>()
  private readonly pendingTokens = new Set<symbol>()
  private adapter: EditorSessionAdapter | undefined
  private historyUnsubscribe: (() => void) | undefined
  private status: EditorSessionStatus = 'idle'
  private sceneId: string | undefined
  private recoveryIssues: SceneRecoveryIssue[] = []
  private sceneTransitionGeneration = 0
  private currentHistoryRevision: number | undefined
  private savedHistoryRevision: number | undefined
  private historyCanUndo = false
  private historyCanRedo = false

  constructor(options: EditorSessionServiceOptions | EditorSessionAdapterFactory) {
    this.createAdapter = typeof options === 'function' ? options : options.createAdapter
  }

  getState(): EditorSessionState {
    const canEdit = isActiveStatus(this.status)
    const canPrepare = this.status === 'ready' && this.pendingTokens.size === 0 && this.recoveryIssues.length === 0
    const isDirty = canEdit
      && this.currentHistoryRevision !== undefined
      && this.currentHistoryRevision !== this.savedHistoryRevision
    return {
      status: this.status,
      ...(this.sceneId === undefined ? {} : { sceneId: this.sceneId }),
      pendingOperations: this.pendingTokens.size,
      recoveryIssues: this.recoveryIssues.map((issue) => ({ ...issue })),
      canEdit,
      isDirty,
      canUndo: canEdit && this.historyCanUndo,
      canRedo: canEdit && this.historyCanRedo,
      canPrepareDraft: canPrepare,
      canPrepareProject: canPrepare
    }
  }

  subscribe(listener: EditorSessionListener): () => void {
    this.listeners.add(listener)
    try {
      listener(this.getState())
    } catch {
      // A view subscriber must not break the session lifecycle.
    }
    return () => this.listeners.delete(listener)
  }

  async open(element: HTMLCanvasElement, scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<SceneImportResult> {
    if (this.status !== 'idle') {
      throw sessionError('INVALID_ARGUMENT', 'Editor session is already open.')
    }

    const transition = ++this.sceneTransitionGeneration
    this.status = 'loading'
    this.sceneId = undefined
    this.recoveryIssues = []
    this.resetHistoryProjection()
    this.savedHistoryRevision = undefined
    let adapter: EditorSessionAdapter | undefined
    let token: symbol | undefined
    try {
      adapter = this.createAdapter()
      this.adapter = adapter
      token = this.beginPending()
      if (transition !== this.sceneTransitionGeneration || this.status !== 'loading' || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Editor session open was superseded.')
      }
      adapter.initialize(element, scene)
      const importResult = await adapter.importScene(scene, resolver)
      if (transition !== this.sceneTransitionGeneration || this.status !== 'loading' || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Editor session open was superseded.')
      }
      this.sceneId = scene.sceneId
      this.attachHistory(adapter)
      this.syncHistoryProjection(adapter.getHistoryProjection(), false)
      this.syncRecoveryState(adapter, false)
      if (transition !== this.sceneTransitionGeneration || !isActiveStatus(this.status) || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Editor session open was superseded.')
      }
      this.emit()
      return this.withCommittedRecoveryIssues(importResult)
    } catch (error) {
      if (adapter) {
        if (this.adapter === adapter) {
          this.historyUnsubscribe?.()
          this.historyUnsubscribe = undefined
        }
        if (this.adapter === adapter) this.adapter = undefined
        try { adapter.dispose() } catch { /* preserve the normalized failure */ }
      }
      if (transition === this.sceneTransitionGeneration && this.status === 'loading') {
        this.status = 'idle'
        this.sceneId = undefined
        this.recoveryIssues = []
        this.resetHistoryProjection()
        this.savedHistoryRevision = undefined
        this.emit()
      }
      throw normalizedError(error, 'SCENE_IMPORT_FAILED')
    } finally {
      if (token) this.endPending(token)
    }
  }

  async loadScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<SceneImportResult> {
    if (this.status === 'disposed') throw sessionError('INVALID_ARGUMENT', 'Editor session is disposed.')
    const adapter = this.requireAdapter('SCENE_IMPORT_FAILED')
    if (!isActiveStatus(this.status)) throw sessionError('INVALID_ARGUMENT', 'Editor session is not ready to load a Scene.')

    const transition = ++this.sceneTransitionGeneration
    this.status = 'loading'
    const token = this.beginPending()
    try {
      const importResult = await adapter.importScene(scene, resolver)
      if (transition !== this.sceneTransitionGeneration || this.status !== 'loading' || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Scene load was superseded.')
      }
      this.sceneId = scene.sceneId
      this.savedHistoryRevision = undefined
      this.syncHistoryProjection(adapter.getHistoryProjection(), false)
      this.syncRecoveryState(adapter, false)
      if (transition !== this.sceneTransitionGeneration || !isActiveStatus(this.status) || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Scene load was superseded.')
      }
      this.emit()
      return this.withCommittedRecoveryIssues(importResult)
    } catch (error) {
      if (transition === this.sceneTransitionGeneration && this.adapter === adapter) {
        this.syncRecoveryState(adapter)
      }
      throw normalizedError(error, 'SCENE_IMPORT_FAILED')
    } finally {
      this.endPending(token)
    }
  }

  async setBackground(asset: AssetRecord | null, access?: AssetAccessState): Promise<void> {
    await this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setBackground(asset, access))
  }

  async setPersonalBackground(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void> {
    await this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setPersonalBackground(asset, version))
  }

  async setCorePattern(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void> {
    await this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setCorePattern(asset, version))
  }

  clearCorePattern(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().clearCorePattern())
  }

  setSolidBackground(color: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setSolidBackground(color))
  }

  setTransparentBackground(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setTransparentBackground())
  }

  resizeCanvas(width: number, height: number): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().resizeCanvas(width, height))
  }

  async addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number; fitBox?: { width: number; height: number } }): Promise<string> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().addSticker(asset, access, position))
  }

  async addPersonalElement(
    asset: PersonalAssetRecord,
    version: PersonalAssetVersionRecord,
    position?: { left: number; top: number }
  ): Promise<string> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().addPersonalElement(asset, version, position))
  }

  deleteObject(objectId: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().deleteObject(objectId))
  }

  deleteSelected(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().deleteSelected())
  }

  bringForward(objectId: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().bringForward(objectId))
  }

  sendBackward(objectId: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().sendBackward(objectId))
  }

  bringToFront(objectId: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().bringToFront(objectId))
  }

  sendToBack(objectId: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().sendToBack(objectId))
  }

  bringSelectedForward(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().bringSelectedForward())
  }

  sendSelectedBackward(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().sendSelectedBackward())
  }

  bringSelectedToFront(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().bringSelectedToFront())
  }

  sendSelectedToBack(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().sendSelectedToBack())
  }

  async undo(): Promise<boolean> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().undo())
  }

  async redo(): Promise<boolean> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().redo())
  }

  /** Marks the current runtime history entry as persisted by an outer layer. */
  markSaved(): void {
    this.requireAdapter('INVALID_ARGUMENT')
    if (!isActiveStatus(this.status) || this.currentHistoryRevision === undefined) {
      throw sessionError('INVALID_ARGUMENT', 'Editor session has no current history entry.')
    }
    this.savedHistoryRevision = this.currentHistoryRevision
    this.emit()
  }

  getRecoveryIssues(): readonly SceneRecoveryIssue[] {
    return this.recoveryIssues.map((issue) => ({ ...issue }))
  }

  selectObject(objectId: string): void {
    const adapter = this.requireAdapter('INVALID_ARGUMENT')
    if (this.status !== 'ready' || this.pendingTokens.size > 0 || !adapter.selectObject) {
      throw sessionError('INVALID_ARGUMENT', 'Editor session is not ready to select an element.')
    }
    adapter.selectObject(objectId)
  }

  subscribeSelection(listener: EditorSelectionListener): () => void {
    const adapter = this.requireAdapter('INVALID_ARGUMENT')
    if (!isActiveStatus(this.status)) {
      throw sessionError('INVALID_ARGUMENT', 'Editor session is not ready for selection subscriptions.')
    }

    const safeListener: EditorSelectionListener = (event) => {
      try { listener(event) } catch { /* view listeners cannot break the session boundary */ }
    }
    const adapterUnsubscribe = adapter.subscribeSelection(safeListener)
    let active = true
    const unsubscribe = (): void => {
      if (!active) return
      active = false
      this.selectionSubscriptions.delete(unsubscribe)
      try { adapterUnsubscribe() } catch { /* unsubscribe is intentionally idempotent */ }
    }
    this.selectionSubscriptions.add(unsubscribe)
    return unsubscribe
  }

  prepareDraftSave(): SceneDocument {
    const adapter = this.requireSaveAdapter('DRAFT_SAVE_FAILED')
    try {
      const scene = adapter.exportScene()
      const validation = validateSceneDocument(scene)
      if (!validation.ok) throw sessionError('DRAFT_SAVE_FAILED', 'Scene failed runtime validation for draft save.')
      return validation.value
    } catch (error) {
      throw normalizedError(error, 'DRAFT_SAVE_FAILED')
    }
  }

  async previewElementImage(objectId: string, png: string): Promise<void> {
    const adapter = this.requireAdapter('INVALID_ARGUMENT')
    if (!adapter.previewElementImage) throw new Error('当前编辑器不支持原位换色预览。')
    await adapter.previewElementImage(objectId, png)
  }

  clearElementPreview(): void { this.adapter?.clearElementPreview?.() }

  async replaceElementImage(objectId: string, asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void> {
    await this.runAsyncMutation('INVALID_ARGUMENT', async () => {
      const adapter = this.requireAdapter()
      if (!adapter.replaceElementImage) throw new Error('当前编辑器不支持保存图层换色。')
      await adapter.replaceElementImage(objectId, asset, version)
    })
  }

  async prepareProjectSave(objectId?: string): Promise<PreparedProjectSave> {
    const adapter = this.requireSaveAdapter('PROJECT_SAVE_FAILED')
    try {
      // Both exports are captured synchronously before exportPng's first await,
      // so the Scene and preview describe one stable Canvas state.
      const scene = adapter.exportScene()
      const validation = validateSceneDocument(scene)
      if (!validation.ok) throw sessionError('PROJECT_SAVE_FAILED', 'Scene failed runtime validation for project save.')
      if (objectId !== undefined && ![...scene.objects, ...scene.personalElements, ...(scene.corePattern ? [scene.corePattern] : [])]
        .some(item => item.objectId === objectId && item.visible)) throw new Error('Selected element is unavailable')
      const previewPng = await adapter.exportPng(objectId)
      if (!previewPng || typeof previewPng.size !== 'number') {
        throw sessionError('PROJECT_SAVE_FAILED', 'PNG preview export did not return a Blob.')
      }
      return { scene: validation.value, previewPng }
    } catch (error) {
      throw normalizedError(error, 'PROJECT_SAVE_FAILED')
    }
  }

  dispose(): void {
    ++this.sceneTransitionGeneration
    for (const unsubscribe of [...this.selectionSubscriptions]) unsubscribe()
    this.selectionSubscriptions.clear()
    this.historyUnsubscribe?.()
    this.historyUnsubscribe = undefined
    const adapter = this.adapter
    this.adapter = undefined
    this.pendingTokens.clear()
    try { adapter?.dispose() } catch { /* disposal errors must not escape the session boundary */ }
    this.status = 'disposed'
    this.sceneId = undefined
    this.recoveryIssues = []
    this.resetHistoryProjection()
    this.savedHistoryRevision = undefined
    this.emit()
  }

  private async runAsyncMutation<T>(fallbackCode: SharedErrorCode, task: () => Promise<T>): Promise<T> {
    this.requireEditable()
    const token = this.beginPending()
    try {
      const result = await task()
      this.syncRecoveryState(this.requireAdapter())
      return result
    } catch (error) {
      this.trySyncRecoveryState()
      throw normalizedError(error, fallbackCode)
    } finally {
      this.endPending(token)
    }
  }

  private runSyncMutation(fallbackCode: SharedErrorCode, task: () => void): void {
    this.requireEditable()
    try {
      task()
      this.syncRecoveryState(this.requireAdapter())
    } catch (error) {
      this.trySyncRecoveryState()
      throw normalizedError(error, fallbackCode)
    }
  }

  private requireAdapter(fallbackCode: SharedErrorCode = 'INVALID_ARGUMENT'): EditorSessionAdapter {
    if (!this.adapter) throw sessionError(fallbackCode, 'Editor session is not open.')
    return this.adapter
  }

  private requireEditable(): void {
    if (!isActiveStatus(this.status)) throw sessionError('INVALID_ARGUMENT', 'Editor session is not editable.')
  }

  private requireSaveAdapter(fallbackCode: 'DRAFT_SAVE_FAILED' | 'PROJECT_SAVE_FAILED'): EditorSessionAdapter {
    if (!this.adapter || this.status !== 'ready' || this.pendingTokens.size !== 0 || this.recoveryIssues.length !== 0) {
      throw sessionError(fallbackCode, 'Scene is not ready for saving.')
    }
    return this.adapter
  }

  private attachHistory(adapter: EditorSessionAdapter): void {
    this.historyUnsubscribe?.()
    this.historyUnsubscribe = adapter.subscribeHistory((projection) => {
      this.syncHistoryProjection(projection, this.status !== 'loading')
    })
  }

  private syncHistoryProjection(projection: EditorHistoryProjection, emit = true): void {
    if (
      !projection
      || typeof projection.revision !== 'number'
      || !Number.isFinite(projection.revision)
      || typeof projection.canUndo !== 'boolean'
      || typeof projection.canRedo !== 'boolean'
    ) {
      throw sessionError('UNKNOWN', 'Adapter returned invalid history projection.')
    }
    this.currentHistoryRevision = projection.revision
    this.historyCanUndo = projection.canUndo
    this.historyCanRedo = projection.canRedo
    if (emit && this.status !== 'loading') this.emit()
  }

  private resetHistoryProjection(): void {
    this.currentHistoryRevision = undefined
    this.historyCanUndo = false
    this.historyCanRedo = false
  }

  private syncRecoveryState(adapter: EditorSessionAdapter, emit = true): void {
    let rawIssues: readonly SceneRecoveryIssue[]
    try {
      rawIssues = adapter.getRecoveryIssues()
      if (!Array.isArray(rawIssues)) throw new Error('Adapter returned invalid recovery issues.')
    } catch (error) {
      throw normalizedError(error, 'UNKNOWN')
    }
    const issues = rawIssues.map((issue) => ({ ...issue }))
    this.recoveryIssues = issues
    this.status = issues.length > 0 ? 'recovery' : 'ready'
    if (emit) this.emit()
  }

  private withCommittedRecoveryIssues(result: SceneImportResult): SceneImportResult {
    return {
      ...result,
      issues: this.recoveryIssues.map((issue) => ({ ...issue }))
    }
  }

  private trySyncRecoveryState(): void {
    if (!this.adapter || this.status === 'idle' || this.status === 'disposed' || this.status === 'loading') return
    try { this.syncRecoveryState(this.adapter) } catch { /* keep the last safe state */ }
  }

  private beginPending(): symbol {
    const token = Symbol('editor-session-operation')
    this.pendingTokens.add(token)
    this.emit()
    return token
  }

  private endPending(token: symbol): void {
    if (this.pendingTokens.delete(token)) this.emit()
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      try { listener(state) } catch { /* subscribers are outside the session boundary */ }
    }
  }
}

