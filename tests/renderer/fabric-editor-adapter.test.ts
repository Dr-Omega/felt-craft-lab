import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AssetRecord, SceneDocument } from '../../src/shared/contracts'
import {
  FABRIC_EDITOR_HISTORY_LIMIT,
  FabricEditorAdapter,
  applyFabricControlTheme,
  STICKER_ROTATION_CONTROL_OFFSET,
  STICKER_SAFE_EDGE_MARGIN,
  calculateStickerInitialScale,
  validateFabricFromURLResult,
  type FabricCanvasPort,
  type FabricEditorRuntime,
  type FabricObjectPort
} from '../../src/renderer/src/editor/fabric-editor-adapter'
import type { EditorSelectionEvent } from '../../src/renderer/src/editor/editor-selection.types'
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
  width?: number
  height?: number
  visible?: boolean
  selectable?: boolean
  evented?: boolean
  lockMovementX?: boolean
  lockMovementY?: boolean
  lockScalingX?: boolean
  lockScalingY?: boolean
  lockUniScaling?: boolean
  lockScalingFlip?: boolean
  lockSkewingX?: boolean
  lockSkewingY?: boolean
  lockRotation?: boolean
  flipX?: boolean
  flipY?: boolean
  skewX?: number
  skewY?: number
  controls?: Record<string, {
    offsetX?: number
    offsetY?: number
    withConnection?: boolean
    sizeX?: number
    sizeY?: number
    touchSizeX?: number
    touchSizeY?: number
  }>

  constructor(options: Record<string, unknown>) {
    this.width = 100
    this.height = 100
    this.set(options)
  }

  set(options: Record<string, unknown>): void {
    Object.assign(this, options)
  }

  setCoords(): void {}

  getBoundingRect(): { left: number; top: number; width: number; height: number } {
    const width = Math.abs((this.width ?? 0) * (this.scaleX ?? 1))
    const height = Math.abs((this.height ?? 0) * (this.scaleY ?? 1))
    return {
      left: (this.left ?? 0) - width / 2,
      top: (this.top ?? 0) - height / 2,
      width,
      height
    }
  }
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

  calcOffset(): void {}

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
  const snapshotId = validScene.assetSnapshotId
  return {
    ...cloneFixture(validAsset),
    assetId: type === 'background' ? 'background_moon_001' : validAsset.assetId,
    type,
    thumbnailUrl: undefined,
    preSplitDataUrl: undefined,
    imageUrl: type === 'background'
      ? `felt-resource://material/${snapshotId}/mock-background.png`
      : `felt-resource://material/${snapshotId}/mock-sticker.png`
  }
}

