import { fabric } from 'fabric'
import type { AssetAccessState, AssetRecord, SceneDocument, SceneObject, SharedError } from '@shared/contracts'
import { validateAssetAccessState, validateAssetRecord, validateSceneDocument } from '@shared/contracts'
import { FELT_RESOURCE_REF_POLICY, parseFeltResourceRef } from '@shared/resource'

/**
 * The renderer's only Fabric boundary. Vue components should use this adapter
 * instead of retaining Fabric Canvas or Fabric Object references.
 */

export interface FabricCanvasPort {
  backgroundImage?: FabricObjectPort | null
  backgroundColor?: string
  add(...objects: FabricObjectPort[]): unknown
  remove(...objects: FabricObjectPort[]): unknown
  getObjects(): FabricObjectPort[]
  getWidth(): number
  getHeight(): number
  setWidth(width: number): unknown
  setHeight(height: number): unknown
  setBackgroundImage(image: FabricObjectPort | null, callback: () => void): unknown
  setActiveObject(object: FabricObjectPort): unknown
  getActiveObject(): FabricObjectPort | null
  discardActiveObject(): unknown
  moveTo(object: FabricObjectPort, index: number): unknown
  bringForward(object: FabricObjectPort): unknown
  sendBackwards(object: FabricObjectPort): unknown
  bringToFront(object: FabricObjectPort): unknown
  sendToBack(object: FabricObjectPort): unknown
  on(eventName: string, listener: (event: { target?: FabricObjectPort }) => void): unknown
  off(eventName: string, listener?: (event: { target?: FabricObjectPort }) => void): unknown
  requestRenderAll(): unknown
  toDataURL(options?: { format?: string; multiplier?: number }): string
  dispose(): unknown
}

export interface FabricObjectPort {
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
  lockRotation?: boolean
  set(options: Record<string, unknown>): unknown
  setCoords(): unknown
}

export interface LoadedResource {
  sourceUrl: string
  dispose(): void
}

export interface FabricEditorRuntime {
  createCanvas(element: HTMLCanvasElement, width: number, height: number): FabricCanvasPort
  createImage(sourceUrl: string, options: Record<string, unknown>): Promise<FabricObjectPort>
}

export interface FabricEditorAssetResolver {
  resolveAsset(assetId: string, assetSnapshotId: string): Promise<AssetRecord>
}

export interface FabricEditorAdapterOptions {
  /** Test-only assets are rejected unless this flag is explicitly enabled. */
  allowTestAssets?: boolean
  now?: () => Date
  createObjectId?: () => string
  loadResource?: (ref: string) => Promise<LoadedResource>
  runtime?: FabricEditorRuntime
}

type EditorSceneMetadata = Omit<SceneDocument, 'canvas' | 'backgroundAssetId' | 'objects' | 'updatedAt'>

interface HistoryEntry {
  scene: SceneDocument
}

const DEFAULT_STICKER_SCALE = 1

const defaultRuntime: FabricEditorRuntime = {
  createCanvas(element, width, height) {
    return new fabric.Canvas(element, {
      width,
      height,
      preserveObjectStacking: true,
      selection: true,
      uniformScaling: true
    }) as unknown as FabricCanvasPort
  },
  createImage(sourceUrl, options) {
    return new Promise((resolve, reject) => {
      try {
        fabric.Image.fromURL(sourceUrl, (image) => {
          if (!image) {
            reject(editorError('ASSET_NOT_FOUND', 'Material image could not be loaded.'))
            return
          }
          image.set(options)
          resolve(image as unknown as FabricObjectPort)
        })
      } catch (error) {
        reject(error)
      }
    })
  }
}

async function defaultLoadResource(ref: string): Promise<LoadedResource> {
  const response = await fetch(ref)
  if (!response.ok) throw editorError('ASSET_NOT_FOUND', 'Material resource is unavailable.')

  const sourceUrl = URL.createObjectURL(await response.blob())
  return {
    sourceUrl,
    dispose: () => URL.revokeObjectURL(sourceUrl)
  }
}

