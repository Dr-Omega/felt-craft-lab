import { describe, expect, it } from 'vitest'
import type { AssetRecord, SceneDocument } from '../../src/shared/contracts'
import {
  FABRIC_EDITOR_HISTORY_LIMIT,
  FabricEditorAdapter,
  type FabricCanvasPort,
  type FabricEditorRuntime,
  type FabricObjectPort
} from '../../src/renderer/src/editor/fabric-editor-adapter'
import { cloneFixture, validAccess, validAsset, validScene, validSnapshotContext } from '../shared/contracts.fixtures'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value)
    }
  }
}

class FakeObject implements FabricObjectPort {
  objectId?: string
  assetId?: string
  assetType?: 'sticker'
  left?: number
  top?: number
  scaleX?: number
  scaleY?: number
  angle?: number
  visible?: boolean
  selectable?: boolean
  evented?: boolean
  lockMovementX?: boolean
  lockMovementY?: boolean
  lockScalingX?: boolean
  lockScalingY?: boolean
  lockUniScaling?: boolean
  lockRotation?: boolean

  constructor(options: Record<string, unknown>) {
    this.set(options)
  }

  set(options: Record<string, unknown>): void {
    Object.assign(this, options)
  }

  setCoords(): void {}
}

class FakeCanvas implements FabricCanvasPort {
  backgroundImage: FabricObjectPort | null = null
  backgroundColor: string | undefined
  readonly objects: FabricObjectPort[] = []
  readonly listeners = new Map<string, Array<(event: { target?: FabricObjectPort }) => void>>()
  activeObject: FabricObjectPort | null = null
  disposed = false
  private width: number
  private height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  add(...objects: FabricObjectPort[]): void {
    this.objects.push(...objects)
  }

  remove(...objects: FabricObjectPort[]): void {
    for (const object of objects) {
      const index = this.objects.indexOf(object)
      if (index >= 0) this.objects.splice(index, 1)
    }
  }

  getObjects(): FabricObjectPort[] {
    return [...this.objects]
  }

  getWidth(): number {
    return this.width
  }

  getHeight(): number {
    return this.height
  }

  setWidth(width: number): void {
    this.width = width
  }

  setHeight(height: number): void {
    this.height = height
  }

  setBackgroundImage(image: FabricObjectPort | null, callback: () => void): void {
    this.backgroundImage = image
    callback()
  }

  setActiveObject(object: FabricObjectPort): void {
    this.activeObject = object
  }

  getActiveObject(): FabricObjectPort | null {
    return this.activeObject
  }

  discardActiveObject(): void {
    this.activeObject = null
  }

  moveTo(object: FabricObjectPort, index: number): void {
    this.remove(object)
    this.objects.splice(index, 0, object)
  }

  bringForward(object: FabricObjectPort): void {
    const index = this.objects.indexOf(object)
    if (index >= 0 && index < this.objects.length - 1) this.moveTo(object, index + 1)
  }

  sendBackwards(object: FabricObjectPort): void {
    const index = this.objects.indexOf(object)
    if (index > 0) this.moveTo(object, index - 1)
  }

  bringToFront(object: FabricObjectPort): void {
    this.moveTo(object, this.objects.length - 1)
  }

  sendToBack(object: FabricObjectPort): void {
    this.moveTo(object, 0)
  }

  on(eventName: string, listener: (event: { target?: FabricObjectPort }) => void): void {
    this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener])
  }

  off(eventName: string, listener?: (event: { target?: FabricObjectPort }) => void): void {
    if (!listener) {
      this.listeners.delete(eventName)
      return
    }
    this.listeners.set(eventName, (this.listeners.get(eventName) ?? []).filter((candidate) => candidate !== listener))
  }

  requestRenderAll(): void {}

  toDataURL(): string {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7ZQAAAABJRU5ErkJggg=='
  }

  dispose(): void {
    this.disposed = true
  }

  emit(eventName: string, target?: FabricObjectPort): void {
    for (const listener of this.listeners.get(eventName) ?? []) listener({ target })
  }
}

function materialAsset(type: AssetRecord['type']): AssetRecord {
  return {
    ...cloneFixture(validAsset),
    assetId: type === 'background' ? 'background_moon_001' : validAsset.assetId,
    type,
    thumbnailUrl: undefined,
    preSplitDataUrl: undefined,
    imageUrl: type === 'background'
      ? 'felt-resource://material/mock-background.png'
      : 'felt-resource://material/mock-sticker.png'
  }
}