function createHarness(
  scene = cloneFixture(validScene),
  unavailableRefs = new Set<string>(),
  imageDimensions?: { width: number; height: number }
): {
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
    createImage: async (_sourceUrl, options) => new FakeObject({ ...options, ...imageDimensions }),
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

describe('new Sticker initial scale', () => {
  it('fits an 885×802 Sticker into the medium 960×960 creation box with reachable controls', () => {
    const canvasWidth = 960
    const canvasHeight = 960
    const scale = calculateStickerInitialScale(canvasWidth, canvasHeight, 885, 802)
    const displayWidth = 885 * scale
    const displayHeight = 802 * scale
    const mtrY = canvasHeight / 2 - displayHeight / 2 - STICKER_ROTATION_CONTROL_OFFSET

    expect(scale).toBeCloseTo(480 / 885)
    expect(scale).toBeLessThan(1)
    expect(displayWidth).toBeLessThanOrEqual(480)
    expect(displayHeight).toBeLessThanOrEqual(480)
    expect(mtrY).toBeGreaterThanOrEqual(STICKER_SAFE_EDGE_MARGIN)
  })

  it('fits a 790×471 wide Sticker by the medium creation width', () => {
    const scale = calculateStickerInitialScale(960, 960, 790, 471)

    expect(scale).toBeCloseTo(480 / 790)
    expect(790 * scale).toBeLessThanOrEqual(480)
    expect(471 * scale).toBeLessThanOrEqual(480)
  })

  it('does not enlarge a small Sticker', () => {
    expect(calculateStickerInitialScale(960, 960, 200, 150)).toBe(1)
  })

  it('uses the medium creation height for an extra-tall Sticker', () => {
    const scale = calculateStickerInitialScale(960, 960, 300, 1000)
    expect(scale).toBeCloseTo(480 / 1000)
  })

  it('uses the medium creation width for an extra-wide Sticker', () => {
    const scale = calculateStickerInitialScale(960, 960, 1600, 100)
    expect(scale).toBeCloseTo(480 / 1600)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid image dimensions: %s', (dimension) => {
    expect(() => calculateStickerInitialScale(960, 960, dimension, 100))
      .toThrow(expect.objectContaining({ code: 'ASSET_NOT_FOUND' }))
    expect(() => calculateStickerInitialScale(960, 960, 100, dimension))
      .toThrow(expect.objectContaining({ code: 'ASSET_NOT_FOUND' }))
  })
})

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
      `felt-resource://material/${validScene.assetSnapshotId}/mock-background.png`,
      `felt-resource://material/${validScene.assetSnapshotId}/mock-sticker.png`
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

  it('persists the centered medium initial transform for a default new Sticker', async () => {
    const scene = cloneFixture(validScene)
    scene.canvas = { width: 960, height: 960, backgroundColor: '#FFF8E7' }
    scene.backgroundAssetId = null
    scene.objects = []
    const { adapter, canvas } = createHarness(scene, new Set(), { width: 885, height: 802 })
    await adapter.importScene(scene, resolver())

    const objectId = await adapter.addSticker(materialAsset('sticker'), validAccess)
    const expectedScale = calculateStickerInitialScale(960, 960, 885, 802)
    const object = canvas.getObjects().find((candidate) => candidate.objectId === objectId)
    const exported = adapter.exportScene().objects[0]

    expect(object).toMatchObject({ left: 480, top: 480, scaleX: expectedScale, scaleY: expectedScale, angle: 0 })
    expect(exported).toMatchObject({ objectId, left: 480, top: 480, scaleX: expectedScale, scaleY: expectedScale, angle: 0 })
  })

  it('keeps an explicit Sticker position on the existing scale=1 path', async () => {
    const scene = cloneFixture(validScene)
    scene.backgroundAssetId = null
    scene.objects = []
    const { adapter, canvas } = createHarness(scene, new Set(), { width: 885, height: 802 })
    await adapter.importScene(scene, resolver())

    const objectId = await adapter.addSticker(materialAsset('sticker'), validAccess, { left: 600, top: 320 })
    expect(canvas.getObjects().find((candidate) => candidate.objectId === objectId))
      .toMatchObject({ left: 600, top: 320, scaleX: 1, scaleY: 1, angle: 0 })
  })

  it('rejects invalid dimensions without adding a Sticker or leaking its loaded resource', async () => {
    const scene = cloneFixture(validScene)
    scene.backgroundAssetId = null
    scene.objects = []
    const { adapter, canvas, released } = createHarness(scene, new Set(), { width: 0, height: 802 })
    await adapter.importScene(scene, resolver())

    await expect(adapter.addSticker(materialAsset('sticker'), validAccess))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(canvas.getObjects()).toEqual([])
    expect(released).toContain(`felt-resource://material/${validScene.assetSnapshotId}/mock-sticker.png`)
  })

  it('does not recalculate the persisted transform for imported or history-restored Stickers', async () => {
    const scene = cloneFixture(validScene)
    scene.canvas = { width: 960, height: 960, backgroundColor: '#FFF8E7' }
    scene.backgroundAssetId = null
    scene.objects[0].scaleX = 0.72
    scene.objects[0].scaleY = 0.72
    const { adapter, canvas } = createHarness(scene, new Set(), { width: 885, height: 802 })
    await adapter.importScene(scene, resolver())

    expect(canvas.getObjects()[0]).toMatchObject({ scaleX: 0.72, scaleY: 0.72 })
    const addedId = await adapter.addSticker(materialAsset('sticker'), validAccess, { left: 700, top: 320 })
    await expect(adapter.undo()).resolves.toBe(true)
    expect(adapter.exportScene().objects).toEqual([expect.objectContaining({ scaleX: 0.72, scaleY: 0.72 })])
    await expect(adapter.redo()).resolves.toBe(true)
    expect(adapter.exportScene().objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ scaleX: 0.72, scaleY: 0.72 }),
      expect.objectContaining({ objectId: addedId, scaleX: 1, scaleY: 1 })
    ]))
  })

  it('locks Fabric flip/skew controls and rejects unsupported transforms at serialization', async () => {
    const { adapter, canvas } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const imported = canvas.getObjects()[0]
    expect(imported).toMatchObject({
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true,
      borderColor: '#E8A572',
      cornerColor: '#FFFFFF',
      cornerStyle: 'circle'
    })

    const addedId = await adapter.addSticker(materialAsset('sticker'), validAccess)
    const added = canvas.getObjects().find((object) => object.objectId === addedId)
    if (!added) throw new Error('added sticker missing')
    expect(added).toMatchObject({
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true,
      borderColor: '#E8A572',
      cornerColor: '#FFFFFF',
      cornerStyle: 'circle'
    })

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

  it('projects stable history capabilities with unique mutation revisions', async () => {
    const { adapter } = createHarness()
    const projections: Array<{ revision: number; canUndo: boolean; canRedo: boolean }> = []
    adapter.subscribeHistory((projection) => projections.push(projection))

    await adapter.importScene(cloneFixture(validScene), resolver())
    const imported = adapter.getHistoryProjection()
    expect(imported).toMatchObject({ canUndo: false, canRedo: false })

    await adapter.addSticker(materialAsset('sticker'), validAccess)
    const added = adapter.getHistoryProjection()
    expect(added.canUndo).toBe(true)
    expect(added.canRedo).toBe(false)
    expect(added.revision).not.toBe(imported.revision)

    await expect(adapter.undo()).resolves.toBe(true)
    const undone = adapter.getHistoryProjection()
    expect(undone).toMatchObject({ revision: imported.revision, canUndo: false, canRedo: true })

    await expect(adapter.redo()).resolves.toBe(true)
    const redone = adapter.getHistoryProjection()
    expect(redone).toEqual(added)

    await expect(adapter.undo()).resolves.toBe(true)
    await adapter.addSticker(materialAsset('sticker'), validAccess, { left: 700, top: 320 })
    const branched = adapter.getHistoryProjection()
    expect(branched.canRedo).toBe(false)
    expect(branched.revision).not.toBe(added.revision)
    expect(new Set(projections.map((projection) => projection.revision)).size)
      .toBeGreaterThanOrEqual(3)
  })

  it('applies the V4.6 control theme through public object and Control properties', () => {
    const controls: Record<string, { offsetY?: number; withConnection?: boolean; sizeX?: number; sizeY?: number; touchSizeX?: number; touchSizeY?: number }> = {}
    for (const key of ['tl', 'mt', 'tr', 'ml', 'mr', 'bl', 'mb', 'br', 'mtr']) controls[key] = {}
    const object = new FakeObject({ controls })

    applyFabricControlTheme(object)

    expect(object).toMatchObject({
      borderColor: '#E8A572',
      cornerColor: '#FFFFFF',
      cornerStrokeColor: '#E8A572',
      transparentCorners: false,
      cornerStyle: 'circle',
      cornerSize: 8,
      touchCornerSize: 24
    })
    expect(object.controls?.tl?.sizeX).toBeUndefined()
    expect(object.controls?.tl?.touchSizeX).toBeUndefined()
    expect(object.controls?.mtr).toMatchObject({ offsetY: -40, withConnection: true })
    expect(object.controls?.mtr).not.toHaveProperty('touchSizeX')
  })

  it('exports a non-empty PNG and releases object URLs/listeners on dispose', async () => {
    const { adapter, canvas, released } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())

    const png = await adapter.exportPng()
    expect(png.size).toBeGreaterThan(0)
    expect(png.type).toBe('image/png')

    adapter.dispose()
    expect(released).toEqual(expect.arrayContaining([
      `felt-resource://material/${validScene.assetSnapshotId}/mock-background.png`,
      `felt-resource://material/${validScene.assetSnapshotId}/mock-sticker.png`
    ]))
    expect(canvas.disposed).toBe(true)
    expect([...canvas.listeners.values()].flat()).toHaveLength(0)
  })

  it('does not silently replace an unavailable felt-resource material', async () => {
    const unavailable = materialAsset('sticker')
    unavailable.imageUrl = `felt-resource://material/${validScene.assetSnapshotId}/missing.png`
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

  it('rejects same assetId from a different snapshot ResourceRef (no latest mix-in)', async () => {
    const { adapter, loadedRefs } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const latestMixIn = materialAsset('sticker')
    latestMixIn.imageUrl = 'felt-resource://material/snapshot_latest_zzz/mock-sticker.png'
    latestMixIn.contentVersion = 2
    const access = { ...validAccess, assetId: latestMixIn.assetId }

    await expect(adapter.addSticker(latestMixIn, access)).rejects.toMatchObject({ code: 'ASSET_SNAPSHOT_MISMATCH' })
    const latestBg = materialAsset('background')
    latestBg.imageUrl = 'felt-resource://material/snapshot_latest_zzz/mock-background.png'
    await expect(adapter.setBackground(latestBg, { ...validAccess, assetId: latestBg.assetId })).rejects.toMatchObject({
      code: 'ASSET_SNAPSHOT_MISMATCH'
    })
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

  it('no-ops deleteSelected and selected layer ops on recovery placeholders', async () => {
    const unavailableSticker = materialAsset('sticker')
    unavailableSticker.imageUrl = 'felt-resource://material/missing-selected.png'
    const scene = cloneFixture(validScene)
    const { adapter, canvas } = createHarness(scene, new Set([unavailableSticker.imageUrl]))
    await adapter.importScene(scene, {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return unavailableSticker
        throw new Error('not found')
      }
    })

    const placeholder = canvas.getObjects()[0]
    expect(placeholder.selectable).toBe(false)
    canvas.setActiveObject(placeholder)
    const orderBefore = canvas.getObjects().map((object) => object.objectId)

    expect(() => adapter.bringSelectedForward()).not.toThrow()
    expect(() => adapter.sendSelectedBackward()).not.toThrow()
    expect(() => adapter.bringSelectedToFront()).not.toThrow()
    expect(() => adapter.sendSelectedToBack()).not.toThrow()
    expect(canvas.getObjects().map((object) => object.objectId)).toEqual(orderBefore)
    expect(adapter.getRecoveryIssues()).toHaveLength(1)

    expect(() => adapter.deleteSelected()).not.toThrow()
    expect(canvas.getObjects()).toHaveLength(1)
    expect(adapter.getRecoveryIssues()).toHaveLength(1)
    expect(adapter.getRecoveryIssues()[0]?.assetId).toBe(validAsset.assetId)

    // Explicit Recovery repair path still allows deleting the placeholder by objectId.
    expect(() => adapter.deleteObject(placeholder.objectId!)).not.toThrow()
    expect(canvas.getObjects()).toHaveLength(0)
    expect(adapter.getRecoveryIssues()).toHaveLength(0)
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

  it('does not let a superseded deferred undo/redo overwrite the new Scene history', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    let deferNextLoad = false
    let pendingLoad: ReturnType<typeof deferred<{ sourceUrl: string; dispose(): void }>> | undefined
    let objectIdIndex = 0
    const objectIds = [
      'a5d775d8-e6f8-439a-9d04-0934cb03f81f',
      'b5d775d8-e6f8-439a-9d04-0934cb03f81f',
      'c5d775d8-e6f8-439a-9d04-0934cb03f81f'
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
        if (deferNextLoad) {
          deferNextLoad = false
          pendingLoad = deferred<{ sourceUrl: string; dispose(): void }>()
          return pendingLoad.promise
        }
        return { sourceUrl: `blob:${ref}`, dispose: () => undefined }
      }
    })
    const sceneB = cloneFixture(validScene)
    sceneB.sceneId = '8a3435d2-2c2f-4df1-a38c-5b7e32ce91a8'
    const sceneC = cloneFixture(validScene)
    sceneC.sceneId = '9a3435d2-2c2f-4df1-a38c-5b7e32ce91a8'

    adapter.initialize({} as HTMLCanvasElement, scene)
    await adapter.importScene(scene, resolver())
    await adapter.addSticker(materialAsset('sticker'), validAccess)

    deferNextLoad = true
    const oldUndo = adapter.undo()
    await Promise.resolve()
    await Promise.resolve()
    expect(pendingLoad).toBeDefined()

    await expect(adapter.importScene(sceneB, resolver())).resolves.toMatchObject({ issues: [] })
    expect(adapter.exportScene().sceneId).toBe(sceneB.sceneId)
    pendingLoad?.resolve({ sourceUrl: 'blob:stale-undo', dispose: () => undefined })
    await expect(oldUndo).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(adapter.exportScene().sceneId).toBe(sceneB.sceneId)

    await adapter.addSticker(materialAsset('sticker'), validAccess)
    await expect(adapter.undo()).resolves.toBe(true)

    deferNextLoad = true
    const oldRedo = adapter.redo()
    await Promise.resolve()
    await Promise.resolve()
    expect(pendingLoad).toBeDefined()

    await expect(adapter.importScene(sceneC, resolver())).resolves.toMatchObject({ issues: [] })
    expect(adapter.exportScene().sceneId).toBe(sceneC.sceneId)
    pendingLoad?.resolve({ sourceUrl: 'blob:stale-redo', dispose: () => undefined })
    await expect(oldRedo).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(adapter.exportScene().sceneId).toBe(sceneC.sceneId)

    await adapter.addSticker(materialAsset('sticker'), validAccess)
    await expect(adapter.undo()).resolves.toBe(true)
    expect(adapter.exportScene().sceneId).toBe(sceneC.sceneId)
    await expect(adapter.redo()).resolves.toBe(true)
    expect(adapter.exportScene().sceneId).toBe(sceneC.sceneId)
  })
})

describe('P0 Fabric image validation and PNG export', () => {
  function ghostImage(overrides: Partial<{ width: unknown; height: unknown; set: unknown }> = {}): Record<string, unknown> {
    return { width: 0, height: 0, set: () => undefined, ...overrides }
  }

  // A. Fabric 5.3.0 reports isError=true with a non-null image of width=0, height=0.
  it('rejects a ghost Image when Fabric reports isError=true', () => {
    const error = validateFabricFromURLResult(ghostImage(), true)
    expect(error).toMatchObject({ code: 'ASSET_NOT_FOUND' })
  })

  // B. isError is not provided but width or height is 0 (or non-finite) — still rejected.
  it('rejects a ghost Image when isError is missing but width or height is non-positive', () => {
    expect(validateFabricFromURLResult(ghostImage({ width: 0, height: 802 }), undefined)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(validateFabricFromURLResult(ghostImage({ width: 885, height: 0 }), undefined)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(validateFabricFromURLResult(ghostImage({ width: Number.NaN, height: 802 }), undefined)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(validateFabricFromURLResult(ghostImage({ width: Number.POSITIVE_INFINITY, height: 802 }), undefined)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(validateFabricFromURLResult(ghostImage({ width: -10, height: 20 }), undefined)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
  })

  it('rejects when image is missing or does not expose set()', () => {
    expect(validateFabricFromURLResult(null, false)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(validateFabricFromURLResult({ width: 100, height: 100 }, false)).toMatchObject({ code: 'ASSET_NOT_FOUND' })
  })

  // C. A normal image with finite positive width/height is accepted.
  it('accepts a normal Image with finite positive width/height', () => {
    expect(validateFabricFromURLResult({ width: 885, height: 802, set: () => undefined }, false)).toBeNull()
  })

  it('propagates ASSET_NOT_FOUND through the adapter and does not add a ghost to the canvas', async () => {
    // Simulate the default runtime's behavior: a failed Fabric load surfaces as
    // an ASSET_NOT_FOUND rejection. The adapter must surface it as-is and the
    // canvas object count must not increase.
    const canvas = new FakeCanvas(validScene.canvas.width, validScene.canvas.height)
    const assetNotFound = { code: 'ASSET_NOT_FOUND', message: 'Material image could not be loaded.', retryable: false }
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async () => {
          throw assetNotFound
        },
        createPlaceholder: (options) => new FakeObject(options)
      },
      now: () => new Date('2026-08-01T08:00:00.000Z'),
      createObjectId: () => 'c2d775d8-e6f8-439a-9d04-0934cb03f81f',
      loadResource: async (ref) => ({ sourceUrl: `blob:${ref}`, dispose: () => undefined })
    })
    // Initialize with an empty scene so the background import does not pre-populate
    // the canvas (which would then later interfere with the assertion below).
    const emptyScene: SceneDocument = {
      ...cloneFixture(validScene),
      backgroundAssetId: null,
      objects: []
    }
    adapter.initialize({} as HTMLCanvasElement, emptyScene)
    await adapter.importScene(emptyScene, resolver())

    const initialCount = canvas.getObjects().length
    await expect(adapter.addSticker(materialAsset('sticker'), validAccess))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' })
    expect(canvas.getObjects()).toHaveLength(initialCount)
  })

  it('exports only the selected object in local coordinates without changing scene order or transforms', async () => {
    const { adapter, canvas } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const before = adapter.exportScene()
    const target = canvas.getObjects().find(o => o.objectId === validScene.objects[0].objectId)!
    let options: Record<string, unknown> | undefined
    target.toDataURL = value => { options = value; return canvas.toDataURL() }
    const image = await adapter.exportPng(target.objectId)
    expect(image.type).toBe('image/png')
    expect(options).toEqual({ format: 'png', multiplier: 1, withoutTransform: true, withoutShadow: true })
    expect(adapter.exportScene()).toEqual(before)
    await expect(adapter.exportPng('missing')).rejects.toMatchObject({ code: 'PREVIEW_EXPORT_FAILED' })
    target.visible = false
    await expect(adapter.exportPng(target.objectId)).rejects.toMatchObject({ code: 'PREVIEW_EXPORT_FAILED' })
  })

  it('exportPng() produces a valid PNG blob with non-zero size and image/png type', async () => {
    const { adapter } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())

    const blob = await adapter.exportPng()
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toBe('image/png')

    const buffer = new Uint8Array(await blob.arrayBuffer())
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(buffer.slice(0, 8))).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  })

  it('exportPng() rejects a non-PNG data URL with PREVIEW_EXPORT_FAILED', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    canvas.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD/AD/6KKK/IT/Z4/9k='
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => new FakeObject(options)
      },
      now: () => new Date('2026-08-01T08:00:00.000Z'),
      createObjectId: () => 'c2d775d8-e6f8-439a-9d04-0934cb03f81f',
      loadResource: async (ref) => ({ sourceUrl: `blob:${ref}`, dispose: () => undefined })
    })
    adapter.initialize({} as HTMLCanvasElement, scene)
    await adapter.importScene(scene, resolver())

    await expect(adapter.exportPng()).rejects.toMatchObject({ code: 'PREVIEW_EXPORT_FAILED' })
  })

  it('exportPng() rejects a malformed base64 payload with PREVIEW_EXPORT_FAILED', async () => {
    const scene = cloneFixture(validScene)
    const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
    canvas.toDataURL = () => 'data:image/png;base64,!!!not-base64!!!'
    const adapter = new FabricEditorAdapter({
      snapshotContext: validSnapshotContext,
      allowTestAssets: true,
      runtime: {
        createCanvas: () => canvas,
        createImage: async (_sourceUrl, options) => new FakeObject(options),
        createPlaceholder: (options) => new FakeObject(options)
      },
      now: () => new Date('2026-08-01T08:00:00.000Z'),
      createObjectId: () => 'c2d775d8-e6f8-439a-9d04-0934cb03f81f',
      loadResource: async (ref) => ({ sourceUrl: `blob:${ref}`, dispose: () => undefined })
    })
    adapter.initialize({} as HTMLCanvasElement, scene)
    await adapter.importScene(scene, resolver())

    await expect(adapter.exportPng()).rejects.toMatchObject({ code: 'PREVIEW_EXPORT_FAILED' })
  })
})