/** Normalizes a Fabric clockwise angle to the persisted [-180, 180) range. */
export function normalizeSceneAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  throw editorError('UNKNOWN', 'Secure object identifier generation is unavailable.')
}

function nowUtc(now: () => Date): string {
  return now().toISOString()
}

function editorError(code: SharedError['code'], message: string): SharedError {
  return { code, message, retryable: false }
}

function throwIfInvalidAsset(asset: AssetRecord, allowTestAssets: boolean): void {
  const result = validateAssetRecord(asset, FELT_RESOURCE_REF_POLICY)
  if (!result.ok) throw editorError('INVALID_ARGUMENT', 'Material record failed validation.')
  if (asset.status !== 'ready' && !allowTestAssets) {
    throw editorError('INVALID_ARGUMENT', 'Test-only material cannot be used by the editor.')
  }

  const parsed = parseFeltResourceRef(asset.imageUrl)
  if (!parsed || parsed.kind !== 'material') {
    throw editorError('INVALID_ARGUMENT', 'Editor images must use felt-resource material references.')
  }
}

function throwIfInvalidAccess(asset: AssetRecord, access: AssetAccessState | undefined, userId: string): void {
  if (!access) throw editorError('ASSET_NOT_UNLOCKED', 'Unlocked material access is required.')
  const result = validateAssetAccessState(access)
  if (!result.ok || access.assetId !== asset.assetId || access.userId !== userId || !access.unlocked) {
    throw editorError('ASSET_NOT_UNLOCKED', 'Material is not unlocked for this scene user.')
  }
}

/**
 * Fabric-backed editing core. Its serialization boundary is SceneDocument;
 * Fabric JSON is intentionally neither produced nor consumed as save data.
 */
export class FabricEditorAdapter {
  private readonly runtime: FabricEditorRuntime
  private readonly loadResource: (ref: string) => Promise<LoadedResource>
  private readonly now: () => Date
  private readonly createObjectId: () => string
  private readonly allowTestAssets: boolean
  private readonly objectResources = new WeakMap<FabricObjectPort, () => void>()
  private readonly assetCache = new Map<string, AssetRecord>()
  private readonly listeners: Array<[string, (event: { target?: FabricObjectPort }) => void]> = []
  private canvas: FabricCanvasPort | undefined
  private metadata: EditorSceneMetadata | undefined
  private backgroundAssetId: string | null = null
  private backgroundColor: string | undefined
  private history: HistoryEntry[] = []
  private historyIndex = -1
  private restoring = false
  private resolver: FabricEditorAssetResolver | undefined

  constructor(options: FabricEditorAdapterOptions = {}) {
    this.runtime = options.runtime ?? defaultRuntime
    this.loadResource = options.loadResource ?? defaultLoadResource
    this.now = options.now ?? (() => new Date())
    this.createObjectId = options.createObjectId ?? createUuid
    this.allowTestAssets = options.allowTestAssets ?? false
  }

  initialize(element: HTMLCanvasElement, scene: SceneDocument): void {
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_VALIDATION_FAILED', 'Scene document failed validation.')
    this.dispose()

    this.metadata = metadataFromScene(scene)
    this.backgroundAssetId = scene.backgroundAssetId
    this.backgroundColor = scene.canvas.backgroundColor
    this.canvas = this.runtime.createCanvas(element, scene.canvas.width, scene.canvas.height)
    this.attachCanvasListeners(this.canvas)
  }

  async importScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<void> {
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_IMPORT_FAILED', 'Scene document failed validation.')
    const canvas = this.requireCanvas()
    this.resolver = resolver

    const prepared = await this.prepareScene(scene, resolver)
    this.restoring = true
    try {
      this.releaseCanvasResources(canvas)
      for (const object of canvas.getObjects()) canvas.remove(object)
      canvas.setWidth(scene.canvas.width)
      canvas.setHeight(scene.canvas.height)
      canvas.backgroundColor = scene.canvas.backgroundColor
      if (prepared.background) this.fitBackground(prepared.background.object, canvas)
      canvas.setBackgroundImage(prepared.background?.object ?? null, () => undefined)
      for (const object of prepared.objects) canvas.add(object.object)
      for (const object of prepared.objects) this.objectResources.set(object.object, object.release)
      if (prepared.background) this.objectResources.set(prepared.background.object, prepared.background.release)
      this.metadata = metadataFromScene(scene)
      this.backgroundAssetId = scene.backgroundAssetId
      this.backgroundColor = scene.canvas.backgroundColor
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      this.resetHistory()
    } finally {
      this.restoring = false
    }
  }

