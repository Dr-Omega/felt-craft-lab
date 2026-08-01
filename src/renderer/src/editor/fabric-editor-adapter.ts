import { fabric } from 'fabric'
import type {
  AssetAccessState,
  AssetRecord,
  SceneDocument,
  SceneObject,
  SceneSnapshotValidationContext,
  SharedError
} from '@shared/contracts'
import {
  validateAssetAccessState,
  validateAssetRecord,
  validateSceneDocument,
  validateSceneDocumentAgainstSnapshot,
  validateSceneSnapshotValidationContext
} from '@shared/contracts'
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
  createPlaceholder(options: Record<string, unknown>): FabricObjectPort
}

export interface FabricEditorAssetResolver {
  resolveAsset(assetId: string, assetSnapshotId: string): Promise<AssetRecord>
}

export interface FabricEditorAdapterOptions {
  /** Immutable Manifest snapshot index supplied by the resource layer. */
  snapshotContext: SceneSnapshotValidationContext
  /** Test-only assets are rejected unless this flag is explicitly enabled. */
  allowTestAssets?: boolean
  now?: () => Date
  createObjectId?: () => string
  loadResource?: (ref: string) => Promise<LoadedResource>
  runtime?: FabricEditorRuntime
}

export interface SceneRecoveryIssue {
  code: 'ASSET_NOT_FOUND' | 'ASSET_SNAPSHOT_MISMATCH'
  message: string
  assetId?: string
  assetType?: 'background' | 'sticker'
  objectId?: string
}

export interface SceneImportResult {
  /** Resource problems are rendered as locked placeholders; they are never silently removed. */
  issues: readonly SceneRecoveryIssue[]
}

type EditorSceneMetadata = Omit<SceneDocument, 'canvas' | 'backgroundAssetId' | 'objects' | 'updatedAt'>

interface HistoryEntry {
  scene: SceneDocument
}

interface PreparedCanvasObject {
  object: FabricObjectPort
  release: () => void
}

