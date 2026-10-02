import { describe, expect, it, vi } from 'vitest'

vi.mock('fabric', () => ({
  fabric: {
    Canvas: class {},
    Image: { fromURL: () => undefined },
    Rect: class {}
  }
}))

import type {
  AssetRecord,
  PersonalAssetRecord,
  PersonalAssetVersionRecord,
  SceneDocument,
  SceneObject
} from '../../src/shared/contracts'
import {
  FabricEditorAdapter,
  type FabricCanvasPort,
  type FabricEditorAssetResolver,
  type FabricEditorRuntime,
  type FabricObjectPort
} from '../../src/renderer/src/editor/fabric-editor-adapter'
import { cloneFixture, validAccess, validAsset, validScene, validSnapshotContext } from '../shared/contracts.fixtures'

const backgroundAssetId = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
const backgroundVersionId = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const backgroundVersionV2Id = 'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19'
const coreAssetId = '2a8c8c2b-66ef-43b5-9ea4-748af0eac3b4'
const coreVersionId = '8d4bbd2b-7288-4a19-b0dd-5bf43fd1cb9e'
const elementAssetId = '1ea8d75e-5949-440c-9db5-c7b4eaf4a6d1'
const elementVersionId = '7f1d2e3c-4b5a-46c7-8d9e-0f1a2b3c4d5e'
const systemObjectCId = '9f1d2e3c-4b5a-46c7-8d9e-0f1a2b3c4d5e'

class FakeObject implements FabricObjectPort {
  objectId?: string
  assetId?: string
  assetType?: 'sticker'
  sceneObjectKind?: 'system_sticker' | 'core_pattern' | 'personal_element'
  personalAssetId?: string
  versionId?: string
  left?: number
  top?: number
  scaleX?: number
  scaleY?: number
  angle?: number
  width = 100
  height = 100
  visible?: boolean
  selectable?: boolean
  evented?: boolean
  lockMovementX?: boolean
  lockMovementY?: boolean
  lockScalingX?: boolean
  lockScalingY?: boolean
  lockScalingFlip?: boolean
  lockSkewingX?: boolean
  lockSkewingY?: boolean
  lockRotation?: boolean
  flipX?: boolean
  flipY?: boolean
  skewX?: number
  skewY?: number

  constructor(options: Record<string, unknown>) {
    this.set(options)
  }

  set(options: Record<string, unknown>): void {
    Object.assign(this, options)
  }

  setCoords(): void {}

  getBoundingRect(): { left: number; top: number; width: number; height: number } {
    const width = Math.abs(this.width * (this.scaleX ?? 1))
    const height = Math.abs(this.height * (this.scaleY ?? 1))
    return { left: (this.left ?? 0) - width / 2, top: (this.top ?? 0) - height / 2, width, height }
  }
}

class FakeCanvas implements FabricCanvasPort {
  backgroundImage: FabricObjectPort | null = null
  backgroundColor: string | undefined
  readonly objects: FabricObjectPort[] = []
  private readonly listeners = new Map<string, Array<(event: { target?: FabricObjectPort }) => void>>()
  private activeObject: FabricObjectPort | null = null
  private width: number
  private height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  add(...objects: FabricObjectPort[]): void { this.objects.push(...objects) }

  remove(...objects: FabricObjectPort[]): void {
    for (const object of objects) {
      const index = this.objects.indexOf(object)
      if (index >= 0) this.objects.splice(index, 1)
    }
  }

  getObjects(): FabricObjectPort[] { return [...this.objects] }
  getWidth(): number { return this.width }
  getHeight(): number { return this.height }
  setWidth(width: number): void { this.width = width }
  setHeight(height: number): void { this.height = height }
  setBackgroundImage(image: FabricObjectPort | null, callback: () => void): void { this.backgroundImage = image; callback() }
  setActiveObject(object: FabricObjectPort): void { this.activeObject = object }
  getActiveObject(): FabricObjectPort | null { return this.activeObject }
  discardActiveObject(): void { this.activeObject = null }

  moveTo(object: FabricObjectPort, index: number): void {
    this.remove(object)
    this.objects.splice(Math.max(0, Math.min(index, this.objects.length)), 0, object)
  }