  async setBackground(asset: AssetRecord | null, access?: AssetAccessState): Promise<void> {
    const canvas = this.requireCanvas()
    const metadata = this.requireMetadata()
    if (asset === null) {
      this.releaseBackground(canvas)
      canvas.setBackgroundImage(null, () => undefined)
      this.backgroundAssetId = null
      canvas.requestRenderAll()
      this.captureHistory()
      return
    }

    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.type !== 'background') throw editorError('ASSET_TYPE_INVALID', 'Only background assets can be used as a background.')
    throwIfInvalidAccess(asset, access, metadata.userId)
    this.assetCache.set(asset.assetId, asset)

    const loaded = await this.loadEditorImage(asset, this.backgroundOptions(canvas))
    this.fitBackground(loaded.object, canvas)
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(loaded.object, () => undefined)
    this.objectResources.set(loaded.object, loaded.release)
    this.backgroundAssetId = asset.assetId
    canvas.requestRenderAll()
    this.captureHistory()
  }

  resizeCanvas(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw editorError('INVALID_ARGUMENT', 'Canvas dimensions must be positive finite numbers.')
    }
    const canvas = this.requireCanvas()
    canvas.setWidth(width)
    canvas.setHeight(height)
    if (canvas.backgroundImage) this.fitBackground(canvas.backgroundImage, canvas)
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setSolidBackground(color: string): void {
    if (!color.trim()) throw editorError('INVALID_ARGUMENT', 'Background color cannot be empty.')
    const canvas = this.requireCanvas()
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = color
    this.backgroundColor = color
    this.backgroundAssetId = null
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setTransparentBackground(): void {
    const canvas = this.requireCanvas()
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = undefined
    this.backgroundColor = undefined
    this.backgroundAssetId = null
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number }): Promise<string> {
    const canvas = this.requireCanvas()
    const metadata = this.requireMetadata()
    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.type !== 'sticker') throw editorError('ASSET_TYPE_INVALID', 'Only sticker assets can be added as stickers.')
    throwIfInvalidAccess(asset, access, metadata.userId)
    this.assetCache.set(asset.assetId, asset)

    const objectId = this.createObjectId()
    const loaded = await this.loadEditorImage(asset, {
      objectId,
      assetId: asset.assetId,
      assetType: 'sticker',
      originX: 'center',
      originY: 'center',
      left: position?.left ?? canvas.getWidth() / 2,
      top: position?.top ?? canvas.getHeight() / 2,
      scaleX: DEFAULT_STICKER_SCALE,
      scaleY: DEFAULT_STICKER_SCALE,
      angle: 0,
      visible: true,
      selectable: true,
      evented: true,
      lockUniScaling: true,
      lockScalingX: false,
      lockScalingY: false,
      lockRotation: false,
      lockMovementX: false,
      lockMovementY: false
    })
    canvas.add(loaded.object)
    this.objectResources.set(loaded.object, loaded.release)
    canvas.setActiveObject(loaded.object)
    canvas.requestRenderAll()
    this.captureHistory()
    return objectId
  }

  selectObject(objectId: string): void {
    const object = this.findObject(objectId)
    if (!object || object.selectable === false) throw editorError('INVALID_ARGUMENT', 'Sticker is not selectable.')
    const canvas = this.requireCanvas()
    canvas.setActiveObject(object)
    canvas.requestRenderAll()
  }

  deleteObject(objectId: string): void {
    const canvas = this.requireCanvas()
    const object = this.findObject(objectId)
    if (!object || object.selectable === false) throw editorError('INVALID_ARGUMENT', 'Sticker cannot be deleted.')
    this.releaseObject(object)
    canvas.remove(object)
    canvas.discardActiveObject()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  deleteSelected(): void {
    const active = this.requireCanvas().getActiveObject()
    if (!active?.objectId) return
    this.deleteObject(active.objectId)
  }

  bringForward(objectId: string): void {
    this.moveLayer(objectId, (canvas, object) => canvas.bringForward(object))
  }

  sendBackward(objectId: string): void {
    this.moveLayer(objectId, (canvas, object) => canvas.sendBackwards(object))
  }

  bringToFront(objectId: string): void {
    this.moveLayer(objectId, (canvas, object) => canvas.bringToFront(object))
  }

  sendToBack(objectId: string): void {
    this.moveLayer(objectId, (canvas, object) => canvas.sendToBack(object))
  }

  async undo(): Promise<boolean> {
    if (this.historyIndex <= 0) return false
    this.historyIndex -= 1
    await this.restoreHistory(this.history[this.historyIndex])
    return true
  }

  async redo(): Promise<boolean> {
    if (this.historyIndex >= this.history.length - 1) return false
    this.historyIndex += 1
    await this.restoreHistory(this.history[this.historyIndex])
    return true
  }

  exportScene(): SceneDocument {
    const canvas = this.requireCanvas()
    const metadata = this.requireMetadata()
    const objects = canvas.getObjects().map((object, index) => fabricObjectToSceneObject(object, index + 1))
    const scene: SceneDocument = {
      ...metadata,
      schemaVersion: 1,
      canvas: {
        width: canvas.getWidth(),
        height: canvas.getHeight(),
        ...(this.backgroundColor ? { backgroundColor: this.backgroundColor } : {})
      },
      backgroundAssetId: this.backgroundAssetId,
      objects,
      updatedAt: nowUtc(this.now)
    }
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_VALIDATION_FAILED', 'Editor state cannot be serialized as SceneDocument.')
    return validation.value
  }

  exportPngDataUrl(): string {
    try {
      const value = this.requireCanvas().toDataURL({ format: 'png', multiplier: 1 })
      if (!value.startsWith('data:image/png')) throw new Error('Canvas did not return a PNG data URL.')
      return value
    } catch {
      throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
    }
  }

  async exportPng(): Promise<Blob> {
    const response = await fetch(this.exportPngDataUrl())
    if (!response.ok) throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
    return response.blob()
  }

  dispose(): void {
    const canvas = this.canvas
    if (!canvas) return
    for (const [eventName, listener] of this.listeners) canvas.off(eventName, listener)
    this.listeners.length = 0
    this.releaseCanvasResources(canvas)
    canvas.dispose()
    this.canvas = undefined
    this.history = []
    this.historyIndex = -1
    this.assetCache.clear()
    this.metadata = undefined
    this.backgroundAssetId = null
    this.backgroundColor = undefined
    this.resolver = undefined
  }

  private attachCanvasListeners(canvas: FabricCanvasPort): void {
    const scaling = (event: { target?: FabricObjectPort }) => {
      if (event.target?.objectId) this.enforceUniformScale(event.target)
    }
    const rotating = (event: { target?: FabricObjectPort }) => {
      if (event.target?.objectId) {
        event.target.set({ angle: normalizeSceneAngle(event.target.angle ?? 0) })
        event.target.setCoords()
      }
    }
    const modified = () => {
      if (!this.restoring) this.captureHistory()
    }
    for (const [eventName, listener] of [
      ['object:scaling', scaling],
      ['object:rotating', rotating],
      ['object:modified', modified]
    ] as const) {
      canvas.on(eventName, listener)
      this.listeners.push([eventName, listener])
    }
  }

  private async prepareScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<{
    background: { object: FabricObjectPort; release: () => void } | undefined
    objects: Array<{ object: FabricObjectPort; release: () => void }>
  }> {
    const background = scene.backgroundAssetId === null
      ? undefined
      : await this.loadResolvedAsset(scene.backgroundAssetId, scene.assetSnapshotId, 'background', resolver, this.backgroundOptionsForScene(scene))
    const objects: Array<{ object: FabricObjectPort; release: () => void }> = []
    try {
      for (const item of scene.objects) {
        objects.push(await this.loadResolvedAsset(item.assetId, scene.assetSnapshotId, 'sticker', resolver, sceneObjectOptions(item)))
      }
      return { background, objects }
    } catch (error) {
      background?.release()
      for (const object of objects) object.release()
      throw error
    }
  }

  private async loadResolvedAsset(
    assetId: string,
    snapshotId: string,
    expectedType: AssetRecord['type'],
    resolver: FabricEditorAssetResolver,
    options: Record<string, unknown>
  ): Promise<{ object: FabricObjectPort; release: () => void }> {
    let asset: AssetRecord
    try {
      asset = await resolver.resolveAsset(assetId, snapshotId)
    } catch {
      throw editorError('ASSET_NOT_FOUND', 'Scene material could not be resolved.')
    }
    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.assetId !== assetId || asset.type !== expectedType) {
      throw editorError('ASSET_SNAPSHOT_MISMATCH', 'Scene material does not match the requested snapshot item.')
    }
    this.assetCache.set(asset.assetId, asset)
    return this.loadEditorImage(asset, { ...options, assetId: asset.assetId })
  }

  private async loadEditorImage(asset: AssetRecord, options: Record<string, unknown>): Promise<{ object: FabricObjectPort; release: () => void }> {
    let resource: LoadedResource | undefined
    try {
      resource = await this.loadResource(asset.imageUrl)
      const object = await this.runtime.createImage(resource.sourceUrl, options)
      return { object, release: resource.dispose }
    } catch (error) {
      resource?.dispose()
      if (isSharedError(error)) throw error
      throw editorError('ASSET_NOT_FOUND', 'Material image could not be loaded.')
    }
  }

  private backgroundOptions(canvas: FabricCanvasPort): Record<string, unknown> {
    return {
      originX: 'center',
      originY: 'center',
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      selectable: false,
      evented: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true
    }
  }

  private backgroundOptionsForScene(scene: SceneDocument): Record<string, unknown> {
    return {
      originX: 'center',
      originY: 'center',
      left: scene.canvas.width / 2,
      top: scene.canvas.height / 2,
      selectable: false,
      evented: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true
    }
  }

  private moveLayer(objectId: string, action: (canvas: FabricCanvasPort, object: FabricObjectPort) => unknown): void {
    const canvas = this.requireCanvas()
    const object = this.findObject(objectId)
    if (!object || object.selectable === false) throw editorError('INVALID_ARGUMENT', 'Sticker layer cannot be changed.')
    action(canvas, object)
    canvas.requestRenderAll()
    this.captureHistory()
  }

  private enforceUniformScale(object: FabricObjectPort): void {
    const scale = object.scaleX ?? object.scaleY ?? DEFAULT_STICKER_SCALE
    const normalized = Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_STICKER_SCALE
    object.set({ scaleX: normalized, scaleY: normalized })
    object.setCoords()
  }

  private fitBackground(object: FabricObjectPort, canvas: FabricCanvasPort): void {
    if (typeof object.width !== 'number' || typeof object.height !== 'number' || object.width <= 0 || object.height <= 0) return
    const scale = Math.max(canvas.getWidth() / object.width, canvas.getHeight() / object.height)
    object.set({
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      scaleX: scale,
      scaleY: scale
    })
    object.setCoords()
  }

  private findObject(objectId: string): FabricObjectPort | undefined {
    return this.requireCanvas().getObjects().find((object) => object.objectId === objectId)
  }

  private captureHistory(): void {
    if (this.restoring || !this.metadata || !this.canvas) return
    const entry = { scene: this.exportScene() }
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(entry)
    this.historyIndex = this.history.length - 1
  }

  private resetHistory(): void {
    this.history = [{ scene: this.exportScene() }]
    this.historyIndex = 0
  }

  private async restoreHistory(entry: HistoryEntry): Promise<void> {
    const resolver = this.resolver ?? {
      resolveAsset: async (assetId: string): Promise<AssetRecord> => {
        const asset = this.assetCache.get(assetId)
        if (!asset) throw editorError('ASSET_NOT_FOUND', 'History material is unavailable.')
        return asset
      }
    }
    const history = this.history
    const historyIndex = this.historyIndex
    await this.importScene(entry.scene, resolver)
    this.history = history
    this.historyIndex = historyIndex
  }

  private releaseBackground(canvas: FabricCanvasPort): void {
    if (canvas.backgroundImage) this.releaseObject(canvas.backgroundImage)
  }

  private releaseCanvasResources(canvas: FabricCanvasPort): void {
    this.releaseBackground(canvas)
    for (const object of canvas.getObjects()) this.releaseObject(object)
  }

  private releaseObject(object: FabricObjectPort): void {
    const release = this.objectResources.get(object)
    if (release) {
      this.objectResources.delete(object)
      release()
    }
  }

  private requireCanvas(): FabricCanvasPort {
    if (!this.canvas) throw editorError('INVALID_ARGUMENT', 'Editor canvas has not been initialized.')
    return this.canvas
  }

  private requireMetadata(): EditorSceneMetadata {
    if (!this.metadata) throw editorError('INVALID_ARGUMENT', 'Editor scene metadata has not been initialized.')
    return this.metadata
  }
}