describe('Fabric selection projection', () => {
  it('projects selection, geometry, double-click, and cleared events with logical bounds', async () => {
    const scene = cloneFixture(validScene)
    const { adapter, canvas } = createHarness(scene)
    await adapter.importScene(scene, resolver())
    const object = canvas.getObjects()[0]
    const events: EditorSelectionEvent[] = []
    const unsubscribe = adapter.subscribeSelection((event) => events.push(event))

    canvas.setActiveObject(object)
    canvas.emit('selection:created')
    object.set({ left: 600, top: 360, scaleX: 0.8, scaleY: 0.8, angle: 540 })
    canvas.emit('object:moving', object)
    canvas.emit('object:scaling', object)
    canvas.emit('object:rotating', object)
    canvas.emit('object:modified', object)
    canvas.emit('mouse:dblclick', object)
    canvas.emit('selection:cleared')

    expect(events.map((event) => event.type)).toEqual([
      'selected', 'geometry', 'geometry', 'geometry', 'geometry', 'double-click', 'cleared'
    ])
    const projection = events.find((event) => event.type === 'selected')
    expect(projection).toMatchObject({
      type: 'selected',
      selection: {
        objectId: validScene.objects[0].objectId,
        bounds: { left: 380, top: 220, width: 80, height: 80 }
      }
    })
    expect(object.angle).toBe(-180)
    unsubscribe()
    canvas.emit('selection:created', object)
    expect(events).toHaveLength(7)
  })

  it('does not project invalid objects or recovery placeholders and clears listeners on dispose', async () => {
    const scene = cloneFixture(validScene)
    const { adapter, canvas } = createHarness(scene)
    await adapter.importScene(scene, resolver())
    const events: EditorSelectionEvent[] = []
    adapter.subscribeSelection((event) => events.push(event))

    const invalid = new FakeObject({ objectId: '', assetType: 'sticker', selectable: true, left: 10, top: 10 })
    canvas.add(invalid)
    canvas.setActiveObject(invalid)
    canvas.emit('selection:created')
    expect(events).toEqual([])

    const unavailable = materialAsset('sticker')
    unavailable.imageUrl = 'felt-resource://material/recovery-placeholder.png'
    const recovery = createHarness(cloneFixture(validScene), new Set([unavailable.imageUrl]))
    await recovery.adapter.importScene(cloneFixture(validScene), {
      async resolveAsset(assetId): Promise<AssetRecord> {
        if (assetId === 'background_moon_001') return materialAsset('background')
        if (assetId === validAsset.assetId) return unavailable
        throw new Error('not found')
      }
    })
    const placeholder = recovery.canvas.getObjects()[0]
    const recoveryEvents: EditorSelectionEvent[] = []
    recovery.adapter.subscribeSelection((event) => recoveryEvents.push(event))
    recovery.canvas.setActiveObject(placeholder)
    recovery.canvas.emit('selection:created')
    expect(recoveryEvents).toEqual([])

    adapter.dispose()
    recovery.adapter.dispose()
    expect(() => canvas.emit('selection:created', invalid)).not.toThrow()
    expect(events).toEqual([])
  })

  it('isolates selection listener failures', async () => {
    const { adapter, canvas } = createHarness()
    await adapter.importScene(cloneFixture(validScene), resolver())
    const object = canvas.getObjects()[0]
    const received: EditorSelectionEvent[] = []
    adapter.subscribeSelection(() => { throw new Error('view failure') })
    adapter.subscribeSelection((event) => received.push(event))
    canvas.setActiveObject(object)
    expect(() => canvas.emit('selection:created')).not.toThrow()
    expect(received).toHaveLength(1)
  })
})