interface PreparedScene {
  background: PreparedCanvasObject | undefined
  objects: PreparedCanvasObject[]
  issues: SceneRecoveryIssue[]
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
  },
  createPlaceholder(options) {
    return new fabric.Rect({
      fill: '#D9D9D9',
      stroke: '#8A8A8A',
      strokeWidth: 2,
      width: 96,
      height: 96,
      ...options
    }) as unknown as FabricObjectPort
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
  private readonly snapshotContext: SceneSnapshotValidationContext
  private readonly snapshotAssetsById: Map<string, ReadonlyMap<string, { assetId: string; type: 'background' | 'sticker' }>>
  private readonly objectResources = new WeakMap<FabricObjectPort, () => void>()
  private readonly recoveryPlaceholders = new WeakSet<FabricObjectPort>()
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
  private recoveryIssues: SceneRecoveryIssue[] = []
  private operationGeneration = 0

  constructor(options: FabricEditorAdapterOptions) {
    const snapshotContext = validateSceneSnapshotValidationContext(options.snapshotContext)
    if (!snapshotContext.ok) throw editorError('INVALID_ARGUMENT', 'Editor snapshot context failed validation.')
    this.runtime = options.runtime ?? defaultRuntime
    this.loadResource = options.loadResource ?? defaultLoadResource
    this.now = options.now ?? (() => new Date())
    this.createObjectId = options.createObjectId ?? createUuid
    this.allowTestAssets = options.allowTestAssets ?? false
    this.snapshotContext = snapshotContext.value
    this.snapshotAssetsById = new Map(
      Object.entries(this.snapshotContext.snapshots).map(([snapshotId, assets]) => [
        snapshotId,
        new Map(assets.map((asset) => [asset.assetId, asset]))
      ])
    )
  }

  initialize(element: HTMLCanvasElement, scene: SceneDocument): void {
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_VALIDATION_FAILED', 'Scene document failed validation.')
    this.dispose()

    this.metadata = metadataFromScene(scene)
    this.backgroundAssetId = scene.backgroundAssetId
    this.backgroundColor = scene.canvas.backgroundColor
    this.canvas = this.runtime.createCanvas(element, scene.canvas.width, scene.canvas.height)
    this.recoveryIssues = this.snapshotAssetsById.has(scene.assetSnapshotId)
      ? []
      : [{ code: 'ASSET_SNAPSHOT_MISMATCH', message: 'Scene asset snapshot is unavailable.' }]
    this.attachCanvasListeners(this.canvas)
  }

  async importScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<SceneImportResult> {
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_IMPORT_FAILED', 'Scene document failed validation.')
    const canvas = this.requireCanvas()
    const operation = this.beginOperation(canvas)
    this.resolver = resolver

    const prepared = await this.prepareScene(scene, resolver, operation, canvas)
    if (!this.isCurrentOperation(operation, canvas)) {
      this.releasePreparedScene(prepared)
      throw editorError('REQUEST_CANCELLED', 'Scene import was superseded.')
    }
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
      this.recoveryIssues = prepared.issues
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      this.resetHistory()
      return { issues: [...prepared.issues] }
    } finally {
      this.restoring = false
    }
  }

  async setBackground(asset: AssetRecord | null, access?: AssetAccessState): Promise<void> {
    const canvas = this.requireCanvas()
    const metadata = this.requireMetadata()
    const operation = this.beginOperation(canvas)
    if (asset === null) {
      const previousBackgroundAssetId = this.backgroundAssetId
      this.releaseBackground(canvas)
      canvas.setBackgroundImage(null, () => undefined)
      this.backgroundAssetId = null
      if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
      canvas.requestRenderAll()
      this.captureHistory()
      return
    }

    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.type !== 'background') throw editorError('ASSET_TYPE_INVALID', 'Only background assets can be used as a background.')
    throwIfInvalidAccess(asset, access, metadata.userId)
    this.assertAssetInCurrentSnapshot(asset)
    this.assetCache.set(asset.assetId, asset)

    const loaded = await this.loadEditorImage(asset, this.backgroundOptions(canvas), operation, canvas)
    this.fitBackground(loaded.object, canvas)
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(loaded.object, () => undefined)
    this.objectResources.set(loaded.object, loaded.release)
    this.backgroundAssetId = asset.assetId
    this.clearRecoveryIssues('background')
    canvas.requestRenderAll()
    this.captureHistory()
  }

  resizeCanvas(width: number, height: number): void {
    const canvas = this.requireCanvas()
    this.beginOperation(canvas)
    this.assertProspectiveScene({ width, height })
    canvas.setWidth(width)
    canvas.setHeight(height)
    if (canvas.backgroundImage) this.fitBackground(canvas.backgroundImage, canvas)
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setSolidBackground(color: string): void {
    const canvas = this.requireCanvas()
    this.beginOperation(canvas)
    this.assertProspectiveScene({ backgroundColor: color, backgroundAssetId: null })
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = color
    this.backgroundColor = color
    this.backgroundAssetId = null
    if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setTransparentBackground(): void {
    const canvas = this.requireCanvas()
    this.beginOperation(canvas)
    this.assertProspectiveScene({ clearBackgroundColor: true, backgroundAssetId: null })
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = undefined
    this.backgroundColor = undefined
    this.backgroundAssetId = null
    if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number }): Promise<string> {
    const canvas = this.requireCanvas()
    const metadata = this.requireMetadata()
    const operation = this.beginOperation(canvas)
    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.type !== 'sticker') throw editorError('ASSET_TYPE_INVALID', 'Only sticker assets can be added as stickers.')
    throwIfInvalidAccess(asset, access, metadata.userId)
    this.assertAssetInCurrentSnapshot(asset)
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
    }, operation, canvas)
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
    if (!object || (object.selectable === false && !this.recoveryPlaceholders.has(object))) {
      throw editorError('INVALID_ARGUMENT', 'Sticker cannot be deleted.')
    }
    const recoveryAssetId = this.recoveryPlaceholders.has(object) ? object.assetId : undefined
    const recoveryObjectId = this.recoveryPlaceholders.has(object) ? object.objectId : undefined
    this.releaseObject(object)
    canvas.remove(object)
    canvas.discardActiveObject()
    if (recoveryAssetId && recoveryObjectId) {
      this.clearRecoveryIssueIfResolved(recoveryAssetId, 'sticker', recoveryObjectId)
    }
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
    const scene = this.serializeScene()
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_VALIDATION_FAILED', 'Editor state cannot be serialized as SceneDocument.')
    const snapshotValidation = validateSceneDocumentAgainstSnapshot(validation.value, this.snapshotContext)
    if (!snapshotValidation.ok || this.recoveryIssues.length > 0) {
      throw editorError('SCENE_VALIDATION_FAILED', 'Scene has unresolved asset snapshot or resource recovery issues.')
    }
    return snapshotValidation.value
  }

  /** Returns the currently outstanding, explicitly actionable recovery issues. */
  getRecoveryIssues(): readonly SceneRecoveryIssue[] {
    return this.recoveryIssues.map((issue) => ({ ...issue }))
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
    this.operationGeneration += 1
    const canvas = this.canvas
    if (!canvas) {
      this.recoveryIssues = []
      return
    }
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
    this.recoveryIssues = []
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

  private async prepareScene(
    scene: SceneDocument,
    resolver: FabricEditorAssetResolver,
    operation: number,
    canvas: FabricCanvasPort
  ): Promise<PreparedScene> {
    const issues: SceneRecoveryIssue[] = []
    const snapshotAssets = this.snapshotAssetsById.get(scene.assetSnapshotId)
    if (!snapshotAssets) {
      issues.push({ code: 'ASSET_SNAPSHOT_MISMATCH', message: 'Scene asset snapshot is unavailable.' })
    }
    const background = scene.backgroundAssetId === null
      ? undefined
      : await this.loadSceneAssetOrPlaceholder(
        scene.backgroundAssetId,
        'background',
        scene.assetSnapshotId,
        resolver,
        this.backgroundOptionsForScene(scene),
        snapshotAssets,
        issues,
        operation,
        canvas
      )
    const objects: PreparedCanvasObject[] = []
    try {
      for (const item of scene.objects) {
        objects.push(await this.loadSceneAssetOrPlaceholder(
          item.assetId,
          'sticker',
          scene.assetSnapshotId,
          resolver,
          sceneObjectOptions({ ...item, locked: item.locked }),
          snapshotAssets,
          issues,
          operation,
          canvas
        ))
      }
      return { background, objects, issues }
    } catch (error) {
      if (background) background.release()
      for (const object of objects) object.release()
      throw error
    }
  }

  private async loadSceneAssetOrPlaceholder(
    assetId: string,
    expectedType: 'background' | 'sticker',
    snapshotId: string,
    resolver: FabricEditorAssetResolver,
    options: Record<string, unknown>,
    snapshotAssets: ReadonlyMap<string, { assetId: string; type: 'background' | 'sticker' }> | undefined,
    issues: SceneRecoveryIssue[],
    operation: number,
    canvas: FabricCanvasPort
  ): Promise<PreparedCanvasObject> {
    const snapshotAsset = snapshotAssets?.get(assetId)
    if (!snapshotAsset || snapshotAsset.type !== expectedType) {
      issues.push({
        code: 'ASSET_SNAPSHOT_MISMATCH',
        message: 'Scene asset does not match its immutable snapshot.',
        assetId,
        assetType: expectedType,
        ...(typeof options.objectId === 'string' ? { objectId: options.objectId } : {})
      })
      return this.createPlaceholder(assetId, expectedType, options)
    }
    try {
      return await this.loadResolvedAsset(assetId, snapshotId, expectedType, resolver, options, operation, canvas)
    } catch (error) {
      if (isRequestCancelled(error)) throw error
      issues.push({
        code: isSharedError(error) && error.code === 'ASSET_SNAPSHOT_MISMATCH' ? 'ASSET_SNAPSHOT_MISMATCH' : 'ASSET_NOT_FOUND',
        message: 'Scene asset could not be loaded and was restored as a locked placeholder.',
        assetId,
        assetType: expectedType,
        ...(typeof options.objectId === 'string' ? { objectId: options.objectId } : {})
      })
      return this.createPlaceholder(assetId, expectedType, options)
    }
  }

  private async loadResolvedAsset(
    assetId: string,
    snapshotId: string,
    expectedType: AssetRecord['type'],
    resolver: FabricEditorAssetResolver,
    options: Record<string, unknown>,
    operation: number,
    canvas: FabricCanvasPort
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
    return this.loadEditorImage(asset, { ...options, assetId: asset.assetId }, operation, canvas)
  }

  private async loadEditorImage(
    asset: AssetRecord,
    options: Record<string, unknown>,
    operation: number,
    canvas: FabricCanvasPort
  ): Promise<PreparedCanvasObject> {
    let resource: LoadedResource | undefined
    try {
      resource = await this.loadResource(asset.imageUrl)
      this.ensureCurrentOperation(operation, canvas)
      const object = await this.runtime.createImage(resource.sourceUrl, options)
      this.ensureCurrentOperation(operation, canvas)
      return { object, release: resource.dispose }
    } catch (error) {
      resource?.dispose()
      if (isSharedError(error)) throw error
      throw editorError('ASSET_NOT_FOUND', 'Material image could not be loaded.')
    }
  }

  private createPlaceholder(
    assetId: string,
    assetType: 'background' | 'sticker',
    options: Record<string, unknown>
  ): PreparedCanvasObject {
    const object = this.runtime.createPlaceholder({
      ...options,
      assetId,
      ...(assetType === 'sticker' ? { assetType: 'sticker' as const } : {}),
      selectable: false,
      evented: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true
    })
    this.recoveryPlaceholders.add(object)
    return { object, release: () => undefined }
  }

  private clearRecoveryIssues(assetType: 'background' | 'sticker'): void {
    this.recoveryIssues = this.recoveryIssues.filter((issue) => issue.assetType !== assetType)
  }

  private clearRecoveryIssueIfResolved(assetId: string, assetType: 'background' | 'sticker', objectId?: string): void {
    if (assetType === 'sticker') {
      if (!objectId) return
      const stillPresent = this.requireCanvas().getObjects().some((object) =>
        object.objectId === objectId && object.assetId === assetId && this.recoveryPlaceholders.has(object)
      )
      if (!stillPresent) {
        this.recoveryIssues = this.recoveryIssues.filter((issue) =>
          !(issue.assetType === 'sticker' && issue.objectId === objectId)
        )
      }
      return
    }
    const background = this.canvas?.backgroundImage
    const stillPresent = background?.assetId === assetId && this.recoveryPlaceholders.has(background)
    if (!stillPresent) {
      this.recoveryIssues = this.recoveryIssues.filter((issue) => !(issue.assetId === assetId && issue.assetType === assetType))
    }
  }

  private assertAssetInCurrentSnapshot(asset: AssetRecord): void {
    const metadata = this.requireMetadata()
    const snapshotAssets = this.snapshotAssetsById.get(metadata.assetSnapshotId)
    const snapshotAsset = snapshotAssets?.get(asset.assetId)
    if (!snapshotAsset || snapshotAsset.type !== asset.type) {
      throw editorError('ASSET_SNAPSHOT_MISMATCH', 'Material does not belong to the scene asset snapshot.')
    }
  }

  private assertProspectiveScene(change: {
    width?: number
    height?: number
    backgroundColor?: string
    clearBackgroundColor?: boolean
    backgroundAssetId?: string | null
  }): void {
    const current = this.serializeScene()
    const candidate: SceneDocument = {
      ...current,
      canvas: {
        width: change.width ?? current.canvas.width,
        height: change.height ?? current.canvas.height,
        ...(change.clearBackgroundColor
          ? {}
          : change.backgroundColor === undefined
            ? (current.canvas.backgroundColor === undefined ? {} : { backgroundColor: current.canvas.backgroundColor })
            : { backgroundColor: change.backgroundColor })
      },
      backgroundAssetId: 'backgroundAssetId' in change ? change.backgroundAssetId ?? null : current.backgroundAssetId
    }
    const validation = validateSceneDocument(candidate)
    if (!validation.ok) throw editorError('INVALID_ARGUMENT', 'Canvas state change violates SceneDocument constraints.')
  }

  private beginOperation(canvas: FabricCanvasPort): number {
    this.operationGeneration += 1
    return this.operationGeneration
  }

  private isCurrentOperation(operation: number, canvas: FabricCanvasPort): boolean {
    return this.operationGeneration === operation && this.canvas === canvas
  }

  private ensureCurrentOperation(operation: number, canvas: FabricCanvasPort): void {
    if (!this.isCurrentOperation(operation, canvas)) {
      throw editorError('REQUEST_CANCELLED', 'Editor operation was superseded.')
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
    const entry = { scene: this.serializeScene() }
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(entry)
    this.historyIndex = this.history.length - 1
  }

  private resetHistory(): void {
    this.history = [{ scene: this.serializeScene() }]
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

  private releasePreparedScene(prepared: PreparedScene): void {
    prepared.background?.release()
    for (const object of prepared.objects) object.release()
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

  private serializeScene(): SceneDocument {
    const canvas = this.requireCanvas()
    const metadata = this.requireMetadata()
    return {
      ...metadata,
      schemaVersion: 1,
      canvas: {
        width: canvas.getWidth(),
        height: canvas.getHeight(),
        ...(this.backgroundColor === undefined ? {} : { backgroundColor: this.backgroundColor })
      },
      backgroundAssetId: this.backgroundAssetId,
      objects: canvas.getObjects().map((object, index) => fabricObjectToSceneObject(object, index + 1)),
      updatedAt: nowUtc(this.now)
    }
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

function isRequestCancelled(value: unknown): boolean {
  return isSharedError(value) && value.code === 'REQUEST_CANCELLED'
}