function createHarness(scene = cloneFixture(validScene), unavailableRefs = new Set<string>()): {
  adapter: FabricEditorAdapter
  canvas: FakeCanvas
  loadedRefs: string[]
  released: string[]
} {
  const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
  const loadedRefs: string[] = []
  const released: string[] = []
  const runtime: FabricEditorRuntime = {
    createCanvas: () => canvas,
    createImage: async (_sourceUrl, options) => new FakeObject(options),
    createPlaceholder: (options) => new FakeObject(options)
  }
  const adapter = new FabricEditorAdapter({
    snapshotContext: validSnapshotContext,
    allowTestAssets: true,
    runtime,
    now: () => new Date('2026-08-01T08:00:00.000Z'),
    createObjectId: () => 'c2d775d8-e6f8-439a-9d04-0934cb03f81f',
    loadResource: async (ref) => {
      if (unavailableRefs.has(ref)) throw new Error('resource missing')
      loadedRefs.push(ref)
      return { sourceUrl: `blob:test/${loadedRefs.length}`, dispose: () => released.push(ref) }
    }
  })
  adapter.initialize({} as HTMLCanvasElement, scene)
  return { adapter, canvas, loadedRefs, released }
}

function resolver(): { resolveAsset(assetId: string): Promise<AssetRecord> } {
  const sticker = materialAsset('sticker')
  const background = materialAsset('background')
  return {
    async resolveAsset(assetId: string): Promise<AssetRecord> {
      if (assetId === background.assetId) return background
      if (assetId === sticker.assetId) return sticker
      throw new Error('not found')
    }
  }
}

