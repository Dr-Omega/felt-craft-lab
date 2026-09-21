import { describe, expect, it } from 'vitest'
import type { AssetAccessState, AssetRecord, SceneDocument } from '../../src/shared/contracts'
import { EditorSessionService, type EditorSessionAdapter } from '../../src/renderer/src/editor'
import type { FabricEditorAssetResolver, SceneImportResult, SceneRecoveryIssue } from '../../src/renderer/src/editor'
import type { EditorSelectionEvent, EditorSelectionListener } from '../../src/renderer/src/editor'
import type { EditorHistoryListener, EditorHistoryProjection } from '../../src/renderer/src/editor'
import { cloneFixture, validAccess, validAsset, validRendererScene as validScene } from '../shared/contracts.fixtures'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((error: unknown) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve(value) { resolvePromise?.(value) },
    reject(error) { rejectPromise?.(error) }
  }
}

const sceneB = (): SceneDocument => ({
  ...cloneFixture(validScene),
  sceneId: '8a3435d2-2c2f-4df1-a38c-5b7e32ce91a8'
})

class StubAdapter implements EditorSessionAdapter {
  initialized = false
  disposed = false
  ready = false
  scene: SceneDocument | undefined
  issues: SceneRecoveryIssue[] = []
  importFailure: unknown
  importIssues: SceneRecoveryIssue[] | undefined
  importGate: { promise: Promise<void> } | undefined
  addGates: Array<{ promise: Promise<void>; resolve(): void }> = []
  addFailure: unknown
  pngFailure: unknown
  pngSceneId: string | undefined
  undoResult = false
  redoResult = false
  selectedObjectId: string | undefined
  deletedObjectIds: string[] = []
  layerOps: Array<{ op: string; objectId: string }> = []
  private readonly selectionListeners = new Set<EditorSelectionListener>()
  private readonly historyListeners = new Set<EditorHistoryListener>()
  private historyProjection: EditorHistoryProjection = { revision: 0, canUndo: false, canRedo: false }
  private nextObjectId = 0

  initialize(_element: HTMLCanvasElement, scene: SceneDocument): void {
    if (this.importFailure === 'INITIALIZE') throw new Error('DOM initialization failure')
    this.initialized = true
    this.scene = cloneFixture(scene)
    this.ready = false
  }

  async importScene(scene: SceneDocument, _resolver: FabricEditorAssetResolver): Promise<SceneImportResult> {
    if (this.importGate) await this.importGate.promise
    if (this.importFailure && this.importFailure !== 'INITIALIZE') {
      const failure = this.importFailure
      this.importFailure = undefined
      throw failure
    }
    this.scene = cloneFixture(scene)
    this.ready = true
    this.issues = [...(this.importIssues ?? this.issues)]
    this.historyProjection = { revision: this.historyProjection.revision + 1, canUndo: false, canRedo: false }
    this.emitHistory()
    return { issues: [...this.issues] }
  }

  async setBackground(_asset: AssetRecord | null, _access?: AssetAccessState): Promise<void> {
    this.ensureReady()
    this.issues = []
  }

  setSolidBackground(_color: string): void {
    this.ensureReady()
    this.issues = []
  }

  setTransparentBackground(): void {
    this.ensureReady()
    this.issues = []
  }

  resizeCanvas(width: number, height: number): void {
    this.ensureReady()
    if (!this.scene) throw new Error('missing scene')
    this.scene.canvas = { ...this.scene.canvas, width, height }
  }

  async addSticker(_asset: AssetRecord, _access: AssetAccessState): Promise<string> {
    this.ensureReady()
    if (this.addFailure) {
      const failure = this.addFailure
      this.addFailure = undefined
      throw failure
    }
    const gate = this.addGates.shift()
    if (gate) await gate.promise
    this.nextObjectId += 1
    this.historyProjection = { revision: this.historyProjection.revision + 1, canUndo: true, canRedo: false }
    this.emitHistory()
    return `object-${this.nextObjectId}`
  }

  deleteObject(objectId: string): void {
    this.ensureReady()
    this.deletedObjectIds.push(objectId)
    this.issues = this.issues.filter((issue) => issue.objectId !== objectId)
  }

  deleteSelected(): void {
    this.ensureReady()
    if (!this.selectedObjectId) return
    this.deleteObject(this.selectedObjectId)
  }

