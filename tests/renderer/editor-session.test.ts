import { describe, expect, it } from 'vitest'
import type { AssetAccessState, AssetRecord, SceneDocument } from '../../src/shared/contracts'
import { EditorSessionService, type EditorSessionAdapter } from '../../src/renderer/src/editor'
import type { FabricEditorAssetResolver, SceneImportResult, SceneRecoveryIssue } from '../../src/renderer/src/editor'
import { cloneFixture, validAccess, validAsset, validScene } from '../shared/contracts.fixtures'

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
    return `object-${this.nextObjectId}`
  }

  deleteObject(objectId: string): void {
    this.ensureReady()
    this.issues = this.issues.filter((issue) => issue.objectId !== objectId)
  }

  bringForward(_objectId: string): void { this.ensureReady() }
  sendBackward(_objectId: string): void { this.ensureReady() }
  bringToFront(_objectId: string): void { this.ensureReady() }
  sendToBack(_objectId: string): void { this.ensureReady() }

  async undo(): Promise<boolean> {
    this.ensureReady()
    return this.undoResult
  }

  async redo(): Promise<boolean> {
    this.ensureReady()
    return this.redoResult
  }

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
  it('moves idle → loading → ready and exposes subscription snapshots', async () => {
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
})
