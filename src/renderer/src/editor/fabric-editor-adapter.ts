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
  calcOffset(): unknown
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
  lockScalingFlip?: boolean
  lockSkewingX?: boolean
  lockSkewingY?: boolean
  lockRotation?: boolean
  flipX?: boolean
  flipY?: boolean
  skewX?: number
  skewY?: number
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

type AsyncOperationKind = 'import' | 'background' | 'sticker'

interface AsyncOperation {
  canvas: FabricCanvasPort
  sceneGeneration: number
  requestGeneration: number
  kind: AsyncOperationKind
}

interface PreparedCanvasObject {
  object: FabricObjectPort
  release: () => void
}

interface PreparedScene {
  background: PreparedCanvasObject | undefined
  objects: PreparedCanvasObject[]
  issues: SceneRecoveryIssue[]
  assets: Map<string, AssetRecord>
}

const DEFAULT_STICKER_SCALE = 1
export const STICKER_SAFE_EDGE_MARGIN = 24
export const STICKER_ROTATION_CONTROL_OFFSET = 40
export const STICKER_INITIAL_MAX_WIDTH_RATIO = 0.5
export const STICKER_INITIAL_MAX_HEIGHT_RATIO = 0.5
export const FABRIC_EDITOR_HISTORY_LIMIT = 100

/**
 * Calculates the persisted transform for a newly created Sticker only.
 * Existing SceneDocument objects always retain their saved transform.
 */