  bringForward(object: FabricObjectPort): void { this.moveTo(object, this.objects.indexOf(object) + 1) }
  sendBackwards(object: FabricObjectPort): void { this.moveTo(object, this.objects.indexOf(object) - 1) }
  bringToFront(object: FabricObjectPort): void { this.moveTo(object, this.objects.length) }
  sendToBack(object: FabricObjectPort): void { this.moveTo(object, 0) }

  on(eventName: string, listener: (event: { target?: FabricObjectPort }) => void): void {
    this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener])
  }

  off(eventName: string, listener?: (event: { target?: FabricObjectPort }) => void): void {
    if (!listener) { this.listeners.delete(eventName); return }
    this.listeners.set(eventName, (this.listeners.get(eventName) ?? []).filter((candidate) => candidate !== listener))
  }

  calcOffset(): void {}
  requestRenderAll(): void {}
  toDataURL(): string { return 'data:image/png;base64,AAAA' }
  dispose(): void {}

  emit(eventName: string, target?: FabricObjectPort): void {
    for (const listener of this.listeners.get(eventName) ?? []) listener({ target })
  }
}

function personalAsset(
  personalAssetId: string,
  versionId: string,
  role: PersonalAssetRecord['role'],
  userId = 'user_demo_001'
): PersonalAssetRecord {
  return {
    personalAssetId,
    userId,
    role,
    sourceType: 'uploaded',
    name: `${role} fixture`,
    currentVersionId: versionId,
    createdAt: '2026-07-30T05:10:00.000Z',
    updatedAt: '2026-07-30T05:20:00.000Z'
  }
}

function personalVersion(versionId: string, personalAssetId: string): PersonalAssetVersionRecord {
  return {
    versionId,
    personalAssetId,
    versionNumber: 1,
    sourceImageRef: `felt-resource://personal/${personalAssetId}/${versionId}/source.png`,
    parentVersionId: null,
    createdAt: '2026-07-30T05:20:00.000Z'
  }
}

function systemAsset(type: AssetRecord['type']): AssetRecord {
  const snapshotId = validScene.assetSnapshotId
  return {
    ...cloneFixture(validAsset),
    assetId: type === 'background' ? 'background_moon_001' : validAsset.assetId,
    type,
    status: 'ready',
    imageUrl: `felt-resource://material/${snapshotId}/${type}.png`,
    thumbnailUrl: `felt-resource://material/${snapshotId}/${type}-thumb.png`,
    preSplitDataUrl: undefined
  }
}

function mixedScene(): SceneDocument {
  const scene = cloneFixture(validScene)
  const systemC: SceneObject = {
    ...scene.objects[0],
    objectId: systemObjectCId,
    left: 800,
    zIndex: 3
  }
  scene.backgroundAssetId = null
  scene.personalBackground = { personalAssetId: backgroundAssetId, versionId: backgroundVersionId }
  scene.corePattern = {
    objectId: '3a8c8c2b-66ef-43b5-9ea4-748af0eac3b4',
    personalAssetId: coreAssetId,
    versionId: coreVersionId,
    left: 600,
    top: 400,
    scaleX: 1,
    scaleY: 1,
    angle: 10,
    visible: true,
    locked: false
  }
  scene.objects = [scene.objects[0], systemC]
  scene.personalElements = [{
    objectId: '4a8c8c2b-66ef-43b5-9ea4-748af0eac3b4',
    personalAssetId: elementAssetId,
    versionId: elementVersionId,
    left: 500,
    top: 300,
    scaleX: 0.75,
    scaleY: 0.75,
    angle: -5,
    zIndex: 2,
    visible: true,
    locked: false
  }]
  return scene
}