describe('P0 Renderer CSP allows blob: for image rendering', () => {
  function readCspMeta(htmlPath: string): string {
    const html = readFileSync(htmlPath, 'utf8')
    // The content attribute is double-quoted and may contain single quotes inside
    // its value (e.g. 'self'). Match only the double-quote form.
    const match = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content="([^"]+)"/i.exec(html)
    expect(match, `CSP meta tag should be present in ${htmlPath}`).not.toBeNull()
    return match![1]
  }

  function extractDirective(csp: string, name: string): string | undefined {
    return csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(name))
  }

  it('src/renderer/index.html img-src includes blob: (and keeps data: and felt-resource:)', () => {
    const csp = readCspMeta(resolve('src/renderer/index.html'))
    const imgSrc = extractDirective(csp, 'img-src')
    expect(imgSrc, 'img-src directive should exist').toBeDefined()
    expect(imgSrc).toMatch(/(\s|^)blob:(\s|$)/)
    expect(imgSrc).toMatch(/(\s|^)data:(\s|$)/)
    expect(imgSrc).toMatch(/(\s|^)felt-resource:(\s|$)/)
  })

  it('src/renderer/index.html media-src does NOT include blob: (minimum permission)', () => {
    // media-src is used for <audio>/<video>. The current renderer uses Howler
    // with felt-resource://audio/... URLs directly; no code path emits a blob:
    // URL into a media element. Adding blob: here would be an over-permission.
    const csp = readCspMeta(resolve('src/renderer/index.html'))
    const mediaSrc = extractDirective(csp, 'media-src')
    expect(mediaSrc, 'media-src directive should exist').toBeDefined()
    expect(mediaSrc).not.toMatch(/(\s|^)blob:(\s|$)/)
    expect(mediaSrc).toMatch(/(\s|^)felt-resource:(\s|$)/)
  })

  it('src/renderer/fabric-smoke.html img-src includes blob: for smoke parity', () => {
    const csp = readCspMeta(resolve('src/renderer/fabric-smoke.html'))
    const imgSrc = extractDirective(csp, 'img-src')
    expect(imgSrc, 'img-src directive should exist').toBeDefined()
    expect(imgSrc).toMatch(/(\s|^)blob:(\s|$)/)
    expect(imgSrc).toMatch(/(\s|^)data:(\s|$)/)
    expect(imgSrc).toMatch(/(\s|^)felt-resource:(\s|$)/)
  })

  it('src/renderer/fabric-smoke.html media-src does NOT include blob: (smoke parity)', () => {
    const csp = readCspMeta(resolve('src/renderer/fabric-smoke.html'))
    const mediaSrc = extractDirective(csp, 'media-src')
    expect(mediaSrc, 'media-src directive should exist').toBeDefined()
    expect(mediaSrc).not.toMatch(/(\s|^)blob:(\s|$)/)
    expect(mediaSrc).toMatch(/(\s|^)felt-resource:(\s|$)/)
  })
})