  bringForward(objectId: string): void {
    this.ensureReady()
    this.layerOps.push({ op: 'bringForward', objectId })
  }

  sendBackward(objectId: string): void {
    this.ensureReady()
    this.layerOps.push({ op: 'sendBackward', objectId })
  }

  bringToFront(objectId: string): void {
    this.ensureReady()
    this.layerOps.push({ op: 'bringToFront', objectId })
  }

  sendToBack(objectId: string): void {
    this.ensureReady()
    this.layerOps.push({ op: 'sendToBack', objectId })
  }

  bringSelectedForward(): void {
    this.ensureReady()
    if (!this.selectedObjectId) return
    this.bringForward(this.selectedObjectId)
  }

  sendSelectedBackward(): void {
    this.ensureReady()
    if (!this.selectedObjectId) return
    this.sendBackward(this.selectedObjectId)
  }

  bringSelectedToFront(): void {
    this.ensureReady()
    if (!this.selectedObjectId) return
    this.bringToFront(this.selectedObjectId)
  }

  sendSelectedToBack(): void {
    this.ensureReady()
    if (!this.selectedObjectId) return
    this.sendToBack(this.selectedObjectId)
  }

  async undo(): Promise<boolean> {
    this.ensureReady()
    return this.undoResult
  }

  async redo(): Promise<boolean> {
    this.ensureReady()
    return this.redoResult
  }

  getHistoryProjection(): EditorHistoryProjection {
    return { ...this.historyProjection }
  }

  subscribeHistory(listener: EditorHistoryListener): () => void {
    this.historyListeners.add(listener)
    return () => this.historyListeners.delete(listener)
  }

  markSaved(): void {}

  exportScene(): SceneDocument {
    this.ensureReady()
    if (!this.scene) throw new Error('missing scene')
    return cloneFixture(this.scene)
  }

  async exportPng(): Promise<Blob> {
    this.ensureReady()
    if (this.pngFailure) throw this.pngFailure
    this.pngSceneId = this.scene?.sceneId
    return new Blob(['png'], { type: 'image/png' })
  }

  getRecoveryIssues(): readonly SceneRecoveryIssue[] {
    return this.issues.map((issue) => ({ ...issue }))
  }

  subscribeSelection(listener: EditorSelectionListener): () => void {
    this.selectionListeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.selectionListeners.delete(listener)
    }
  }

  emitSelection(event: EditorSelectionEvent): void {
    for (const listener of this.selectionListeners) {
      try { listener(event) } catch { /* adapter isolates view listeners */ }
    }
  }

  emitHistory(): void {
    for (const listener of this.historyListeners) listener({ ...this.historyProjection })
  }

  setHistoryProjection(projection: EditorHistoryProjection): void {
    this.historyProjection = { ...projection }
    this.emitHistory()
  }

  dispose(): void {
    this.disposed = true
    this.ready = false
  }

  private ensureReady(): void {
    if (!this.ready || this.disposed) throw new Error('adapter is not ready')
  }
}

function createSession(adapter: StubAdapter): EditorSessionService {
  return new EditorSessionService({ createAdapter: () => adapter })
}

function resolver(): FabricEditorAssetResolver {
  return { resolveAsset: async () => cloneFixture(validAsset) }
}

function stickerAccess(): AssetAccessState {
  return cloneFixture(validAccess)
}