export function calculateStickerInitialScale(
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number | undefined,
  imageHeight: number | undefined
): number {
  if (
    typeof imageWidth !== 'number'
    || !Number.isFinite(imageWidth)
    || imageWidth <= 0
    || typeof imageHeight !== 'number'
    || !Number.isFinite(imageHeight)
    || imageHeight <= 0
  ) {
    throw editorError('ASSET_NOT_FOUND', 'Material image dimensions are invalid.')
  }

  const safeWidth = canvasWidth - STICKER_SAFE_EDGE_MARGIN * 2
  const verticalInset = STICKER_SAFE_EDGE_MARGIN + STICKER_ROTATION_CONTROL_OFFSET
  const safeHeight = canvasHeight - verticalInset * 2
  const productWidth = canvasWidth * STICKER_INITIAL_MAX_WIDTH_RATIO
  const productHeight = canvasHeight * STICKER_INITIAL_MAX_HEIGHT_RATIO
  const maxWidth = Math.max(1, Math.min(safeWidth, productWidth))
  const maxHeight = Math.max(1, Math.min(safeHeight, productHeight))
  const scale = Math.min(DEFAULT_STICKER_SCALE, maxWidth / imageWidth, maxHeight / imageHeight)

  if (!Number.isFinite(scale) || scale <= 0) {
    throw editorError('ASSET_NOT_FOUND', 'Material image dimensions are invalid.')
  }
  return scale
}

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
        // Fabric 5.3.0: fromURL callback signature is (image, isError) in some builds.
        // Guard the ghost-Image regression where a failed load still produces an
        // image with `_element=null`, `width=0`, `height=0`. Such ghost images
        // would otherwise reach the canvas and propagate NaN coordinates on drag.
        const fromURL = fabric.Image.fromURL as unknown as (
          url: string,
          callback: (imageOrError: unknown, isError?: boolean) => void,
          options?: Record<string, unknown>
        ) => void
        fromURL(sourceUrl, (imageOrError, isError) => {
          const image = imageOrError as
            | (FabricObjectPort & { set: (options: Record<string, unknown>) => unknown })
            | { set?: (options: Record<string, unknown>) => unknown; width?: unknown; height?: unknown }
            | null
          const error = validateFabricFromURLResult(imageOrError, isError, image)
          if (error) {
            reject(error)
            return
          }
          if (!image || typeof image.set !== 'function') {
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

/**
 * Validates the result of `fabric.Image.fromURL`. Returns an `ASSET_NOT_FOUND`
 * `SharedError` when:
 * - the Fabric 5.3.0 callback reports `isError=true` (signals a load failure);
 * - the `image` argument is missing or not a Fabric object (no `set` method);
 * - `width` or `height` is not a finite positive number (ghost-image regression
 *   where a failed load still produces an Image with `width=0`, `height=0`).
 *
 * Returns `null` when the image is safe to add to the canvas.
 */
export function validateFabricFromURLResult(
  imageOrError: unknown,
  isError: unknown,
  image: { set?: unknown; width?: unknown; height?: unknown } | null = imageOrError as { set?: unknown; width?: unknown; height?: unknown } | null
): SharedError | null {
  if (isError === true) {
    return editorError('ASSET_NOT_FOUND', 'Material image could not be loaded.')
  }
  if (!image || typeof image.set !== 'function') {
    return editorError('ASSET_NOT_FOUND', 'Material image could not be loaded.')
  }
  const width = image.width
  const height = image.height
  if (
    typeof width !== 'number' || !Number.isFinite(width) || width <= 0
    || typeof height !== 'number' || !Number.isFinite(height) || height <= 0
  ) {
    return editorError('ASSET_NOT_FOUND', 'Material image could not be loaded.')
  }
  return null
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
  private sceneGeneration = 0
  private importRequestGeneration = 0
  private backgroundRequestGeneration = 0
  private stickerRequestGeneration = 0
  private sceneReady = false
  private committedSceneReady = false
  private historyRestoreGeneration = 0
  private activeHistoryRestoreGeneration: number | undefined

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
    this.sceneReady = false
    this.committedSceneReady = false
    this.attachCanvasListeners(this.canvas)
  }

  async importScene(scene: SceneDocument, resolver: FabricEditorAssetResolver): Promise<SceneImportResult> {
    return this.importSceneInternal(scene, resolver)
  }

  private async importSceneInternal(
    scene: SceneDocument,
    resolver: FabricEditorAssetResolver,
    historyRestoreGeneration?: number
  ): Promise<SceneImportResult> {
    const validation = validateSceneDocument(scene)
    if (!validation.ok) throw editorError('SCENE_IMPORT_FAILED', 'Scene document failed validation.')
    const canvas = this.requireCanvas()
    const operation = this.beginSceneTransition(canvas, historyRestoreGeneration)
    try {
      const prepared = await this.prepareScene(scene, resolver, operation, canvas)
      if (!this.isCurrentOperation(operation)) {
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
        this.resolver = resolver
        this.assetCache.clear()
        for (const [assetId, asset] of prepared.assets) this.assetCache.set(assetId, asset)
        this.sceneReady = true
        this.committedSceneReady = true
        canvas.calcOffset()
        canvas.discardActiveObject()
        canvas.requestRenderAll()
        this.resetHistory()
        return { issues: [...prepared.issues] }
      } finally {
        this.restoring = false
      }
    } catch (error) {
      if (this.isCurrentOperation(operation)) this.sceneReady = this.committedSceneReady
      throw error
    }
  }

  async setBackground(asset: AssetRecord | null, access?: AssetAccessState): Promise<void> {
    const canvas = this.requireReadyCanvas()
    const metadata = this.requireMetadata()
    if (asset === null) {
      this.backgroundRequestGeneration += 1
      const previousBackgroundAssetId = this.backgroundAssetId
      this.releaseBackground(canvas)
      canvas.setBackgroundImage(null, () => undefined)
      this.backgroundAssetId = null
      if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
      canvas.calcOffset()
      canvas.requestRenderAll()
      this.captureHistory()
      return
    }

    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.type !== 'background') throw editorError('ASSET_TYPE_INVALID', 'Only background assets can be used as a background.')
    throwIfInvalidAccess(asset, access, metadata.userId)
    this.assertAssetInCurrentSnapshot(asset)
    const operation = this.beginAsyncOperation('background', canvas)
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
    const canvas = this.requireReadyCanvas()
    this.assertProspectiveScene({ width, height })
    canvas.setWidth(width)
    canvas.setHeight(height)
    canvas.calcOffset()
    if (canvas.backgroundImage) this.fitBackground(canvas.backgroundImage, canvas)
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setSolidBackground(color: string): void {
    const canvas = this.requireReadyCanvas()
    this.assertProspectiveScene({ backgroundColor: color, backgroundAssetId: null })
    this.backgroundRequestGeneration += 1
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = color
    this.backgroundColor = color
    this.backgroundAssetId = null
    if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setTransparentBackground(): void {
    const canvas = this.requireReadyCanvas()
    this.assertProspectiveScene({ clearBackgroundColor: true, backgroundAssetId: null })
    this.backgroundRequestGeneration += 1
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = undefined
    this.backgroundColor = undefined
    this.backgroundAssetId = null
    if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number }): Promise<string> {
    const canvas = this.requireReadyCanvas()
    const metadata = this.requireMetadata()
    throwIfInvalidAsset(asset, this.allowTestAssets)
    if (asset.type !== 'sticker') throw editorError('ASSET_TYPE_INVALID', 'Only sticker assets can be added as stickers.')
    throwIfInvalidAccess(asset, access, metadata.userId)
    this.assertAssetInCurrentSnapshot(asset)
    const operation = this.beginAsyncOperation('sticker', canvas)
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
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true,
      lockRotation: false,
      lockMovementX: false,
      lockMovementY: false
    }, operation, canvas)
    if (position === undefined) {
      try {
        const scale = calculateStickerInitialScale(
          canvas.getWidth(),
          canvas.getHeight(),
          loaded.object.width,
          loaded.object.height
        )
        loaded.object.set({
          left: canvas.getWidth() / 2,
          top: canvas.getHeight() / 2,
          scaleX: scale,
          scaleY: scale
        })
        loaded.object.setCoords()
      } catch (error) {
        loaded.release()
        throw error
      }
    }
    canvas.add(loaded.object)
    this.objectResources.set(loaded.object, loaded.release)
    canvas.setActiveObject(loaded.object)
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
    return objectId
  }

  selectObject(objectId: string): void {
    this.requireReadyCanvas()
    const object = this.findObject(objectId)
    if (!object || object.selectable === false) throw editorError('INVALID_ARGUMENT', 'Sticker is not selectable.')
    const canvas = this.requireCanvas()
    canvas.setActiveObject(object)
    canvas.calcOffset()
    canvas.requestRenderAll()
  }

  deleteObject(objectId: string): void {
    const canvas = this.requireReadyCanvas()
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
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  deleteSelected(): void {
    const active = this.requireReadyCanvas().getActiveObject()
    if (!active?.objectId) return
    // Ordinary UI delete must not clear Recovery placeholders (explicit deleteObject still may).
    if (this.recoveryPlaceholders.has(active) || active.selectable === false) return
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

  bringSelectedForward(): void {
    this.withSelectedLayerObject((objectId) => this.bringForward(objectId))
  }

  sendSelectedBackward(): void {
    this.withSelectedLayerObject((objectId) => this.sendBackward(objectId))
  }

  bringSelectedToFront(): void {
    this.withSelectedLayerObject((objectId) => this.bringToFront(objectId))
  }

  sendSelectedToBack(): void {
    this.withSelectedLayerObject((objectId) => this.sendToBack(objectId))
  }

  async undo(): Promise<boolean> {
    this.requireReadyCanvas()
    if (this.historyIndex <= 0) return false
    const previousIndex = this.historyIndex
    const target = this.history[previousIndex - 1]
    await this.restoreHistory(target)
    this.historyIndex = previousIndex - 1
    return true
  }

  async redo(): Promise<boolean> {
    this.requireReadyCanvas()
    if (this.historyIndex >= this.history.length - 1) return false
    const previousIndex = this.historyIndex
    const target = this.history[previousIndex + 1]
    await this.restoreHistory(target)
    this.historyIndex = previousIndex + 1
    return true
  }

  exportScene(): SceneDocument {
    this.requireReadyCanvas()
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
      const value = this.requireReadyCanvas().toDataURL({ format: 'png', multiplier: 1 })
      if (!value.startsWith('data:image/png')) throw new Error('Canvas did not return a PNG data URL.')
      return value
    } catch {
      throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
    }
  }

  async exportPng(): Promise<Blob> {
    // Convert the PNG data URL directly to a Blob. The previous `fetch(data:...)`
    // path is unreliable under Electron CSP: `connect-src` can refuse data URLs,
    // which silently breaks preview export in the renderer.
    const dataUrl = this.exportPngDataUrl()
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!match) {
      throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
    }
    let buffer: ArrayBuffer
    try {
      const binary = atob(match[1])
      const length = binary.length
      if (length === 0) {
        throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
      }
      buffer = new ArrayBuffer(length)
      const view = new Uint8Array(buffer)
      for (let index = 0; index < length; index += 1) {
        view[index] = binary.charCodeAt(index)
      }
    } catch (error) {
      if (isSharedError(error)) throw error
      throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
    }
    return new Blob([buffer], { type: 'image/png' })
  }

  dispose(): void {
    this.sceneGeneration += 1
    this.sceneReady = false
    this.committedSceneReady = false
    this.activeHistoryRestoreGeneration = undefined
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
    operation: AsyncOperation,
    canvas: FabricCanvasPort
  ): Promise<PreparedScene> {
    const issues: SceneRecoveryIssue[] = []
    const assets = new Map<string, AssetRecord>()
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
        canvas,
        assets
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
          canvas,
          assets
        ))
      }
      return { background, objects, issues, assets }
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
    operation: AsyncOperation,
    canvas: FabricCanvasPort,
    assets: Map<string, AssetRecord>
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
      return await this.loadResolvedAsset(assetId, snapshotId, expectedType, resolver, options, operation, canvas, assets)
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
    operation: AsyncOperation,
    canvas: FabricCanvasPort,
    assets: Map<string, AssetRecord>
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
    assets.set(asset.assetId, asset)
    return this.loadEditorImage(asset, { ...options, assetId: asset.assetId }, operation, canvas)
  }

  private async loadEditorImage(
    asset: AssetRecord,
    options: Record<string, unknown>,
    operation: AsyncOperation,
    canvas: FabricCanvasPort
  ): Promise<PreparedCanvasObject> {
    let resource: LoadedResource | undefined
    try {
      resource = await this.loadResource(asset.imageUrl)
      this.ensureCurrentOperation(operation)
      const object = await this.runtime.createImage(resource.sourceUrl, options)
      this.ensureCurrentOperation(operation)
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
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true,
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
    // Reject latest AssetRecord silently mixed into a historical Scene (same assetId, different snapshot).
    const marker = `/${metadata.assetSnapshotId}/`
    if (!asset.imageUrl.includes(marker)) {
      throw editorError(
        'ASSET_SNAPSHOT_MISMATCH',
        'Material ResourceRef does not match the scene asset snapshot.'
      )
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

  private beginSceneTransition(canvas: FabricCanvasPort, historyRestoreGeneration?: number): AsyncOperation {
    if (historyRestoreGeneration === undefined) this.activeHistoryRestoreGeneration = undefined
    this.sceneGeneration += 1
    this.sceneReady = false
    return this.beginAsyncOperation('import', canvas)
  }

  private beginAsyncOperation(kind: AsyncOperationKind, canvas: FabricCanvasPort): AsyncOperation {
    const requestGeneration = kind === 'import'
      ? ++this.importRequestGeneration
      : kind === 'background'
        ? ++this.backgroundRequestGeneration
        : ++this.stickerRequestGeneration
    return { canvas, sceneGeneration: this.sceneGeneration, requestGeneration, kind }
  }

  private isCurrentOperation(operation: AsyncOperation): boolean {
    if (this.sceneGeneration !== operation.sceneGeneration || this.canvas !== operation.canvas) return false
    if (operation.kind === 'import') return this.importRequestGeneration === operation.requestGeneration
    if (operation.kind === 'background') return this.backgroundRequestGeneration === operation.requestGeneration
    return true
  }

  private ensureCurrentOperation(operation: AsyncOperation): void {
    if (!this.isCurrentOperation(operation)) {
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
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true,
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
      lockScalingFlip: true,
      lockSkewingX: true,
      lockSkewingY: true,
      lockRotation: true
    }
  }

  private moveLayer(objectId: string, action: (canvas: FabricCanvasPort, object: FabricObjectPort) => unknown): void {
    const canvas = this.requireReadyCanvas()
    const object = this.findObject(objectId)
    if (!object || object.selectable === false) throw editorError('INVALID_ARGUMENT', 'Sticker layer cannot be changed.')
    action(canvas, object)
    canvas.requestRenderAll()
    this.captureHistory()
  }

  /** Layer ops on the active object; no-ops when empty, placeholder, or non-selectable. */
  private withSelectedLayerObject(action: (objectId: string) => void): void {
    const active = this.requireReadyCanvas().getActiveObject()
    if (!active?.objectId) return
    if (this.recoveryPlaceholders.has(active) || active.selectable === false) return
    action(active.objectId)
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
    canvas.calcOffset()
  }

  private findObject(objectId: string): FabricObjectPort | undefined {
    return this.requireCanvas().getObjects().find((object) => object.objectId === objectId)
  }

  private captureHistory(): void {
    if (this.restoring || !this.sceneReady || !this.metadata || !this.canvas) return
    const entry = { scene: this.serializeScene() }
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(entry)
    if (this.history.length > FABRIC_EDITOR_HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - FABRIC_EDITOR_HISTORY_LIMIT)
    }
    this.historyIndex = this.history.length - 1
  }

  private resetHistory(): void {
    this.history = [{ scene: this.serializeScene() }]
    this.historyIndex = 0
  }

  private async restoreHistory(entry: HistoryEntry): Promise<void> {
    const canvas = this.requireReadyCanvas()
    const resolver = this.resolver ?? {
      resolveAsset: async (assetId: string): Promise<AssetRecord> => {
        const asset = this.assetCache.get(assetId)
        if (!asset) throw editorError('ASSET_NOT_FOUND', 'History material is unavailable.')
        return asset
      }
    }
    const transaction = {
      generation: ++this.historyRestoreGeneration,
      sceneGeneration: this.sceneGeneration,
      history: this.history,
      historyIndex: this.historyIndex,
      canvas
    }
    this.activeHistoryRestoreGeneration = transaction.generation
    const ownsTransaction = (): boolean =>
      this.activeHistoryRestoreGeneration === transaction.generation &&
      this.canvas === transaction.canvas &&
      this.sceneGeneration === transaction.sceneGeneration + 1
    try {
      await this.importSceneInternal(entry.scene, resolver, transaction.generation)
      if (!ownsTransaction()) throw editorError('REQUEST_CANCELLED', 'History restore was superseded.')
      this.history = transaction.history
      this.historyIndex = transaction.historyIndex
    } catch (error) {
      if (ownsTransaction()) {
        this.history = transaction.history
        this.historyIndex = transaction.historyIndex
      }
      throw error
    } finally {
      if (this.activeHistoryRestoreGeneration === transaction.generation) {
        this.activeHistoryRestoreGeneration = undefined
      }
    }
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

  private requireReadyCanvas(): FabricCanvasPort {
    const canvas = this.requireCanvas()
    if (!this.sceneReady) throw editorError('INVALID_ARGUMENT', 'Scene import has not completed.')
    return canvas
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
    lockScalingFlip: true,
    lockSkewingX: true,
    lockSkewingY: true,
    lockRotation: sceneObject.locked
  }
}

function fabricObjectToSceneObject(object: FabricObjectPort, zIndex: number): SceneObject {
  if (!object.objectId || !object.assetId || object.assetType !== 'sticker') {
    throw editorError('SCENE_VALIDATION_FAILED', 'Canvas contains a non-sticker object.')
  }
  if (hasUnsupportedFabricTransform(object)) {
    throw editorError('SCENE_VALIDATION_FAILED', 'Fabric flip/skew transforms are not representable in V1 SceneDocument.')
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

function hasUnsupportedFabricTransform(object: FabricObjectPort): boolean {
  if ((object.flipX !== undefined && object.flipX !== false) || (object.flipY !== undefined && object.flipY !== false)) return true
  for (const value of [object.skewX, object.skewY]) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value !== 0)) return true
  }
  return false
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