function createHarness(scene: SceneDocument, resolver: FabricEditorAssetResolver, missingRefs = new Set<string>()): {
  adapter: FabricEditorAdapter
  canvas: FakeCanvas
  released: string[]
} {
  const canvas = new FakeCanvas(scene.canvas.width, scene.canvas.height)
  const released: string[] = []
  const runtime: FabricEditorRuntime = {
    createCanvas: () => canvas,
    createImage: async (_sourceUrl, options) => new FakeObject(options),
    createPlaceholder: (options) => new FakeObject(options)
  }
  const adapter = new FabricEditorAdapter({
    runtime,
    allowTestAssets: false,
    snapshotContext: validSnapshotContext,
    createObjectId: () => '5a8c8c2b-66ef-43b5-9ea4-748af0eac3b4',
    now: () => new Date('2026-08-01T08:00:00.000Z'),
    loadResource: async (ref) => {
      if (missingRefs.has(ref)) throw new Error('missing resource')
      return { sourceUrl: `blob:test/${ref}`, dispose: () => released.push(ref) }
    }
  })
  adapter.initialize({} as HTMLCanvasElement, scene)
  return { adapter, canvas, released }
}

function resolverForPersonal(): FabricEditorAssetResolver {
  const systemBackground = systemAsset('background')
  const systemSticker = systemAsset('sticker')
  const bundles = new Map<string, { asset: PersonalAssetRecord; version: PersonalAssetVersionRecord }>([
    [backgroundVersionId, { asset: personalAsset(backgroundAssetId, backgroundVersionId, 'background'), version: personalVersion(backgroundVersionId, backgroundAssetId) }],
    [backgroundVersionV2Id, { asset: personalAsset(backgroundAssetId, backgroundVersionV2Id, 'background'), version: personalVersion(backgroundVersionV2Id, backgroundAssetId) }],
    [coreVersionId, { asset: personalAsset(coreAssetId, coreVersionId, 'core_pattern'), version: personalVersion(coreVersionId, coreAssetId) }],
    [elementVersionId, { asset: personalAsset(elementAssetId, elementVersionId, 'element'), version: personalVersion(elementVersionId, elementAssetId) }]
  ])
  return {
    async resolveAsset(assetId) {
      if (assetId === systemBackground.assetId) return systemBackground
      if (assetId === systemSticker.assetId) return systemSticker
      throw new Error('system asset not found')
    },
    async resolvePersonalAsset(personalAssetId, versionId) {
      const bundle = bundles.get(versionId)
      if (!bundle || bundle.asset.personalAssetId !== personalAssetId) throw new Error('personal version not found')
      return bundle
    }
  }
}