function metadataFromScene(scene: SceneDocument): EditorSceneMetadata {
  return {
    schemaVersion: scene.schemaVersion,
    sceneId: scene.sceneId,
    userId: scene.userId,
    workName: scene.workName,
    themeId: scene.themeId,
    assetSnapshotId: scene.assetSnapshotId,
    createdAt: scene.createdAt
  }
}

function sceneObjectOptions(sceneObject: SceneObject): Record<string, unknown> {
  return {
    objectId: sceneObject.objectId,
    assetId: sceneObject.assetId,
    assetType: 'sticker',
    originX: 'center',
    originY: 'center',
    left: sceneObject.left,
    top: sceneObject.top,
    scaleX: sceneObject.scaleX,
    scaleY: sceneObject.scaleY,
    angle: normalizeSceneAngle(sceneObject.angle),
    visible: sceneObject.visible,
    selectable: !sceneObject.locked,
    evented: !sceneObject.locked,
    lockMovementX: sceneObject.locked,
    lockMovementY: sceneObject.locked,
    lockScalingX: sceneObject.locked,
    lockScalingY: sceneObject.locked,
    lockUniScaling: true,
    lockRotation: sceneObject.locked
  }
}

function fabricObjectToSceneObject(object: FabricObjectPort, zIndex: number): SceneObject {
  if (!object.objectId || !object.assetId || object.assetType !== 'sticker') {
    throw editorError('SCENE_VALIDATION_FAILED', 'Canvas contains a non-sticker object.')
  }
  const scale = object.scaleX ?? object.scaleY
  if (!Number.isFinite(scale) || !scale || scale <= 0) {
    throw editorError('SCENE_VALIDATION_FAILED', 'Sticker scale is invalid.')
  }
  return {
    objectId: object.objectId,
    assetId: object.assetId,
    assetType: 'sticker',
    left: finiteOrThrow(object.left, 'Sticker position is invalid.'),
    top: finiteOrThrow(object.top, 'Sticker position is invalid.'),
    scaleX: scale,
    scaleY: scale,
    angle: normalizeSceneAngle(object.angle ?? 0),
    zIndex,
    visible: object.visible !== false,
    locked: object.selectable === false
  }
}

function finiteOrThrow(value: number | undefined, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw editorError('SCENE_VALIDATION_FAILED', message)
  return value
}

function isSharedError(value: unknown): value is SharedError {
  return value !== null && typeof value === 'object' && 'code' in value && 'message' in value && 'retryable' in value
}