describe('EditorSessionService', () => {
  it('projects NEW dirty state from history identity and keeps prepare side-effect free', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    expect(service.getState()).toMatchObject({ isDirty: true, canUndo: false, canRedo: false })
    service.markSaved()
    expect(service.getState()).toMatchObject({ isDirty: false })

    await service.addSticker(cloneFixture(validAsset), stickerAccess())
    expect(service.getState()).toMatchObject({ isDirty: true, canUndo: true, canRedo: false })
    service.prepareDraftSave()
    await service.prepareProjectSave()
    expect(service.getState().isDirty).toBe(true)

    adapter.setHistoryProjection({ revision: 3, canUndo: false, canRedo: true })
    expect(service.getState()).toMatchObject({ isDirty: true, canUndo: false, canRedo: true })
  })

  it('marks a persisted revision clean without clearing redo capability', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    await service.addSticker(cloneFixture(validAsset), stickerAccess())
    service.markSaved()
    expect(service.getState()).toMatchObject({ isDirty: false, canUndo: true, canRedo: false })

    adapter.setHistoryProjection({ revision: 1, canUndo: false, canRedo: true })
    expect(service.getState()).toMatchObject({ isDirty: true, canUndo: false, canRedo: true })
  })

  it('moves idle 鈫?loading 鈫?ready and exposes subscription snapshots', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    const statuses: string[] = []
    const unsubscribe = service.subscribe((state) => statuses.push(state.status))

    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    expect(statuses).toContain('idle')
    expect(statuses).toContain('loading')
    expect(service.getState()).toMatchObject({ status: 'ready', sceneId: validScene.sceneId, canEdit: true })
    unsubscribe()
    const countAfterUnsubscribe = statuses.length
    service.resizeCanvas(640, 480)
    expect(statuses).toHaveLength(countAfterUnsubscribe)
  })

  it('returns the committed import result for normal and recovery opens and scene loads', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)

    const opened = await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    expect(opened).toEqual({ issues: [] })

    const recoveryIssue: SceneRecoveryIssue = {
      code: 'ASSET_NOT_FOUND',
      message: 'missing sticker',
      assetId: validAsset.assetId,
      assetType: 'sticker',
      objectId: 'c2d775d8-e6f8-439a-9d04-0934cb03f81f'
    }
    service.dispose()

    const recoveryAdapter = new StubAdapter()
    recoveryAdapter.importIssues = [recoveryIssue]
    const recoveryService = createSession(recoveryAdapter)
    const recovered = await recoveryService.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    expect(recovered.issues).toEqual([recoveryIssue])
    expect(recoveryService.getRecoveryIssues()).toEqual([recoveryIssue])
    expect(recoveryService.getState().status).toBe('recovery')

    recoveryAdapter.importIssues = []
    const loaded = await recoveryService.loadScene(cloneFixture(validScene), resolver())
    expect(loaded).toEqual({ issues: [] })
    expect(recoveryService.getRecoveryIssues()).toEqual([])
    expect(recoveryService.getState().status).toBe('ready')
  })

  it('cancels a reentrant open from a loading subscriber and disposes the adapter', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    service.subscribe((state) => {
      if (state.status === 'loading') service.dispose()
    })

    await expect(service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver()))
      .rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(adapter.disposed).toBe(true)
    expect(service.getState()).toMatchObject({ status: 'disposed', pendingOperations: 0 })
    await expect(service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver()))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('keeps disposed as a terminal state and rejects every session operation', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    service.dispose()

    await expect(service.loadScene(sceneB(), resolver())).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.setBackground(null)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => service.setSolidBackground('#ffffff')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.setTransparentBackground()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.resizeCanvas(640, 480)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    await expect(service.addSticker(cloneFixture(validAsset), stickerAccess()))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => service.deleteObject('object-1')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.deleteSelected()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.bringForward('object-1')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.sendBackward('object-1')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.bringToFront('object-1')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.sendToBack('object-1')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.bringSelectedForward()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.sendSelectedBackward()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.bringSelectedToFront()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.sendSelectedToBack()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    await expect(service.undo()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.redo()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => service.prepareDraftSave()).toThrow(expect.objectContaining({ code: 'DRAFT_SAVE_FAILED' }))
    await expect(service.prepareProjectSave()).rejects.toMatchObject({ code: 'PROJECT_SAVE_FAILED' })
    await expect(service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver()))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('does not emit when a subscriber reads the recovery getter', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    const notifications: string[] = []
    let getterReads = 0
    const unsubscribe = service.subscribe((state) => {
      notifications.push(state.status)
      if (state.status === 'ready') {
        getterReads += 1
        expect(service.getRecoveryIssues()).toEqual([])
      }
    })
    const countAfterSubscribe = notifications.length

    expect(service.getRecoveryIssues()).toEqual([])
    expect(notifications).toHaveLength(countAfterSubscribe)
    expect(getterReads).toBe(1)
    unsubscribe()
  })

  it('cleans up a first-open failure and does not leave a half-initialized session', async () => {
    const adapter = new StubAdapter()
    adapter.importFailure = new Error('import failed')
    const service = createSession(adapter)

    await expect(service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver()))
      .rejects.toMatchObject({ code: 'SCENE_IMPORT_FAILED' })
    expect(adapter.disposed).toBe(true)
    expect(service.getState()).toMatchObject({ status: 'idle', pendingOperations: 0, canEdit: false })
  })

  it('also cleans up when Canvas initialization itself fails', async () => {
    const adapter = new StubAdapter()
    adapter.importFailure = 'INITIALIZE'
    const service = createSession(adapter)

    await expect(service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver()))
      .rejects.toMatchObject({ code: 'SCENE_IMPORT_FAILED' })
    expect(adapter.disposed).toBe(true)
    expect(service.getState().status).toBe('idle')
  })

  it('keeps Scene A usable when Scene B fails to load', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    adapter.importFailure = new Error('Scene B unavailable')

    await expect(service.loadScene(sceneB(), resolver())).rejects.toMatchObject({ code: 'SCENE_IMPORT_FAILED' })
    expect(service.getState()).toMatchObject({ status: 'ready', sceneId: validScene.sceneId })
    expect(service.prepareDraftSave().sceneId).toBe(validScene.sceneId)
  })

  it('commits a successful Scene switch and updates the session identity', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    await service.loadScene(sceneB(), resolver())

    expect(service.getState()).toMatchObject({ status: 'ready', sceneId: sceneB().sceneId })
    expect(service.prepareDraftSave().sceneId).toBe(sceneB().sceneId)
  })

  it('enters recovery, keeps editing enabled, and returns to ready after resolution', async () => {
    const adapter = new StubAdapter()
    adapter.importIssues = [{
      code: 'ASSET_NOT_FOUND',
      message: 'missing sticker',
      assetId: validAsset.assetId,
      assetType: 'sticker',
      objectId: 'c2d775d8-e6f8-439a-9d04-0934cb03f81f'
    }]
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    expect(service.getState()).toMatchObject({ status: 'recovery', canEdit: true, canPrepareDraft: false, canPrepareProject: false })
    await expect(Promise.resolve().then(() => service.prepareDraftSave())).rejects.toMatchObject({ code: 'DRAFT_SAVE_FAILED' })
    service.deleteObject('c2d775d8-e6f8-439a-9d04-0934cb03f81f')
    expect(service.getState()).toMatchObject({ status: 'ready', canEdit: true, canPrepareDraft: true, canPrepareProject: true })
  })

  it('refreshes recovery state after background resolution', async () => {
    const adapter = new StubAdapter()
    adapter.importIssues = [{ code: 'ASSET_NOT_FOUND', message: 'missing background', assetType: 'background', assetId: 'background_moon_001' }]
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    await service.setBackground(null)
    expect(service.getRecoveryIssues()).toHaveLength(0)
    expect(service.getState().status).toBe('ready')
  })

  it('uses pendingOperations as a save gate without serializing concurrent sticker additions', async () => {
    const adapter = new StubAdapter()
    const first = deferred<void>()
    const second = deferred<void>()
    adapter.addGates = [first, second]
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    const addOne = service.addSticker(cloneFixture(validAsset), stickerAccess())
    const addTwo = service.addSticker(cloneFixture(validAsset), stickerAccess())
    expect(service.getState().pendingOperations).toBe(2)
    expect(() => service.prepareDraftSave()).toThrow(expect.objectContaining({ code: 'DRAFT_SAVE_FAILED' }))
    await expect(service.prepareProjectSave()).rejects.toMatchObject({ code: 'PROJECT_SAVE_FAILED' })
    first.resolve()
    second.resolve()
    await expect(Promise.all([addOne, addTwo])).resolves.toHaveLength(2)
    expect(service.getState().pendingOperations).toBe(0)
    expect(service.getState().canPrepareDraft).toBe(true)
  })

  it('delegates undo and redo and prepares validated Scene plus PNG from one Canvas state', async () => {
    const adapter = new StubAdapter()
    adapter.undoResult = true
    adapter.redoResult = true
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    await expect(service.undo()).resolves.toBe(true)
    await expect(service.redo()).resolves.toBe(true)
    const draft = service.prepareDraftSave()
    const project = await service.prepareProjectSave()
    expect(draft.sceneId).toBe(validScene.sceneId)
    expect(project.scene.sceneId).toBe(validScene.sceneId)
    expect(project.previewPng.size).toBeGreaterThan(0)
    expect(adapter.pngSceneId).toBe(project.scene.sceneId)
  })

  it('prepares a canonical square Scene without changing its logical dimensions', async () => {
    const adapter = new StubAdapter()
    const scene = cloneFixture(validScene)
    scene.canvas = { width: 960, height: 960, backgroundColor: '#FFF8E7' }
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, scene, resolver())

    expect(service.prepareDraftSave().canvas).toEqual(scene.canvas)
    const prepared = await service.prepareProjectSave()
    expect(prepared.scene.canvas).toEqual(scene.canvas)
    expect(prepared.previewPng.type).toBe('image/png')
  })

  it('deletes the selected object and no-ops when nothing is selected', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    expect(() => service.deleteSelected()).not.toThrow()
    expect(adapter.deletedObjectIds).toEqual([])

    adapter.selectedObjectId = 'object-selected'
    service.deleteSelected()
    expect(adapter.deletedObjectIds).toEqual(['object-selected'])
  })

  it('applies selected layer ops when a selection exists and no-ops otherwise', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    expect(() => service.bringSelectedForward()).not.toThrow()
    expect(() => service.sendSelectedBackward()).not.toThrow()
    expect(() => service.bringSelectedToFront()).not.toThrow()
    expect(() => service.sendSelectedToBack()).not.toThrow()
    expect(adapter.layerOps).toEqual([])

    adapter.selectedObjectId = 'object-layer'
    service.bringSelectedForward()
    service.sendSelectedBackward()
    service.bringSelectedToFront()
    service.sendSelectedToBack()
    expect(adapter.layerOps).toEqual([
      { op: 'bringForward', objectId: 'object-layer' },
      { op: 'sendBackward', objectId: 'object-layer' },
      { op: 'bringToFront', objectId: 'object-layer' },
      { op: 'sendToBack', objectId: 'object-layer' }
    ])
  })

  it('rejects selected-object mutations after dispose with controlled lifecycle errors', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    adapter.selectedObjectId = 'object-1'
    service.dispose()

    expect(() => service.deleteSelected()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.bringSelectedForward()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.sendSelectedBackward()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.bringSelectedToFront()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => service.sendSelectedToBack()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('rejects saves while recovery exists or an operation is pending', async () => {
    const adapter = new StubAdapter()
    adapter.importIssues = [{ code: 'ASSET_NOT_FOUND', message: 'missing', assetType: 'sticker', assetId: validAsset.assetId }]
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    await expect(service.prepareProjectSave()).rejects.toMatchObject({ code: 'PROJECT_SAVE_FAILED' })
  })

  it('normalizes adapter and lifecycle failures and rejects calls after dispose', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())
    adapter.addFailure = new DOMException('third-party failure', 'OperationError')
    await expect(service.addSticker(cloneFixture(validAsset), stickerAccess()))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    service.dispose()
    expect(service.getState()).toMatchObject({ status: 'disposed', pendingOperations: 0, canEdit: false })
    await expect(service.addSticker(cloneFixture(validAsset), stickerAccess()))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => service.resizeCanvas(1, 1)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('forwards read-only selection projections and cleans subscriptions on unsubscribe/dispose', async () => {
    const adapter = new StubAdapter()
    const service = createSession(adapter)
    await service.open({} as HTMLCanvasElement, cloneFixture(validScene), resolver())

    const events: EditorSelectionEvent[] = []
    const unsubscribe = service.subscribeSelection((event) => events.push(event))
    const selected: EditorSelectionEvent = {
      type: 'selected',
      selection: { objectId: 'object-42', bounds: { left: 10, top: 12, width: 40, height: 30 } }
    }
    adapter.emitSelection(selected)
    expect(events).toEqual([selected])
    unsubscribe()
    adapter.emitSelection({ type: 'cleared', selection: null })
    expect(events).toEqual([selected])

    const second = service.subscribeSelection(() => { throw new Error('view listener failure') })
    expect(() => adapter.emitSelection(selected)).not.toThrow()
    service.dispose()
    second()
    expect(() => service.subscribeSelection(() => undefined)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    adapter.emitSelection(selected)
    expect(events).toEqual([selected])
  })

  it('rejects selection subscription before open', () => {
    const service = createSession(new StubAdapter())
    expect(() => service.subscribeSelection(() => undefined))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })
})

