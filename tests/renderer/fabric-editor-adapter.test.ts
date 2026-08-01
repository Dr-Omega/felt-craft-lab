import { describe, expect, it } from 'vitest'
import type { AssetRecord, SceneDocument } from '../../src/shared/contracts'
import {
  FabricEditorAdapter,
  type FabricCanvasPort,
  type FabricEditorRuntime,
  type FabricObjectPort
} from '../../src/renderer/src/editor/fabric-editor-adapter'
import { cloneFixture, validAccess, validAsset, validScene } from '../shared/contracts.fixtures'

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
    createImage: async (_sourceUrl, options) => new FakeObject(options)
  }
  const adapter = new FabricEditorAdapter({
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
})