describe('personal asset Fabric runtime integration', () => {
  it('recolors a system element through an immutable personal version without changing scene order or other objects', async () => {
    const scene = mixedScene(), resolver = resolverForPersonal()
    const { adapter, canvas } = createHarness(scene, resolver)
    await adapter.importScene(scene, resolver)
    const original = adapter.exportScene(), selected = original.objects[0]
    const order = canvas.objects.map(o => o.objectId)
    await adapter.replaceElementImage(selected.objectId, personalAsset(elementAssetId, elementVersionId, 'element'), personalVersion(elementVersionId, elementAssetId))
    const changed = adapter.exportScene()
    expect(canvas.objects.map(o => o.objectId)).toEqual(order)
    expect(changed.personalElements.find(o => o.objectId === selected.objectId)).toMatchObject({
      objectId: selected.objectId, left: selected.left, top: selected.top, angle: selected.angle,
      scaleX: selected.scaleX, scaleY: selected.scaleY, zIndex: selected.zIndex, versionId: elementVersionId
    })
    expect(changed.objects).toEqual(original.objects.slice(1))
    expect(changed.corePattern).toEqual(original.corePattern)
    expect(changed.personalBackground).toEqual(original.personalBackground)
    expect(changed.personalElements.find(o => o.objectId === original.personalElements[0].objectId)).toEqual(original.personalElements[0])
    await adapter.undo()
    expect(adapter.exportScene().objects).toEqual(original.objects)
    await adapter.redo()
    expect(adapter.exportScene().personalElements).toEqual(changed.personalElements)
  })

  it('retains the fixed core tier when replacing core pattern pixels', async () => {
    const scene = mixedScene(), resolver = resolverForPersonal()
    const { adapter, canvas } = createHarness(scene, resolver)
    await adapter.importScene(scene, resolver)
    const original = adapter.exportScene()
    await adapter.replaceElementImage(scene.corePattern!.objectId, personalAsset(coreAssetId, coreVersionId, 'core_pattern'), personalVersion(coreVersionId, coreAssetId))
    expect(canvas.objects[0].sceneObjectKind).toBe('core_pattern')
    expect(adapter.exportScene().corePattern).toEqual(original.corePattern)
    expect(adapter.exportScene().objects).toEqual(original.objects)
    expect(adapter.exportScene().personalElements).toEqual(original.personalElements)
  })

  it('rejects foreign ownership, incorrect roles and missing objects without replacing any pixels', async () => {
    const scene = mixedScene(), resolver = resolverForPersonal()
    const { adapter, canvas } = createHarness(scene, resolver)
    await adapter.importScene(scene, resolver)
    const objects = [...canvas.objects]
    await expect(adapter.replaceElementImage(scene.objects[0].objectId, personalAsset(elementAssetId, elementVersionId, 'element', 'other-user'), personalVersion(elementVersionId, elementAssetId))).rejects.toThrow()
    await expect(adapter.replaceElementImage(scene.corePattern!.objectId, personalAsset(elementAssetId, elementVersionId, 'element'), personalVersion(elementVersionId, elementAssetId))).rejects.toThrow()
    await expect(adapter.replaceElementImage('missing', personalAsset(elementAssetId, elementVersionId, 'element'), personalVersion(elementVersionId, elementAssetId))).rejects.toThrow()
    expect(canvas.objects).toEqual(objects)
  })

  it('imports and round-trips background, core, mixed elements, and fixed versions', async () => {
    const scene = mixedScene()
    const { adapter, canvas } = createHarness(scene, resolverForPersonal())
    await expect(adapter.importScene(scene, resolverForPersonal())).resolves.toMatchObject({ issues: [] })

    expect(canvas.backgroundImage).toMatchObject({
      personalAssetId: backgroundAssetId,
      versionId: backgroundVersionId,
      selectable: false,
      lockMovementX: true,
      lockScalingX: true,
      lockRotation: true
    })
    expect(canvas.objects.map((object) => object.sceneObjectKind)).toEqual([
      'core_pattern',
      'system_sticker',
      'personal_element',
      'system_sticker'
    ])
    expect(canvas.objects[0]).toMatchObject({ selectable: true, lockMovementX: false, lockScalingY: false, lockRotation: false })
    expect(canvas.objects[2]).toMatchObject({ selectable: true, personalAssetId: elementAssetId, versionId: elementVersionId })

    const selections: Array<{ selection?: { kind?: string; canChangeLayer?: boolean } }> = []
    adapter.subscribeSelection((event) => { if (event.type === 'selected') selections.push(event) })
    adapter.selectObject(scene.corePattern!.objectId)
    canvas.emit('selection:created', canvas.objects[0])
    expect(selections[0]?.selection).toMatchObject({ kind: 'core_pattern', canChangeLayer: false })

    const exported = adapter.exportScene()
    expect(exported.personalBackground).toEqual(scene.personalBackground)
    expect(exported.corePattern).toMatchObject(scene.corePattern!)
    expect(exported.personalElements).toMatchObject(scene.personalElements)
    expect(exported.objects.map((object) => object.zIndex)).toEqual([1, 3])
    expect(exported.personalElements.map((object) => object.zIndex)).toEqual([2])
  })

  it('moves personal elements through the shared Element tier without crossing Core Pattern', async () => {
    const scene = mixedScene()
    const { adapter, canvas } = createHarness(scene, resolverForPersonal())
    await adapter.importScene(scene, resolverForPersonal())
    const personalId = scene.personalElements[0].objectId
    const coreId = scene.corePattern!.objectId

    adapter.sendToBack(personalId)
    expect(canvas.objects.map((object) => object.sceneObjectKind)).toEqual([
      'core_pattern', 'personal_element', 'system_sticker', 'system_sticker'
    ])
    expect(adapter.exportScene().objects.map((object) => object.zIndex)).toEqual([2, 3])
    expect(adapter.exportScene().personalElements[0].zIndex).toBe(1)

    adapter.bringToFront(personalId)
    expect(adapter.exportScene().personalElements[0].zIndex).toBe(3)
    adapter.sendBackward(personalId)
    expect(adapter.exportScene().personalElements[0].zIndex).toBe(2)
    adapter.bringForward(personalId)
    expect(adapter.exportScene().personalElements[0].zIndex).toBe(3)

    adapter.bringToFront(coreId)
    expect(canvas.objects[0].sceneObjectKind).toBe('core_pattern')
  })

  it('supports personal background transitions and deletion', async () => {
    const scene = mixedScene()
    const { adapter } = createHarness(scene, resolverForPersonal())
    const resolver = resolverForPersonal()
    await adapter.importScene(scene, resolver)
    const systemBackground = systemAsset('background')

    await adapter.setBackground(systemBackground, { ...validAccess, assetId: systemBackground.assetId })
    expect(adapter.exportScene()).toMatchObject({ backgroundAssetId: systemBackground.assetId, personalBackground: null })
    await adapter.setPersonalBackground(
      personalAsset(backgroundAssetId, backgroundVersionId, 'background'),
      personalVersion(backgroundVersionId, backgroundAssetId)
    )
    expect(adapter.exportScene()).toMatchObject({ backgroundAssetId: null, personalBackground: { personalAssetId: backgroundAssetId, versionId: backgroundVersionId } })
    adapter.setSolidBackground('#FFFFFF')
    expect(adapter.exportScene()).toMatchObject({ backgroundAssetId: null, personalBackground: null })
    await adapter.setPersonalBackground(
      personalAsset(backgroundAssetId, backgroundVersionId, 'background'),
      personalVersion(backgroundVersionId, backgroundAssetId)
    )
    adapter.setTransparentBackground()
    const transparent = adapter.exportScene()
    expect(transparent).toMatchObject({ backgroundAssetId: null, personalBackground: null })
    expect(transparent.canvas.backgroundColor).toBeUndefined()

    expect(() => adapter.deleteObject(scene.corePattern!.objectId)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(adapter.exportScene().corePattern?.objectId).toBe(scene.corePattern!.objectId)
    adapter.deleteObject(scene.personalElements[0].objectId)
    expect(adapter.exportScene().personalElements).toEqual([])
  })

  it('captures Personal Asset transform, layer, core, and background mutations in Scene history', async () => {
    const scene = mixedScene()
    const resolver = resolverForPersonal()
    const { adapter, canvas } = createHarness(scene, resolver)
    await adapter.importScene(scene, resolver)

    const personal = canvas.objects.find((object) => object.sceneObjectKind === 'personal_element')!
    personal.set({ left: 711, top: 322 })
    canvas.emit('object:modified', personal)
    expect(adapter.exportScene().personalElements[0].left).toBe(711)
    await expect(adapter.undo()).resolves.toBe(true)
    expect(adapter.exportScene().personalElements[0].left).toBe(scene.personalElements[0].left)
    await expect(adapter.redo()).resolves.toBe(true)
    expect(adapter.exportScene().personalElements[0].left).toBe(711)

    adapter.sendToBack(scene.personalElements[0].objectId)
    await adapter.undo()
    expect(adapter.exportScene().personalElements[0].zIndex).toBe(2)
    await adapter.redo()
    expect(adapter.exportScene().personalElements[0].zIndex).toBe(1)

    const core = canvas.objects.find((object) => object.sceneObjectKind === 'core_pattern')!
    core.set({ left: 777 })
    canvas.emit('object:modified', core)
    await adapter.undo()
    expect(adapter.exportScene().corePattern?.left).toBe(scene.corePattern?.left)
    expect(() => adapter.deleteObject(scene.corePattern!.objectId)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(adapter.exportScene().corePattern?.objectId).toBe(scene.corePattern!.objectId)

    const replacement = personalAsset(backgroundAssetId, backgroundVersionV2Id, 'background')
    await adapter.setPersonalBackground(replacement, personalVersion(backgroundVersionV2Id, backgroundAssetId))
    expect(adapter.exportScene().personalBackground?.versionId).toBe(backgroundVersionV2Id)
    await adapter.undo()
    expect(adapter.exportScene().personalBackground?.versionId).toBe(backgroundVersionId)
    await adapter.redo()
    expect(adapter.exportScene().personalBackground?.versionId).toBe(backgroundVersionV2Id)
  })

  it('keeps missing personal versions as locked recovery placeholders and blocks export', async () => {
    const scene = mixedScene()
    const resolver: FabricEditorAssetResolver = {
      async resolveAsset(assetId) { return assetId === 'background_moon_001' ? systemAsset('background') : systemAsset('sticker') },
      async resolvePersonalAsset() { throw new Error('missing historical version') }
    }
    const { adapter, canvas } = createHarness(scene, resolver)
    const result = await adapter.importScene(scene, resolver)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PERSONAL_ASSET_NOT_FOUND', personalAssetId: backgroundAssetId, versionId: backgroundVersionId }),
      expect.objectContaining({ code: 'PERSONAL_ASSET_NOT_FOUND', personalAssetId: coreAssetId, versionId: coreVersionId }),
      expect.objectContaining({ code: 'PERSONAL_ASSET_NOT_FOUND', personalAssetId: elementAssetId, versionId: elementVersionId })
    ]))
    expect(canvas.objects[0]).toMatchObject({ sceneObjectKind: 'core_pattern', personalAssetId: coreAssetId, versionId: coreVersionId, selectable: false })
    expect(() => adapter.exportScene()).toThrow(expect.objectContaining({ code: 'SCENE_VALIDATION_FAILED' }))
  })

  it('distinguishes a missing Personal Asset Version and a failed Personal resource', async () => {
    const scene = mixedScene()
    const versionMissingResolver: FabricEditorAssetResolver = {
      async resolveAsset(assetId) { return assetId === 'background_moon_001' ? systemAsset('background') : systemAsset('sticker') },
      async resolvePersonalAsset() {
        const error = new Error('historical version missing') as Error & { personalRecoveryCode?: string }
        error.personalRecoveryCode = 'PERSONAL_ASSET_VERSION_NOT_FOUND'
        throw error
      }
    }
    const missing = createHarness(scene, versionMissingResolver)
    const missingResult = await missing.adapter.importScene(scene, versionMissingResolver)
    expect(missingResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PERSONAL_ASSET_VERSION_NOT_FOUND' })
    ]))

    const resourceResolver = resolverForPersonal()
    const resource = createHarness(scene, resourceResolver, new Set([`felt-resource://personal/${elementAssetId}/${elementVersionId}/source.png`]))
    const resourceResult = await resource.adapter.importScene(scene, resourceResolver)
    expect(resourceResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PERSONAL_RESOURCE_NOT_FOUND', personalAssetId: elementAssetId })
    ]))
  })

  it('rejects resolver bundles with wrong role or user as Personal Asset recovery', async () => {
    const scene = mixedScene()
    const resolver = resolverForPersonal()
    const invalid: FabricEditorAssetResolver = {
      resolveAsset: resolver.resolveAsset,
      async resolvePersonalAsset(personalAssetId, versionId) {
        if (personalAssetId === elementAssetId) {
          return {
            asset: personalAsset(elementAssetId, versionId, 'background', 'different-user'),
            version: personalVersion(versionId, elementAssetId)
          }
        }
        return resolver.resolvePersonalAsset!(personalAssetId, versionId)
      }
    }
    const { adapter } = createHarness(scene, invalid)
    const result = await adapter.importScene(scene, invalid)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PERSONAL_ASSET_INVALID', personalAssetId: elementAssetId, personalRole: 'element' })
    ]))
  })

  it('releases Personal Asset resources on reload, replacement, and dispose', async () => {
    const scene = mixedScene()
    const resolver = resolverForPersonal()
    const { adapter, released } = createHarness(scene, resolver)
    await adapter.importScene(scene, resolver)
    await adapter.setPersonalBackground(
      personalAsset(backgroundAssetId, backgroundVersionV2Id, 'background'),
      personalVersion(backgroundVersionV2Id, backgroundAssetId)
    )
    await adapter.importScene(scene, resolver)
    adapter.dispose()
    expect(released).toEqual(expect.arrayContaining([
      `felt-resource://personal/${backgroundAssetId}/${backgroundVersionId}/source.png`,
      `felt-resource://personal/${backgroundAssetId}/${backgroundVersionV2Id}/source.png`,
      `felt-resource://personal/${coreAssetId}/${coreVersionId}/source.png`,
      `felt-resource://personal/${elementAssetId}/${elementVersionId}/source.png`
    ]))
  })
})