describe('FabricEditorAdapter', () => {
  it('blocks editing and export after initialize until a Scene import succeeds', async () => {
    const { adapter } = createHarness()

    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => adapter.resizeCanvas(1024, 768)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    await expect(adapter.addSticker(materialAsset('sticker'), validAccess))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await expect(adapter.importScene(cloneFixture(validScene), resolver())).resolves.toMatchObject({ issues: [] })
    expect(() => adapter.exportScene()).not.toThrow()
  })

  it('maps SceneDocument to Fabric and back without putting the background in objects', async () => {
    const scene = cloneFixture(validScene)
    const { adapter, canvas, loadedRefs } = createHarness(scene)

    await adapter.importScene(scene, resolver())
    const exported = adapter.exportScene()

    expect(loadedRefs).toEqual([
      'felt-resource://material/mock-background.png',
      'felt-resource://material/mock-sticker.png'
    ])
    expect(canvas.backgroundImage?.assetId).toBe('background_moon_001')
    expect(canvas.backgroundImage?.selectable).toBe(false)
    expect(canvas.getObjects()).toHaveLength(1)
    expect(exported.backgroundAssetId).toBe(scene.backgroundAssetId)
    expect(exported.objects).toEqual(scene.objects)
    expect(JSON.stringify(exported)).not.toContain('blob:')
    expect(JSON.stringify(exported)).not.toMatch(/[A-Za-z]:\\/)
  })

  it('keeps zIndex continuous and enforces uniform scale plus normalized angle', async () => {
    const { adapter, canvas } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const secondId = await adapter.addSticker(materialAsset('sticker'), validAccess, { left: 600, top: 320 })
    const second = canvas.getObjects().find((object) => object.objectId === secondId)
    if (!second) throw new Error('test sticker missing')

    second.set({ scaleX: 0.6, scaleY: 0.9, angle: 540 })
    canvas.emit('object:scaling', second)
    canvas.emit('object:rotating', second)
    canvas.emit('object:modified', second)
    adapter.sendToBack(secondId)

    const exported = adapter.exportScene()
    expect(exported.objects.map((object) => object.zIndex)).toEqual([1, 2])
    expect(exported.objects[0]).toMatchObject({ objectId: secondId, scaleX: 0.6, scaleY: 0.6, angle: -180 })
  })

  it('locks Fabric flip/skew controls and rejects unsupported transforms at serialization', async () => {
    const { adapter, canvas } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const imported = canvas.getObjects()[0]
    expect(imported).toMatchObject({ lockScalingFlip: true, lockSkewingX: true, lockSkewingY: true })

    const addedId = await adapter.addSticker(materialAsset('sticker'), validAccess)
    const added = canvas.getObjects().find((object) => object.objectId === addedId)
    if (!added) throw new Error('added sticker missing')
    expect(added).toMatchObject({ lockScalingFlip: true, lockSkewingX: true, lockSkewingY: true })

    added.set({ flipX: true })
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))
    added.set({ flipX: false, skewX: 12 })
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))
    added.set({ skewX: 0, skewY: 0 })
    expect(() => adapter.exportScene()).not.toThrow()

    const lockedScene = cloneFixture(validScene)
    lockedScene.objects[0].locked = true
    const lockedHarness = createHarness(lockedScene)
    await lockedHarness.adapter.importScene(lockedScene, resolver())
    expect(lockedHarness.canvas.getObjects()[0]).toMatchObject({
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true
    })

    const missingSticker = materialAsset('sticker')
    missingSticker.imageUrl = 'felt-resource://material/missing-transform.png'
    const placeholderHarness = createHarness(cloneFixture(validScene), new Set([missingSticker.imageUrl]))
    await placeholderHarness.adapter.importScene(cloneFixture(validScene), {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return missingSticker
        throw new Error('not found')
      }
    })
    expect(placeholderHarness.canvas.getObjects()[0]).toMatchObject({
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true
    })
  })

  it('supports undo and redo without using Fabric JSON', async () => {
    const { adapter } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    await adapter.addSticker(materialAsset('sticker'), validAccess)
    expect(adapter.exportScene().objects).toHaveLength(2)

    await expect(adapter.undo()).resolves.toBe(true)
    expect(adapter.exportScene().objects).toHaveLength(1)
    await expect(adapter.redo()).resolves.toBe(true)
    expect(adapter.exportScene().objects).toHaveLength(2)
  })

  it('exports a non-empty PNG and releases object URLs/listeners on dispose', async () => {
    const { adapter, canvas, released } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())

    const png = await adapter.exportPng()
    expect(png.size).toBeGreaterThan(0)
    expect(png.type).toBe('image/png')

    adapter.dispose()
    expect(released).toEqual(expect.arrayContaining([
      'felt-resource://material/mock-background.png',
      'felt-resource://material/mock-sticker.png'
    ]))
    expect(canvas.disposed).toBe(true)
    expect([...canvas.listeners.values()].flat()).toHaveLength(0)
  })

  it('does not silently replace an unavailable felt-resource material', async () => {
    const unavailable = materialAsset('sticker')
    unavailable.imageUrl = 'felt-resource://material/missing.png'
    const { adapter } = createHarness(cloneFixture(validScene), new Set([unavailable.imageUrl]))
    await adapter.importScene(cloneFixture(validScene), resolver())
    const access = { ...validAccess, assetId: unavailable.assetId }
    await expect(adapter.addSticker(unavailable, access)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(adapter.exportScene().objects).toHaveLength(1)
  })

  it('rejects newly added assets that are absent from the immutable scene snapshot before loading', async () => {
    const { adapter, loadedRefs } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const outsideSnapshot = materialAsset('sticker')
    outsideSnapshot.assetId = 'sticker_not_in_snapshot'
    const access = { ...validAccess, assetId: outsideSnapshot.assetId }

    await expect(adapter.addSticker(outsideSnapshot, access)).rejects.toMatchObject({ code: 'ASSET_SNAPSHOT_MISMATCH' })
    const outsideBackground = materialAsset('background')
    outsideBackground.assetId = 'background_not_in_snapshot'
    await expect(adapter.setBackground(outsideBackground, { ...validAccess, assetId: outsideBackground.assetId }))
      .rejects.toMatchObject({ code: 'ASSET_SNAPSHOT_MISMATCH' })
    expect(loadedRefs).toHaveLength(2)
  })

  it('reports a missing snapshot even when a restored Scene has no asset references', async () => {
    const emptyScene: SceneDocument = {
      ...cloneFixture(validScene),
      assetSnapshotId: 'missing_snapshot',
      backgroundAssetId: null,
      objects: []
    }
    const { adapter } = createHarness(emptyScene)
    const result = await adapter.importScene(emptyScene, resolver())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSET_SNAPSHOT_MISMATCH' })
    ]))
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))
  })

  it('restores missing historical resources as locked placeholders and blocks formal export', async () => {
    const unavailableSticker = materialAsset('sticker')
    unavailableSticker.imageUrl = 'felt-resource://material/missing.png'
    const { adapter, canvas } = createHarness(cloneFixture(validScene), new Set([unavailableSticker.imageUrl]))
    const importResult = await adapter.importScene(cloneFixture(validScene), {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return unavailableSticker
        throw new Error('not found')
      }
    })

    expect(importResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSET_NOT_FOUND', assetId: validAsset.assetId, assetType: 'sticker' })
    ]))
    expect(canvas.getObjects()[0]).toMatchObject({ objectId: validScene.objects[0].objectId, assetId: validAsset.assetId, selectable: false })
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))
  })

  it('allows explicit removal of a missing sticker and restores the recovery issue through undo/redo', async () => {
    const unavailableSticker = materialAsset('sticker')
    unavailableSticker.imageUrl = 'felt-resource://material/missing-sticker.png'
    const scene = cloneFixture(validScene)
    const { adapter, canvas } = createHarness(scene, new Set([unavailableSticker.imageUrl]))
    await adapter.importScene(scene, {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return unavailableSticker
        throw new Error('not found')
      }
    })

    expect(adapter.getRecoveryIssues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: validAsset.assetId, assetType: 'sticker' })
    ]))
    const placeholder = canvas.getObjects()[0]
    expect(placeholder.selectable).toBe(false)

    adapter.deleteObject(validScene.objects[0].objectId)
    expect(adapter.getRecoveryIssues()).toEqual([])
    expect(adapter.exportScene().objects).toEqual([])

    await expect(adapter.undo()).resolves.toBe(true)
    expect(adapter.getRecoveryIssues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: validAsset.assetId, assetType: 'sticker' })
    ]))
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))

    await expect(adapter.redo()).resolves.toBe(true)
    expect(adapter.getRecoveryIssues()).toEqual([])
    expect(adapter.exportScene().objects).toEqual([])
  })

  it('clears recovery issues by objectId when duplicate missing sticker instances share an assetId', async () => {
    const unavailableSticker = materialAsset('sticker')
    unavailableSticker.imageUrl = 'felt-resource://material/missing-duplicate.png'
    const scene = cloneFixture(validScene)
    scene.objects.push({
      ...scene.objects[0],
      objectId: '72d775d8-e6f8-439a-9d04-0934cb03f81f',
      left: 620,
      top: 360,
      zIndex: 2
    })
    const { adapter } = createHarness(scene, new Set([unavailableSticker.imageUrl]))
    await adapter.importScene(scene, {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return unavailableSticker
        throw new Error('not found')
      }
    })

    expect(adapter.getRecoveryIssues()).toHaveLength(2)
    expect(adapter.getRecoveryIssues().map((issue) => issue.objectId)).toEqual([
      scene.objects[0].objectId,
      scene.objects[1].objectId
    ])

    adapter.deleteObject(scene.objects[0].objectId)
    expect(adapter.getRecoveryIssues()).toHaveLength(1)
    expect(adapter.getRecoveryIssues()[0].objectId).toBe(scene.objects[1].objectId)
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))

    adapter.deleteObject(scene.objects[1].objectId)
    expect(adapter.getRecoveryIssues()).toEqual([])
    expect(adapter.exportScene().objects).toEqual([])
  })

  it('allows explicit background recovery by replacement or clearing and preserves it through undo/redo', async () => {
    const unavailableBackground = materialAsset('background')
    unavailableBackground.imageUrl = 'felt-resource://material/missing-background.png'
    const scene = cloneFixture(validScene)
    const { adapter } = createHarness(scene, new Set([unavailableBackground.imageUrl]))
    await adapter.importScene(scene, {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return unavailableBackground
        if (assetId === validAsset.assetId) return materialAsset('sticker')
        throw new Error('not found')
      }
    })

    expect(adapter.getRecoveryIssues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'background_moon_001', assetType: 'background' })
    ]))
    await adapter.setBackground(materialAsset('background'), {
      ...validAccess,
      assetId: 'background_moon_001'
    })
    expect(adapter.getRecoveryIssues()).toEqual([])
    expect(() => adapter.exportScene()).not.toThrow()

    const secondImport = cloneFixture(validScene)
    await adapter.importScene(secondImport, {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return unavailableBackground
        if (assetId === validAsset.assetId) return materialAsset('sticker')
        throw new Error('not found')
      }
    })
    await adapter.setBackground(null)
    expect(adapter.getRecoveryIssues()).toEqual([])
    expect(adapter.exportScene().backgroundAssetId).toBeNull()

    await expect(adapter.undo()).resolves.toBe(true)
    expect(adapter.getRecoveryIssues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'background_moon_001', assetType: 'background' })
    ]))
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))

    await expect(adapter.redo()).resolves.toBe(true)
    expect(adapter.getRecoveryIssues()).toEqual([])
    expect(adapter.exportScene().backgroundAssetId).toBeNull()
  })

  it('rejects invalid dimensions and colors before mutating the canvas', async () => {
    const { adapter, canvas } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())

    expect(() => adapter.resizeCanvas(320.5, 240)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(canvas.getWidth()).toBe(validScene.canvas.width)
    expect(() => adapter.setSolidBackground('url(https://example.invalid/background.png)')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(canvas.backgroundColor).toBe(validScene.canvas.backgroundColor)
  })

  it('allows concurrent sticker loads and does not cancel them on an invalid sync edit', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    const pendingLoads: Array<ReturnType<typeof deferred<{ sourceUrl: string; dispose(): void }>>> = []
    let blockLoads = false
    let objectIdIndex = 0
    const objectIds = [
      'a2d775d8-e6f8-439a-9d04-0934cb03f81f',
      'b2d775d8-e6f8-439a-9d04-0934cb03f81f'
    ]
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => new FakeObject(options)
      },
      createObjectId: () => objectIds[objectIdIndex++],
      loadResource: async (ref) => {
        if (blockLoads) {
          const pending = deferred<{ sourceUrl: string; dispose(): void }>()
          pendingLoads.push(pending)
          return pending.promise
        }
        return { sourceUrl: `blob:${ref}`, dispose: () => undefined }
      }
    })
    adapter.initialize({} as HTMLCanvasElement, scene)
    await adapter.importScene(scene, resolver())
    blockLoads = true

    const first = adapter.addSticker(materialAsset('sticker'), validAccess, { left: 200, top: 200 })
    const second = adapter.addSticker(materialAsset('sticker'), validAccess, { left: 300, top: 300 })
    await Promise.resolve()
    await Promise.resolve()
    expect(pendingLoads).toHaveLength(2)

    expect(() => adapter.resizeCanvas(320.5, 240)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const pending of pendingLoads) pending.resolve({ sourceUrl: 'blob:sticker', dispose: () => undefined })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(adapter.exportScene().objects).toHaveLength(3)
  })

  it('keeps the committed resolver and history after a failed import', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    let placeholderFailure = false
    let resolverACalls = 0
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => {
          if (placeholderFailure) throw new Error('placeholder failure')
          return new FakeObject(options)
        }
      },
      createObjectId: (() => {
        let index = 0
        const ids = ['a3d775d8-e6f8-439a-9d04-0934cb03f81f']
        return () => ids[index++] ?? 'b3d775d8-e6f8-439a-9d04-0934cb03f81f'
      })(),
      loadResource: async (ref) => ({ sourceUrl: `blob:${ref}`, dispose: () => undefined })
    })
    const resolverA = {
      async resolveAsset(assetId: string): Promise<AssetRecord> {
        resolverACalls += 1
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return materialAsset('sticker')
        throw new Error('not found')
      }
    }
    adapter.initialize({} as HTMLCanvasElement, scene)
    await adapter.importScene(scene, resolverA)
    await adapter.addSticker(materialAsset('sticker'), validAccess)
    const callsBeforeFailure = resolverACalls

    placeholderFailure = true
    await expect(adapter.importScene(scene, {
      async resolveAsset(): Promise<AssetRecord> {
        throw new Error('new resolver must not be committed')
      }
    })).rejects.toThrow('placeholder failure')
    expect(adapter.exportScene().objects).toHaveLength(2)

    placeholderFailure = false
    await expect(adapter.undo()).resolves.toBe(true)
    expect(resolverACalls).toBeGreaterThan(callsBeforeFailure)
    expect(adapter.exportScene().objects).toHaveLength(1)
  })

  it('keeps the committed resolver and history when a superseded import is cancelled', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    const pendingSticker = deferred<AssetRecord>()
    let placeholderFailure = false
    let resolverACalls = 0
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => {
          if (placeholderFailure) throw new Error('placeholder failure')
          return new FakeObject(options)
        }
      },
      createObjectId: () => 'a4d775d8-e6f8-439a-9d04-0934cb03f81f',
      loadResource: async (ref) => ({ sourceUrl: `blob:${ref}`, dispose: () => undefined })
    })
    const resolverA = {
      async resolveAsset(assetId: string): Promise<AssetRecord> {
        resolverACalls += 1
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return materialAsset('sticker')
        throw new Error('not found')
      }
    }
    adapter.initialize({} as HTMLCanvasElement, scene)
    await adapter.importScene(scene, resolverA)
    await adapter.addSticker(materialAsset('sticker'), validAccess)
    const callsBeforeCancellation = resolverACalls

    const staleImport = adapter.importScene(scene, {
      async resolveAsset(assetId: string): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        return pendingSticker.promise
      }
    })
    await Promise.resolve()
    await Promise.resolve()

    placeholderFailure = true
    const failedReplacement = adapter.importScene(scene, {
      async resolveAsset(): Promise<AssetRecord> {
        throw new Error('replacement failed')
      }
    })
    await expect(failedReplacement).rejects.toThrow('placeholder failure')

    placeholderFailure = false
    pendingSticker.resolve(materialAsset('sticker'))
    await expect(staleImport).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(adapter.exportScene().objects).toHaveLength(2)

    await expect(adapter.undo()).resolves.toBe(true)
    expect(resolverACalls).toBeGreaterThan(callsBeforeCancellation)
    expect(adapter.exportScene().objects).toHaveLength(1)
  })

  it('cancels stale imports and releases a loaded resource after dispose', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    const pending = deferred<{ sourceUrl: string; dispose(): void }>()
    const released: string[] = []
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => new FakeObject(options)
      },
      loadResource: () => pending.promise
    })
    adapter.initialize({} as HTMLCanvasElement, scene)
    const importing = adapter.importScene(scene, resolver())
    adapter.dispose()
    pending.resolve({ sourceUrl: 'blob:stale', dispose: () => released.push('blob:stale') })

    await expect(importing).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(released).toEqual(['blob:stale'])
    expect(canvas.getObjects()).toHaveLength(0)
  })

  it('keeps the newest import when a previous import resolves later', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    const firstResource = deferred<{ sourceUrl: string; dispose(): void }>()
    const released: string[] = []
    let loadCount = 0
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => new FakeObject(options)
      },
      loadResource: async () => {
        loadCount += 1
        if (loadCount === 1) return firstResource.promise
        return { sourceUrl: `blob:current/${loadCount}`, dispose: () => released.push(`current/${loadCount}`) }
      }
    })
    adapter.initialize({} as HTMLCanvasElement, scene)
    const firstImport = adapter.importScene(scene, resolver())
    await Promise.resolve()

    await expect(adapter.importScene(scene, resolver())).resolves.toMatchObject({ issues: [] })
    firstResource.resolve({ sourceUrl: 'blob:stale', dispose: () => released.push('stale') })

    await expect(firstImport).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(released).toContain('stale')
    expect(adapter.exportScene().objects).toHaveLength(1)
  })

  it('caps history, truncates redo after a new edit, and atomically rolls back failed undo', async () => {
    const { adapter } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    for (let index = 1; index <= 105; index += 1) adapter.resizeCanvas(1200 + index, 800)

    let undoCount = 0
    while (await adapter.undo()) undoCount += 1
    expect(undoCount).toBe(FABRIC_EDITOR_HISTORY_LIMIT - 1)
    expect(adapter.exportScene().canvas.width).toBe(1206)
    expect(await adapter.undo()).toBe(false)

    adapter.resizeCanvas(2048, 800)
    expect(await adapter.redo()).toBe(false)

    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    let failRecovery = false
    const resolverState = { fail: false }
    const failingAdapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => {
          if (failRecovery) throw new Error('history recovery failure')
          return new FakeObject(options)
        }
      },
      createObjectId: () => 'c3d775d8-e6f8-439a-9d04-0934cb03f81f',
      loadResource: async (ref) => ({ sourceUrl: `blob:${ref}`, dispose: () => undefined })
    })
    const mutableResolver = {
      async resolveAsset(assetId: string): Promise<AssetRecord> {
        if (resolverState.fail) throw new Error('history asset unavailable')
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return materialAsset('sticker')
        throw new Error('not found')
      }
    }
    failingAdapter.initialize({} as HTMLCanvasElement, scene)
    await failingAdapter.importScene(scene, mutableResolver)
    await failingAdapter.addSticker(materialAsset('sticker'), validAccess)
    resolverState.fail = true
    failRecovery = true
    await expect(failingAdapter.undo()).rejects.toThrow('history recovery failure')
    expect(failingAdapter.exportScene().objects).toHaveLength(2)
    resolverState.fail = false
    failRecovery = false
    await expect(failingAdapter.undo()).resolves.toBe(true)
    expect(failingAdapter.exportScene().objects).toHaveLength(1)
  })
})
