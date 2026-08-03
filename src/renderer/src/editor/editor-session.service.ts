import { toSharedError, validateSceneDocument } from '@shared/contracts'
import type { AssetAccessState, AssetRecord, SceneDocument, SharedError, SharedErrorCode } from '@shared/contracts'
import type { FabricEditorAssetResolver, SceneRecoveryIssue } from './fabric-editor-adapter'
import type {
  EditorSessionAdapter,
  EditorSessionAdapterFactory,
  EditorSessionListener,
  EditorSessionServiceOptions,
  EditorSessionState,
  EditorSessionStatus,
  PreparedProjectSave
} from './editor-session.types'

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
  private readonly pendingTokens = new Set<symbol>()
  private adapter: EditorSessionAdapter | undefined
  private status: EditorSessionStatus = 'idle'
  private sceneId: string | undefined
  private recoveryIssues: SceneRecoveryIssue[] = []
  private sceneTransitionGeneration = 0

  constructor(options: EditorSessionServiceOptions | EditorSessionAdapterFactory) {
    this.createAdapter = typeof options === 'function' ? options : options.createAdapter
  }

  getState(): EditorSessionState {
    const canEdit = isActiveStatus(this.status)
    const canPrepare = this.status === 'ready' && this.pendingTokens.size === 0 && this.recoveryIssues.length === 0
    return {
      status: this.status,
      ...(this.sceneId === undefined ? {} : { sceneId: this.sceneId }),
      pendingOperations: this.pendingTokens.size,
      recoveryIssues: this.recoveryIssues.map((issue) => ({ ...issue })),
      canEdit,
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

  async open(element: HTMLCanvasElement, scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'disposed') {
      throw sessionError('INVALID_ARGUMENT', 'Editor session is already open.')
    }

    const transition = ++this.sceneTransitionGeneration
    this.status = 'loading'
    this.sceneId = undefined
    this.recoveryIssues = []
    const token = this.beginPending()

    let adapter: EditorSessionAdapter | undefined
    try {
      adapter = this.createAdapter()
      this.adapter = adapter
      adapter.initialize(element, scene)
      await adapter.importScene(scene, resolver)
      if (transition !== this.sceneTransitionGeneration || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Editor session open was superseded.')
      }
      this.sceneId = scene.sceneId
      this.syncRecoveryState(adapter)
    } catch (error) {
      if (transition === this.sceneTransitionGeneration) {
        try { adapter?.dispose() } catch { /* preserve the normalized failure */ }
        if (this.adapter === adapter) this.adapter = undefined
        this.status = 'idle'
        this.sceneId = undefined
        this.recoveryIssues = []
        this.emit()
      }
      throw normalizedError(error, 'SCENE_IMPORT_FAILED')
    } finally {
      this.endPending(token)
    }
  }

  async loadScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<void> {
    const adapter = this.requireAdapter('SCENE_IMPORT_FAILED')
    if (!isActiveStatus(this.status)) throw sessionError('INVALID_ARGUMENT', 'Editor session is not ready to load a Scene.')

    const transition = ++this.sceneTransitionGeneration
    this.status = 'loading'
    const token = this.beginPending()
    try {
      await adapter.importScene(scene, resolver)
      if (transition !== this.sceneTransitionGeneration || this.adapter !== adapter) {
        throw sessionError('REQUEST_CANCELLED', 'Scene load was superseded.')
      }
      this.sceneId = scene.sceneId
      this.syncRecoveryState(adapter)
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

  setSolidBackground(color: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setSolidBackground(color))
  }

  setTransparentBackground(): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().setTransparentBackground())
  }

  resizeCanvas(width: number, height: number): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().resizeCanvas(width, height))
  }

  async addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number }): Promise<string> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().addSticker(asset, access, position))
  }

  deleteObject(objectId: string): void {
    this.runSyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().deleteObject(objectId))
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

  async undo(): Promise<boolean> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().undo())
  }

  async redo(): Promise<boolean> {
    return this.runAsyncMutation('INVALID_ARGUMENT', () => this.requireAdapter().redo())
  }

  getRecoveryIssues(): readonly SceneRecoveryIssue[] {
    if (!this.adapter || this.status === 'idle' || this.status === 'disposed' || this.status === 'loading') {
      return this.recoveryIssues.map((issue) => ({ ...issue }))
    }
    try {
      this.syncRecoveryState(this.adapter)
    } catch (error) {
      throw normalizedError(error, 'UNKNOWN')
    }
    return this.recoveryIssues.map((issue) => ({ ...issue }))
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

  async prepareProjectSave(): Promise<PreparedProjectSave> {
    const adapter = this.requireSaveAdapter('PROJECT_SAVE_FAILED')
    try {
      // Both exports are captured synchronously before exportPng's first await,
      // so the Scene and preview describe one stable Canvas state.
      const scene = adapter.exportScene()
      const validation = validateSceneDocument(scene)
      if (!validation.ok) throw sessionError('PROJECT_SAVE_FAILED', 'Scene failed runtime validation for project save.')
      const previewPng = await adapter.exportPng()
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
    const adapter = this.adapter
    this.adapter = undefined
    this.pendingTokens.clear()
    try { adapter?.dispose() } catch { /* disposal errors must not escape the session boundary */ }
    this.status = 'disposed'
    this.sceneId = undefined
    this.recoveryIssues = []
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

  private syncRecoveryState(adapter: EditorSessionAdapter): void {
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
    this.emit()
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
