import { fabric } from 'fabric'
import { ElementImagePreview, type PreviewImage } from './element-image-preview'
import type {
  AssetAccessState,
  AssetRecord,
  PersonalAssetRecord,
  PersonalAssetVersionRecord,
  SceneCorePatternObject,
  SceneDocument,
  SceneObject,
  ScenePersonalBackground,
  ScenePersonalElement,
  SceneSnapshotValidationContext,
  SharedError
} from '@shared/contracts'
import {
  SCHEMA_VERSION,
  validateAssetAccessState,
  validateAssetRecord,
  validatePersonalAssetRecord,
  validatePersonalAssetVersionRecord,
  validateSceneDocument,
  validateSceneDocumentAgainstSnapshot,
  validateSceneSnapshotValidationContext
} from '@shared/contracts'
import { FELT_RESOURCE_REF_POLICY, parseFeltResourceRef } from '@shared/resource'
import { artworkBackgroundColor } from '@shared/scene-background'
import type {
  EditorSelectionEvent,
  EditorSelectionListener,
  EditorSelectionProjection
} from './editor-selection.types'
import type {
  EditorHistoryListener,
  EditorHistoryProjection
} from './editor-history.types'

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

/** Internal renderer discriminator; never persisted as a Scene role field. */
export type SceneObjectKind = 'system_sticker' | 'core_pattern' | 'personal_element'

export interface FabricObjectPort {
  getElement?(): CanvasImageSource
  setElement?(image: CanvasImageSource, options: { width: number; height: number }): unknown
  toDataURL?(options: Record<string, unknown>): string
  objectId?: string
  assetId?: string
  assetType?: 'sticker'
  sceneObjectKind?: SceneObjectKind
  personalAssetId?: string
  versionId?: string
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
  cornerSize?: number
  transparentCorners?: boolean
  borderColor?: string
  cornerColor?: string
  cornerStrokeColor?: string
  cornerStyle?: 'rect' | 'circle'
  borderScaleFactor?: number
  padding?: number
  controls?: Record<string, {
    offsetX?: number
    offsetY?: number
    withConnection?: boolean
    sizeX?: number
    sizeY?: number
    touchSizeX?: number
    touchSizeY?: number
  }>
  set(options: Record<string, unknown>): unknown
  setCoords(): unknown
  getBoundingRect(absolute?: boolean, calculate?: boolean): { left: number; top: number; width: number; height: number }
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
  resolvePersonalAsset?: (personalAssetId: string, versionId: string) => Promise<{
    asset: PersonalAssetRecord
    version: PersonalAssetVersionRecord
  }>
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
  code:
    | 'ASSET_NOT_FOUND'
    | 'ASSET_SNAPSHOT_MISMATCH'
    | 'PERSONAL_ASSET_NOT_FOUND'
    | 'PERSONAL_ASSET_VERSION_NOT_FOUND'
    | 'PERSONAL_ASSET_INVALID'
    | 'PERSONAL_RESOURCE_NOT_FOUND'
  message: string
  source?: 'system' | 'personal'
  assetId?: string
  assetType?: 'background' | 'sticker'
  objectId?: string
  personalAssetId?: string
  versionId?: string
  personalRole?: 'background' | 'core_pattern' | 'element'
}

export interface SceneImportResult {
  /** Resource problems are rendered as locked placeholders; they are never silently removed. */
  issues: readonly SceneRecoveryIssue[]
}

type EditorSceneMetadata = Omit<
  SceneDocument,
  'canvas' | 'backgroundAssetId' | 'objects' | 'personalBackground' | 'corePattern' | 'personalElements' | 'updatedAt'
>

interface HistoryEntry {
  scene: SceneDocument
  revision: number
}

type AsyncOperationKind = 'import' | 'background' | 'sticker' | 'personal'

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
  corePattern: PreparedCanvasObject | undefined
  objects: PreparedCanvasObject[]
  issues: SceneRecoveryIssue[]
  assets: Map<string, AssetRecord>
  personalAssets: Map<string, PersonalAssetBundle>
}

interface PersonalAssetBundle {
  asset: PersonalAssetRecord
  version: PersonalAssetVersionRecord
}

type PersonalRecoveryCode =
  | 'PERSONAL_ASSET_NOT_FOUND'
  | 'PERSONAL_ASSET_VERSION_NOT_FOUND'
  | 'PERSONAL_ASSET_INVALID'
  | 'PERSONAL_RESOURCE_NOT_FOUND'

interface PersonalLoadFailure {
  personalRecoveryCode: PersonalRecoveryCode
  message: string
}

const DEFAULT_STICKER_SCALE = 1
export const STICKER_SAFE_EDGE_MARGIN = 24
export const STICKER_ROTATION_CONTROL_OFFSET = 40
export const STICKER_INITIAL_MAX_WIDTH_RATIO = 0.5
export const STICKER_INITIAL_MAX_HEIGHT_RATIO = 0.5
export const FABRIC_EDITOR_HISTORY_LIMIT = 100

/**
 * V4.6 selection-control theme. These are Fabric public Object/Control
 * properties only; they do not alter SceneDocument serialization semantics.
 */
export const V46_FABRIC_CONTROL_THEME = Object.freeze({
  borderColor: '#E8A572',
  cornerColor: '#FFFFFF',
  cornerStrokeColor: '#E8A572',
  transparentCorners: false,
  cornerStyle: 'circle' as const,
  cornerSize: 8,
  touchSize: 24,
  borderScaleFactor: 1,
  padding: 4,
  rotationControlOffset: STICKER_ROTATION_CONTROL_OFFSET,
  rotationControlSize: 8,
  rotationControlTouchSize: 28
})

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

/**
 * Applies the frozen V4.6 visual treatment through Fabric's public object and
 * Control APIs. The object-level touchCornerSize keeps the hit area usable
 * without mutating Fabric's shared prototype Control geometry.
 */
export function applyFabricControlTheme(object: FabricObjectPort): void {
  object.set({
    borderColor: V46_FABRIC_CONTROL_THEME.borderColor,
    cornerColor: V46_FABRIC_CONTROL_THEME.cornerColor,
    cornerStrokeColor: V46_FABRIC_CONTROL_THEME.cornerStrokeColor,
    transparentCorners: V46_FABRIC_CONTROL_THEME.transparentCorners,
    cornerStyle: V46_FABRIC_CONTROL_THEME.cornerStyle,
    cornerSize: V46_FABRIC_CONTROL_THEME.cornerSize,
    touchCornerSize: V46_FABRIC_CONTROL_THEME.touchSize,
    borderScaleFactor: V46_FABRIC_CONTROL_THEME.borderScaleFactor,
    padding: V46_FABRIC_CONTROL_THEME.padding
  })

  const rotation = object.controls?.mtr
  if (rotation) {
    rotation.offsetY = -V46_FABRIC_CONTROL_THEME.rotationControlOffset
    rotation.withConnection = true
  }
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
  private readonly elementPreview = new ElementImagePreview()
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
  private readonly personalAssetCache = new Map<string, PersonalAssetBundle>()
  private readonly listeners: Array<[string, (event: { target?: FabricObjectPort }) => void]> = []
  private readonly selectionListeners = new Set<EditorSelectionListener>()
  private readonly historyListeners = new Set<EditorHistoryListener>()
  private canvas: FabricCanvasPort | undefined
  private metadata: EditorSceneMetadata | undefined
  private backgroundAssetId: string | null = null
  private personalBackground: ScenePersonalBackground | null = null
  private corePattern: SceneCorePatternObject | null = null
  private personalElements: ScenePersonalElement[] = []
  private backgroundColor: string | undefined
  private history: HistoryEntry[] = []
  private historyIndex = -1
  private historyRevisionCounter = 0
  private restoring = false
  private resolver: FabricEditorAssetResolver | undefined
  private recoveryIssues: SceneRecoveryIssue[] = []
  private sceneGeneration = 0
  private importRequestGeneration = 0
  private backgroundRequestGeneration = 0
  private stickerRequestGeneration = 0
  private personalRequestGeneration = 0
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
    this.personalBackground = scene.personalBackground
    this.corePattern = scene.corePattern
    this.personalElements = scene.personalElements
    this.backgroundColor = artworkBackgroundColor(scene.canvas)
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
        canvas.backgroundColor = artworkBackgroundColor(scene.canvas)
        if (prepared.background) this.fitBackground(prepared.background.object, canvas)
        canvas.setBackgroundImage(prepared.background?.object ?? null, () => undefined)
        if (prepared.corePattern) canvas.add(prepared.corePattern.object)
        for (const object of prepared.objects) canvas.add(object.object)
        if (prepared.corePattern) this.objectResources.set(prepared.corePattern.object, prepared.corePattern.release)
        for (const object of prepared.objects) this.objectResources.set(object.object, object.release)
        if (prepared.background) this.objectResources.set(prepared.background.object, prepared.background.release)
        this.metadata = metadataFromScene(scene)
        this.backgroundAssetId = scene.backgroundAssetId
        this.personalBackground = scene.personalBackground
        this.corePattern = scene.corePattern
        this.personalElements = scene.personalElements
        this.backgroundColor = artworkBackgroundColor(scene.canvas)
        this.recoveryIssues = prepared.issues
        this.resolver = resolver
        this.assetCache.clear()
        for (const [assetId, asset] of prepared.assets) this.assetCache.set(assetId, asset)
        this.personalAssetCache.clear()
        for (const [key, bundle] of prepared.personalAssets) this.personalAssetCache.set(key, bundle)
        this.sceneReady = true
        this.committedSceneReady = true
        canvas.calcOffset()
        canvas.discardActiveObject()
        canvas.requestRenderAll()
        if (historyRestoreGeneration === undefined) this.resetHistory()
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
      this.personalBackground = null
      this.clearBackgroundRecoveryIssues(previousBackgroundAssetId)
      this.assertProspectiveScene({ backgroundAssetId: null, personalBackground: null })
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
    this.personalBackground = null
    this.clearRecoveryIssues('background')
    this.clearPersonalBackgroundRecoveryIssues()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async setPersonalBackground(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void> {
    const canvas = this.requireReadyCanvas()
    const metadata = this.requireMetadata()
    const bundle = this.assertPersonalBundle(asset, version, 'background', metadata.userId)
    this.assertProspectiveScene({
      backgroundAssetId: null,
      personalBackground: { personalAssetId: asset.personalAssetId, versionId: version.versionId }
    })
    const operation = this.beginAsyncOperation('background', canvas)
    const loaded = await this.loadPersonalEditorImage(bundle, this.backgroundOptions(canvas), operation, canvas)
    this.ensureCurrentOperation(operation)
    this.fitBackground(loaded.object, canvas)
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(loaded.object, () => undefined)
    this.objectResources.set(loaded.object, loaded.release)
    this.backgroundAssetId = null
    this.personalBackground = { personalAssetId: asset.personalAssetId, versionId: version.versionId }
    this.personalAssetCache.set(personalAssetKey(asset.personalAssetId, version.versionId), bundle)
    this.clearBackgroundRecoveryIssues(previousBackgroundAssetId)
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async setCorePattern(asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void> {
    const canvas = this.requireReadyCanvas()
    const metadata = this.requireMetadata()
    const bundle = this.assertPersonalBundle(asset, version, 'core_pattern', metadata.userId)
    const operation = this.beginAsyncOperation('personal', canvas)
    const objectId = this.createObjectId()
    const loaded = await this.loadPersonalEditorImage(bundle, personalObjectOptions({
      objectId,
      personalAssetId: asset.personalAssetId,
      versionId: version.versionId,
      sceneObjectKind: 'core_pattern',
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      scaleX: DEFAULT_STICKER_SCALE,
      scaleY: DEFAULT_STICKER_SCALE,
      angle: 0,
      visible: true,
      locked: false
    }), operation, canvas)
    this.ensureCurrentOperation(operation)
    const previous = this.findCorePatternObject()
    if (previous) {
      this.releaseObject(previous)
      canvas.remove(previous)
    }
    canvas.add(loaded.object)
    canvas.moveTo(loaded.object, 0)
    this.objectResources.set(loaded.object, loaded.release)
    this.corePattern = {
      objectId,
      personalAssetId: asset.personalAssetId,
      versionId: version.versionId,
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      scaleX: DEFAULT_STICKER_SCALE,
      scaleY: DEFAULT_STICKER_SCALE,
      angle: 0,
      visible: true,
      locked: false
    }
    this.personalAssetCache.set(personalAssetKey(asset.personalAssetId, version.versionId), bundle)
    this.clearPersonalObjectRecoveryIssues(previous?.personalAssetId, previous?.versionId, previous?.objectId)
    canvas.setActiveObject(loaded.object)
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  clearCorePattern(): void {
    const canvas = this.requireReadyCanvas()
    const previous = this.findCorePatternObject()
    if (!previous) {
      if (this.corePattern === null) return
      this.corePattern = null
      this.captureHistory()
      return
    }
    this.releaseObject(previous)
    canvas.remove(previous)
    this.corePattern = null
    this.clearPersonalObjectRecoveryIssues(previous.personalAssetId, previous.versionId, previous.objectId)
    canvas.discardActiveObject()
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async addPersonalElement(
    asset: PersonalAssetRecord,
    version: PersonalAssetVersionRecord,
    position?: { left: number; top: number }
  ): Promise<string> {
    const canvas = this.requireReadyCanvas()
    const metadata = this.requireMetadata()
    const bundle = this.assertPersonalBundle(asset, version, 'element', metadata.userId)
    const operation = this.beginAsyncOperation('personal', canvas)
    const objectId = this.createObjectId()
    const loaded = await this.loadPersonalEditorImage(bundle, personalObjectOptions({
      objectId,
      personalAssetId: asset.personalAssetId,
      versionId: version.versionId,
      sceneObjectKind: 'personal_element',
      zIndex: this.elementObjects(canvas).length + 1,
      left: position?.left ?? canvas.getWidth() / 2,
      top: position?.top ?? canvas.getHeight() / 2,
      scaleX: DEFAULT_STICKER_SCALE,
      scaleY: DEFAULT_STICKER_SCALE,
      angle: 0,
      visible: true,
      locked: false
    }), operation, canvas)
    this.ensureCurrentOperation(operation)
    if (version.providedPsd && position === undefined) {
      try {
        const scale = calculateStickerInitialScale(canvas.getWidth(), canvas.getHeight(), loaded.object.width, loaded.object.height)
        loaded.object.set({ scaleX: scale, scaleY: scale }); loaded.object.setCoords()
      } catch (error) { loaded.release(); throw error }
    }
    canvas.add(loaded.object)
    this.objectResources.set(loaded.object, loaded.release)
    this.personalAssetCache.set(personalAssetKey(asset.personalAssetId, version.versionId), bundle)
    canvas.setActiveObject(loaded.object)
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
    return objectId
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
    this.assertProspectiveScene({ backgroundColor: color, backgroundAssetId: null, personalBackground: null })
    this.backgroundRequestGeneration += 1
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = color
    this.backgroundColor = color
    this.backgroundAssetId = null
    this.personalBackground = null
    this.clearBackgroundRecoveryIssues(previousBackgroundAssetId)
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  setTransparentBackground(): void {
    const canvas = this.requireReadyCanvas()
    this.assertProspectiveScene({ clearBackgroundColor: true, backgroundAssetId: null, personalBackground: null })
    this.backgroundRequestGeneration += 1
    const previousBackgroundAssetId = this.backgroundAssetId
    this.releaseBackground(canvas)
    canvas.setBackgroundImage(null, () => undefined)
    canvas.backgroundColor = undefined
    this.backgroundColor = undefined
    this.backgroundAssetId = null
    this.personalBackground = null
    this.clearBackgroundRecoveryIssues(previousBackgroundAssetId)
    canvas.calcOffset()
    canvas.requestRenderAll()
    this.captureHistory()
  }

  async addSticker(asset: AssetRecord, access: AssetAccessState, position?: { left: number; top: number; fitBox?: { width: number; height: number } }): Promise<string> {
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
      sceneObjectKind: 'system_sticker',
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
    if (position?.fitBox) {
      try {
        const { width, height } = position.fitBox
        const scale = Math.min(width / loaded.object.width!, height / loaded.object.height!)
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(scale) || scale <= 0) {
          throw editorError('INVALID_ARGUMENT', 'Task sticker fit box must be positive and finite.')
        }
        loaded.object.set({ scaleX: scale, scaleY: scale, lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false, hasBorders: false })
        loaded.object.setCoords()
      } catch (error) { loaded.release(); throw error }
    }
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
    const kind = runtimeObjectKind(object)
    if (kind === 'core_pattern') {
      throw editorError('INVALID_ARGUMENT', '核心图案不能拿掉。')
    }
    const recoveryAssetId = this.recoveryPlaceholders.has(object) ? object.assetId : undefined
    const recoveryObjectId = this.recoveryPlaceholders.has(object) ? object.objectId : undefined
    const recoveryPersonalAssetId = this.recoveryPlaceholders.has(object) ? object.personalAssetId : undefined
    const recoveryVersionId = this.recoveryPlaceholders.has(object) ? object.versionId : undefined
    this.releaseObject(object)
    canvas.remove(object)
    canvas.discardActiveObject()
    if (kind === 'personal_element') {
      this.clearPersonalObjectRecoveryIssues(object.personalAssetId, object.versionId, object.objectId)
    } else if (recoveryPersonalAssetId && recoveryVersionId) {
      this.clearPersonalObjectRecoveryIssues(recoveryPersonalAssetId, recoveryVersionId, recoveryObjectId)
    } else if (recoveryAssetId && recoveryObjectId) {
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
    this.moveLayer(objectId, 1)
  }

  sendBackward(objectId: string): void {
    this.moveLayer(objectId, -1)
  }

  bringToFront(objectId: string): void {
    this.moveLayer(objectId, Number.POSITIVE_INFINITY)
  }

  sendToBack(objectId: string): void {
    this.moveLayer(objectId, Number.NEGATIVE_INFINITY)
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
    this.emitHistoryProjection()
    return true
  }

  async redo(): Promise<boolean> {
    this.requireReadyCanvas()
    if (this.historyIndex >= this.history.length - 1) return false
    const previousIndex = this.historyIndex
    const target = this.history[previousIndex + 1]
    await this.restoreHistory(target)
    this.historyIndex = previousIndex + 1
    this.emitHistoryProjection()
    return true
  }

  exportScene(): SceneDocument {
    if (this.elementPreview.active) throw editorError('SCENE_VALIDATION_FAILED', '请先关闭换色预览再保存原作品。')
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

  subscribeSelection(listener: EditorSelectionListener): () => void {
    this.selectionListeners.add(listener)
    let active = true
    return (): void => {
      if (!active) return
      active = false
      this.selectionListeners.delete(listener)
    }
  }

  getHistoryProjection(): EditorHistoryProjection {
    return {
      revision: this.history[this.historyIndex]?.revision ?? 0,
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex >= 0 && this.historyIndex < this.history.length - 1
    }
  }

  subscribeHistory(listener: EditorHistoryListener): () => void {
    this.historyListeners.add(listener)
    let active = true
    return (): void => {
      if (!active) return
      active = false
      this.historyListeners.delete(listener)
    }
  }

  exportPngDataUrl(objectId?: string): string {
    try {
      if (this.elementPreview.active) throw new Error('Temporary preview cannot be exported as the original scene')
      const canvas = this.requireReadyCanvas()
      const object = objectId === undefined ? undefined : this.findObject(objectId)
      if (objectId !== undefined && (!object || !object.visible || !object.toDataURL || this.recoveryPlaceholders.has(object))) throw new Error('Element unavailable')
      // Fabric exports only this object in local coordinates and restores its
      // scene transform synchronously; other objects/background are not included.
      const value = object ? object.toDataURL!({ format: 'png', multiplier: 1, withoutTransform: true, withoutShadow: true })
        : canvas.toDataURL({ format: 'png', multiplier: 1 })
      if (!value.startsWith('data:image/png')) throw new Error('Canvas did not return a PNG data URL.')
      return value
    } catch {
      throw editorError('PREVIEW_EXPORT_FAILED', 'PNG preview export failed.')
    }
  }

  async exportPng(objectId?: string): Promise<Blob> {
    // Convert the PNG data URL directly to a Blob. The previous `fetch(data:...)`
    // path is unreliable under Electron CSP: `connect-src` can refuse data URLs,
    // which silently breaks preview export in the renderer.
    const dataUrl = this.exportPngDataUrl(objectId)
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

  async previewElementImage(objectId: string, png: string): Promise<void> {
    const canvas = this.requireReadyCanvas()
    const target = this.findObject(objectId)
    if (!target?.getElement || !target.setElement || !target.visible || this.recoveryPlaceholders.has(target)) throw new Error('当前元素不能预览换色。')
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) throw new Error('换色预览必须为本地 PNG。')
    await this.elementPreview.show(target as PreviewImage, async () => {
      const image = new Image()
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('换色预览解码失败。')); image.src = png })
      const normalized = document.createElement('canvas')
      normalized.width = target.width!; normalized.height = target.height!
      const context = normalized.getContext('2d')
      if (!context) throw new Error('无法创建换色预览。')
      context.drawImage(image, 0, 0, normalized.width, normalized.height)
      return normalized
    }, () => canvas.requestRenderAll())
  }

  clearElementPreview(): void { this.elementPreview.clear() }

  /** Commit an immutable derived asset in the SAME element/tier, preserving its displayed footprint. */
  async replaceElementImage(objectId: string, asset: PersonalAssetRecord, version: PersonalAssetVersionRecord): Promise<void> {
    const canvas = this.requireReadyCanvas(), target = this.findObject(objectId)
    if (!target || this.recoveryPlaceholders.has(target)) throw new Error('原元素已不可用，未应用换色。')
    const isCore = runtimeObjectKind(target) === 'core_pattern'
    const bundle = this.assertPersonalBundle(asset, version, isCore ? 'core_pattern' : 'element', this.requireMetadata().userId)
    const operation = this.beginAsyncOperation('personal', canvas)
    const index = canvas.getObjects().indexOf(target)
    const loaded = await this.loadPersonalEditorImage(bundle, personalObjectOptions({
      objectId, personalAssetId: asset.personalAssetId, versionId: version.versionId,
      left: target.left!, top: target.top!, scaleX: target.scaleX!, scaleY: target.scaleY!, angle: target.angle ?? 0,
      visible: target.visible !== false, locked: target.selectable === false,
      ...(isCore ? {} : { zIndex: this.elementObjects(canvas).indexOf(target) + 1 })
    }), operation, canvas)
    try {
      this.ensureCurrentOperation(operation)
      if (this.findObject(objectId) !== target) throw new Error('元素在换色期间已变化。')
      loaded.object.set({ scaleX: target.scaleX! * target.width! / loaded.object.width!,
        scaleY: target.scaleY! * target.height! / loaded.object.height! })
    } catch (error) { loaded.release(); throw error }
    this.clearElementPreview()
    canvas.remove(target); canvas.add(loaded.object); canvas.moveTo(loaded.object, index)
    this.objectResources.set(loaded.object, loaded.release)
    this.personalAssetCache.set(personalAssetKey(asset.personalAssetId, version.versionId), bundle)
    this.releaseObject(target)
    loaded.object.setCoords(); canvas.setActiveObject(loaded.object)
    canvas.calcOffset(); canvas.requestRenderAll(); this.captureHistory()
  }

  dispose(): void {
    this.clearElementPreview()
    this.sceneGeneration += 1
    this.sceneReady = false
    this.committedSceneReady = false
    this.activeHistoryRestoreGeneration = undefined
    this.selectionListeners.clear()
    this.historyListeners.clear()
    const canvas = this.canvas
    if (!canvas) {
      this.recoveryIssues = []
      this.assetCache.clear()
      this.personalAssetCache.clear()
      this.metadata = undefined
      this.backgroundAssetId = null
      this.personalBackground = null
      this.corePattern = null
      this.personalElements = []
      this.backgroundColor = undefined
      this.resolver = undefined
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
    this.personalBackground = null
    this.corePattern = null
    this.personalElements = []
    this.backgroundColor = undefined
    this.resolver = undefined
    this.recoveryIssues = []
    this.personalAssetCache.clear()
  }

  private attachCanvasListeners(canvas: FabricCanvasPort): void {
    const scaling = (event: { target?: FabricObjectPort }) => {
      if (event.target?.objectId) {
        this.enforceUniformScale(event.target)
        this.emitSelectionFor('geometry', event.target)
      }
    }
    const rotating = (event: { target?: FabricObjectPort }) => {
      if (event.target?.objectId) {
        event.target.set({ angle: normalizeSceneAngle(event.target.angle ?? 0) })
        event.target.setCoords()
        this.emitSelectionFor('geometry', event.target)
      }
    }
    const moving = (event: { target?: FabricObjectPort }) => {
      this.emitSelectionFor('geometry', event.target)
    }
    const modified = (event: { target?: FabricObjectPort }) => {
      if (!this.restoring) this.captureHistory()
      this.emitSelectionFor('geometry', event.target)
    }
    const selectionCreated = () => {
      this.emitSelectionFor('selected', canvas.getActiveObject())
    }
    const selectionUpdated = () => {
      this.emitSelectionFor('selected', canvas.getActiveObject())
    }
    const selectionCleared = () => {
      this.emitSelection({ type: 'cleared', selection: null })
    }
    const doubleClick = (event: { target?: FabricObjectPort }) => {
      const target = event.target
      const selection = this.selectionProjection(target)
      if (!selection) return
      if (canvas.getActiveObject() !== target && target) {
        canvas.setActiveObject(target)
        canvas.requestRenderAll()
      }
      this.emitSelection({ type: 'double-click', selection })
    }
    for (const [eventName, listener] of [
      ['selection:created', selectionCreated],
      ['selection:updated', selectionUpdated],
      ['selection:cleared', selectionCleared],
      ['object:moving', moving],
      ['object:scaling', scaling],
      ['object:rotating', rotating],
      ['object:modified', modified],
      ['mouse:dblclick', doubleClick]
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
    const personalAssets = new Map<string, PersonalAssetBundle>()
    const snapshotAssets = this.snapshotAssetsById.get(scene.assetSnapshotId)
    if (!snapshotAssets) {
      issues.push({ code: 'ASSET_SNAPSHOT_MISMATCH', message: 'Scene asset snapshot is unavailable.' })
    }
    let background: PreparedCanvasObject | undefined
    let personalBackground: PreparedCanvasObject | undefined
    let corePattern: PreparedCanvasObject | undefined
    const objects: PreparedCanvasObject[] = []
    try {
      background = scene.backgroundAssetId === null
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
      personalBackground = scene.personalBackground === null
        ? undefined
        : await this.loadScenePersonalAssetOrPlaceholder(
          scene.personalBackground,
          'background',
          scene,
          resolver,
          this.backgroundOptionsForScene(scene),
          issues,
          operation,
          canvas,
          personalAssets
        )
      corePattern = scene.corePattern === null
        ? undefined
        : await this.loadScenePersonalAssetOrPlaceholder(
          scene.corePattern,
          'core_pattern',
          scene,
          resolver,
          personalObjectOptions(scene.corePattern),
          issues,
          operation,
          canvas,
          personalAssets
        )
      const elements = [
        ...scene.objects.map((item) => ({ kind: 'system_sticker' as const, item })),
        ...scene.personalElements.map((item) => ({ kind: 'personal_element' as const, item }))
      ].sort((left, right) => left.item.zIndex - right.item.zIndex)
      for (const element of elements) {
        if (element.kind === 'system_sticker') {
          objects.push(await this.loadSceneAssetOrPlaceholder(
            element.item.assetId,
            'sticker',
            scene.assetSnapshotId,
            resolver,
            sceneObjectOptions(element.item),
            snapshotAssets,
            issues,
            operation,
            canvas,
            assets
          ))
        } else {
          objects.push(await this.loadScenePersonalAssetOrPlaceholder(
            element.item,
            'element',
            scene,
            resolver,
            personalObjectOptions(element.item),
            issues,
            operation,
            canvas,
            personalAssets
          ))
        }
      }
      return { background: personalBackground ?? background, corePattern, objects, issues, assets, personalAssets }
    } catch (error) {
      if (background) background.release()
      if (personalBackground) personalBackground.release()
      if (corePattern) corePattern.release()
      for (const object of objects) object.release()
      throw error
    }
  }

  private async loadScenePersonalAssetOrPlaceholder(
    reference: { personalAssetId: string; versionId: string },
    expectedRole: 'background' | 'core_pattern' | 'element',
    scene: SceneDocument,
    resolver: FabricEditorAssetResolver,
    options: Record<string, unknown>,
    issues: SceneRecoveryIssue[],
    operation: AsyncOperation,
    canvas: FabricCanvasPort,
    personalAssets: Map<string, PersonalAssetBundle>
  ): Promise<PreparedCanvasObject> {
    try {
      const bundle = await this.resolvePersonalAssetBundle(reference, expectedRole, scene.userId, resolver)
      const loaded = await this.loadPersonalEditorImage(bundle, options, operation, canvas)
      personalAssets.set(personalAssetKey(reference.personalAssetId, reference.versionId), bundle)
      return loaded
    } catch (error) {
      if (isRequestCancelled(error)) throw error
      const failure = isPersonalLoadFailure(error)
        ? error
        : { personalRecoveryCode: 'PERSONAL_RESOURCE_NOT_FOUND' as const, message: 'Personal Asset resource could not be loaded.' }
      issues.push({
        code: failure.personalRecoveryCode,
        source: 'personal',
        message: 'Personal Asset could not be loaded and was restored as a locked placeholder.',
        personalAssetId: reference.personalAssetId,
        versionId: reference.versionId,
        personalRole: expectedRole,
        ...(typeof options.objectId === 'string' ? { objectId: options.objectId } : {})
      })
      return this.createPersonalPlaceholder(reference, expectedRole, options)
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

  private async resolvePersonalAssetBundle(
    reference: { personalAssetId: string; versionId: string },
    expectedRole: 'background' | 'core_pattern' | 'element',
    sceneUserId: string,
    resolver: FabricEditorAssetResolver
  ): Promise<PersonalAssetBundle> {
    if (!resolver.resolvePersonalAsset) {
      throw personalLoadFailure('PERSONAL_ASSET_NOT_FOUND', 'Personal Asset resolver is unavailable.')
    }
    let bundle: PersonalAssetBundle
    try {
      bundle = await resolver.resolvePersonalAsset(reference.personalAssetId, reference.versionId)
    } catch (error) {
      if (isPersonalLoadFailure(error)) throw error
      const recoveryCode = error !== null
        && typeof error === 'object'
        && 'personalRecoveryCode' in error
        && typeof error.personalRecoveryCode === 'string'
        && (
          error.personalRecoveryCode === 'PERSONAL_ASSET_NOT_FOUND'
          || error.personalRecoveryCode === 'PERSONAL_ASSET_VERSION_NOT_FOUND'
          || error.personalRecoveryCode === 'PERSONAL_ASSET_INVALID'
        )
        ? error.personalRecoveryCode
        : 'PERSONAL_ASSET_NOT_FOUND'
      throw personalLoadFailure(recoveryCode, 'Personal Asset could not be resolved.')
    }
    if (!bundle || typeof bundle !== 'object' || !bundle.asset || !bundle.version) {
      throw personalLoadFailure('PERSONAL_ASSET_INVALID', 'Personal Asset resolver returned an invalid result.')
    }
    return this.assertPersonalBundle(bundle.asset, bundle.version, expectedRole, sceneUserId, reference)
  }

  private assertPersonalBundle(
    asset: PersonalAssetRecord,
    version: PersonalAssetVersionRecord,
    expectedRole: 'background' | 'core_pattern' | 'element',
    sceneUserId: string,
    requested?: { personalAssetId: string; versionId: string }
  ): PersonalAssetBundle {
    const assetValidation = validatePersonalAssetRecord(asset)
    const versionValidation = validatePersonalAssetVersionRecord(version, FELT_RESOURCE_REF_POLICY)
    if (!assetValidation.ok || !versionValidation.ok) {
      throw personalLoadFailure('PERSONAL_ASSET_INVALID', 'Personal Asset records failed runtime validation.')
    }
    if (
      (requested && (asset.personalAssetId !== requested.personalAssetId || version.versionId !== requested.versionId))
      || version.personalAssetId !== asset.personalAssetId
      || asset.userId !== sceneUserId
      || asset.role !== expectedRole
    ) {
      throw personalLoadFailure('PERSONAL_ASSET_INVALID', 'Personal Asset ownership, role, or identity does not match the Scene reference.')
    }
    return { asset: assetValidation.value, version: versionValidation.value }
  }

  private async loadPersonalEditorImage(
    bundle: PersonalAssetBundle,
    options: Record<string, unknown>,
    operation: AsyncOperation,
    canvas: FabricCanvasPort
  ): Promise<PreparedCanvasObject> {
    let resource: LoadedResource | undefined
    try {
      resource = await this.loadResource(bundle.version.sourceImageRef)
      this.ensureCurrentOperation(operation)
      const object = await this.runtime.createImage(resource.sourceUrl, {
        ...options,
        personalAssetId: bundle.asset.personalAssetId,
        versionId: bundle.version.versionId
      })
      this.ensureCurrentOperation(operation)
      if (options.sceneObjectKind !== undefined) applyFabricControlTheme(object)
      return { object, release: resource.dispose }
    } catch (error) {
      resource?.dispose()
      if (isRequestCancelled(error)) throw error
      throw personalLoadFailure('PERSONAL_RESOURCE_NOT_FOUND', 'Personal Asset resource could not be loaded.')
    }
  }

  private async loadEditorImage(
    asset: AssetRecord,
    options: Record<string, unknown>,
    operation: AsyncOperation,
    canvas: FabricCanvasPort
  ): Promise<PreparedCanvasObject> {
    return this.loadImageResource(asset.imageUrl, options, operation, canvas, options.assetType === 'sticker')
  }

  private async loadImageResource(
    resourceRef: string,
    options: Record<string, unknown>,
    operation: AsyncOperation,
    _canvas: FabricCanvasPort,
    applyTheme: boolean
  ): Promise<PreparedCanvasObject> {
    let resource: LoadedResource | undefined
    try {
      resource = await this.loadResource(resourceRef)
      this.ensureCurrentOperation(operation)
      const object = await this.runtime.createImage(resource.sourceUrl, options)
      this.ensureCurrentOperation(operation)
      if (applyTheme) applyFabricControlTheme(object)
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
      ...(assetType === 'sticker' ? { assetType: 'sticker' as const, sceneObjectKind: 'system_sticker' as const } : {}),
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
    if (assetType === 'sticker') applyFabricControlTheme(object)
    this.recoveryPlaceholders.add(object)
    return { object, release: () => undefined }
  }

  private createPersonalPlaceholder(
    reference: { personalAssetId: string; versionId: string },
    role: 'background' | 'core_pattern' | 'element',
    options: Record<string, unknown>
  ): PreparedCanvasObject {
    const object = this.runtime.createPlaceholder({
      ...options,
      personalAssetId: reference.personalAssetId,
      versionId: reference.versionId,
      ...(role === 'core_pattern' ? { sceneObjectKind: 'core_pattern' as const } : {}),
      ...(role === 'element' ? { sceneObjectKind: 'personal_element' as const } : {}),
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
    if (role !== 'background') applyFabricControlTheme(object)
    this.recoveryPlaceholders.add(object)
    return { object, release: () => undefined }
  }

  private clearRecoveryIssues(assetType: 'background' | 'sticker'): void {
    this.recoveryIssues = this.recoveryIssues.filter((issue) => issue.assetType !== assetType)
  }

  private clearPersonalBackgroundRecoveryIssues(): void {
    this.recoveryIssues = this.recoveryIssues.filter((issue) => issue.personalRole !== 'background')
  }

  private clearBackgroundRecoveryIssues(previousBackgroundAssetId?: string | null): void {
    if (previousBackgroundAssetId) this.clearRecoveryIssueIfResolved(previousBackgroundAssetId, 'background')
    this.clearPersonalBackgroundRecoveryIssues()
  }

  private clearPersonalObjectRecoveryIssues(personalAssetId?: string, versionId?: string, objectId?: string): void {
    this.recoveryIssues = this.recoveryIssues.filter((issue) => {
      if (issue.source !== 'personal') return true
      if (issue.personalRole === 'background') return true
      if (personalAssetId !== undefined && issue.personalAssetId !== personalAssetId) return true
      if (versionId !== undefined && issue.versionId !== versionId) return true
      if (objectId !== undefined && issue.objectId !== objectId) return true
      return false
    })
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
    personalBackground?: ScenePersonalBackground | null
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
            ? (current.canvas.backgroundColor === undefined ? {} : { backgroundColor: current.canvas.backgroundColor, backgroundColorSource: 'user' as const })
            : { backgroundColor: change.backgroundColor, backgroundColorSource: 'user' as const })
      },
      backgroundAssetId: 'backgroundAssetId' in change ? change.backgroundAssetId ?? null : current.backgroundAssetId,
      personalBackground: 'personalBackground' in change ? change.personalBackground ?? null : current.personalBackground
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
        : kind === 'sticker'
          ? ++this.stickerRequestGeneration
          : ++this.personalRequestGeneration
    return { canvas, sceneGeneration: this.sceneGeneration, requestGeneration, kind }
  }

  private isCurrentOperation(operation: AsyncOperation): boolean {
    if (this.sceneGeneration !== operation.sceneGeneration || this.canvas !== operation.canvas) return false
    if (operation.kind === 'import') return this.importRequestGeneration === operation.requestGeneration
    if (operation.kind === 'background') return this.backgroundRequestGeneration === operation.requestGeneration
    // Adds are independent, unlike replacement of the single background.
    // Scene generation above still cancels loads after import/dispose.
    if (operation.kind === 'sticker') return true
    return this.personalRequestGeneration === operation.requestGeneration
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

  private moveLayer(objectId: string, offset: number): void {
    const canvas = this.requireReadyCanvas()
    const object = this.findObject(objectId)
    if (!object) throw editorError('INVALID_ARGUMENT', 'Sticker layer cannot be changed.')
    if (runtimeObjectKind(object) === 'core_pattern') return
    if (!isElementRuntimeObject(object) || object.selectable === false || this.recoveryPlaceholders.has(object)) {
      throw editorError('INVALID_ARGUMENT', 'Sticker layer cannot be changed.')
    }
    const elements = this.elementObjects(canvas)
    const currentIndex = elements.indexOf(object)
    if (currentIndex < 0) throw editorError('INVALID_ARGUMENT', 'Sticker layer cannot be changed.')
    const targetIndex = offset === Number.POSITIVE_INFINITY
      ? elements.length - 1
      : offset === Number.NEGATIVE_INFINITY
        ? 0
        : Math.max(0, Math.min(elements.length - 1, currentIndex + offset))
    if (targetIndex === currentIndex) return
    const coreIndex = canvas.getObjects().findIndex((candidate) => runtimeObjectKind(candidate) === 'core_pattern')
    canvas.moveTo(object, (coreIndex >= 0 ? coreIndex + 1 : 0) + targetIndex)
    canvas.requestRenderAll()
    this.captureHistory()
  }

  /** Layer ops on the active object; no-ops when empty, placeholder, or non-selectable. */
  private withSelectedLayerObject(action: (objectId: string) => void): void {
    const active = this.requireReadyCanvas().getActiveObject()
    if (!active?.objectId) return
    if (this.recoveryPlaceholders.has(active) || active.selectable === false || !isElementRuntimeObject(active)) return
    action(active.objectId)
  }

  private elementObjects(canvas: FabricCanvasPort): FabricObjectPort[] {
    return canvas.getObjects().filter(isElementRuntimeObject)
  }

  private findCorePatternObject(): FabricObjectPort | undefined {
    return this.requireCanvas().getObjects().find((object) => runtimeObjectKind(object) === 'core_pattern')
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
    const entry = { scene: this.serializeScene(), revision: ++this.historyRevisionCounter }
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(entry)
    if (this.history.length > FABRIC_EDITOR_HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - FABRIC_EDITOR_HISTORY_LIMIT)
    }
    this.historyIndex = this.history.length - 1
    this.emitHistoryProjection()
  }

  private resetHistory(): void {
    this.history = [{ scene: this.serializeScene(), revision: ++this.historyRevisionCounter }]
    this.historyIndex = 0
    this.emitHistoryProjection()
  }

  private emitHistoryProjection(): void {
    const projection = this.getHistoryProjection()
    for (const listener of this.historyListeners) {
      try { listener({ ...projection }) } catch { /* view listeners cannot break history */ }
    }
  }

  private async restoreHistory(entry: HistoryEntry): Promise<void> {
    const canvas = this.requireReadyCanvas()
    const fallbackResolver: FabricEditorAssetResolver = {
      resolveAsset: async (assetId: string): Promise<AssetRecord> => {
        const asset = this.assetCache.get(assetId)
        if (!asset) throw editorError('ASSET_NOT_FOUND', 'History material is unavailable.')
        return asset
      },
      resolvePersonalAsset: async (personalAssetId: string, versionId: string): Promise<PersonalAssetBundle> => {
        const bundle = this.personalAssetCache.get(personalAssetKey(personalAssetId, versionId))
        if (!bundle) throw editorError('ASSET_NOT_FOUND', 'History personal asset is unavailable.')
        return bundle
      }
    }
    const resolver: FabricEditorAssetResolver = {
      resolveAsset: this.resolver?.resolveAsset ?? fallbackResolver.resolveAsset,
      resolvePersonalAsset: this.resolver?.resolvePersonalAsset ?? fallbackResolver.resolvePersonalAsset
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
    prepared.corePattern?.release()
    for (const object of prepared.objects) object.release()
  }

  private releaseObject(object: FabricObjectPort): void {
    const release = this.objectResources.get(object)
    if (release) {
      this.objectResources.delete(object)
      release()
    }
  }

  private selectionProjection(object: FabricObjectPort | null | undefined): EditorSelectionProjection | undefined {
    if (
      !object
      || typeof object.objectId !== 'string'
      || object.objectId.length === 0
      || !runtimeObjectKind(object)
      || object.selectable === false
      || this.recoveryPlaceholders.has(object)
      || typeof object.getBoundingRect !== 'function'
    ) return undefined

    try {
      const bounds = object.getBoundingRect(true, true)
      if (
        !Number.isFinite(bounds.left)
        || !Number.isFinite(bounds.top)
        || !Number.isFinite(bounds.width)
        || !Number.isFinite(bounds.height)
        || bounds.width <= 0
        || bounds.height <= 0
      ) return undefined
      return {
        objectId: object.objectId,
        bounds: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height
        },
        ...(runtimeObjectKind(object) === 'system_sticker'
          ? {}
          : {
              kind: runtimeObjectKind(object),
              canChangeLayer: runtimeObjectKind(object) === 'personal_element'
            })
      }
    } catch {
      return undefined
    }
  }

  private emitSelection(event: EditorSelectionEvent): void {
    for (const listener of this.selectionListeners) {
      try {
        if (event.type === 'cleared') listener({ type: 'cleared', selection: null })
        else listener({
          type: event.type,
          selection: {
            objectId: event.selection.objectId,
            bounds: { ...event.selection.bounds },
            ...(event.selection.kind === undefined ? {} : { kind: event.selection.kind }),
            ...(event.selection.canChangeLayer === undefined ? {} : { canChangeLayer: event.selection.canChangeLayer })
          }
        })
      } catch {
        // One view listener must not break Fabric's event pipeline.
      }
    }
  }

  private emitSelectionFor(type: 'selected' | 'geometry' | 'double-click', object: FabricObjectPort | null | undefined): void {
    const selection = this.selectionProjection(object)
    if (selection) this.emitSelection({ type, selection })
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
    const runtimeObjects = canvas.getObjects()
    const elements = runtimeObjects.filter(isElementRuntimeObject)
    const systemObjects: SceneObject[] = []
    const personalElements: ScenePersonalElement[] = []
    elements.forEach((object, index) => {
      const zIndex = index + 1
      if (runtimeObjectKind(object) === 'personal_element') {
        personalElements.push(fabricObjectToPersonalElement(object, zIndex))
      } else {
        systemObjects.push(fabricObjectToSceneObject(object, zIndex))
      }
    })
    const coreObject = runtimeObjects.find((object) => runtimeObjectKind(object) === 'core_pattern')
    return {
      ...metadata,
      schemaVersion: SCHEMA_VERSION,
      canvas: {
        width: canvas.getWidth(),
        height: canvas.getHeight(),
        ...(this.backgroundColor === undefined ? {} : { backgroundColor: this.backgroundColor, backgroundColorSource: 'user' as const })
      },
      backgroundAssetId: this.backgroundAssetId,
      objects: systemObjects,
      personalBackground: this.personalBackground,
      corePattern: coreObject ? fabricObjectToCorePattern(coreObject) : null,
      personalElements,
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
    sceneObjectKind: 'system_sticker',
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

interface PersonalObjectOptionsInput {
  objectId: string
  personalAssetId: string
  versionId: string
  left: number
  top: number
  scaleX: number
  scaleY: number
  angle: number
  visible: boolean
  locked: boolean
  zIndex?: number
  sceneObjectKind?: SceneObjectKind
}

function personalObjectOptions(object: PersonalObjectOptionsInput): Record<string, unknown> {
  return {
    objectId: object.objectId,
    personalAssetId: object.personalAssetId,
    versionId: object.versionId,
    sceneObjectKind: 'zIndex' in object ? 'personal_element' : 'core_pattern',
    ...('zIndex' in object ? { zIndex: object.zIndex } : {}),
    originX: 'center',
    originY: 'center',
    left: object.left,
    top: object.top,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    angle: normalizeSceneAngle(object.angle),
    visible: object.visible,
    selectable: !object.locked,
    evented: !object.locked,
    lockMovementX: object.locked,
    lockMovementY: object.locked,
    lockScalingX: object.locked,
    lockScalingY: object.locked,
    lockUniScaling: true,
    lockScalingFlip: true,
    lockSkewingX: true,
    lockSkewingY: true,
    lockRotation: object.locked
  }
}

function fabricObjectToSceneObject(object: FabricObjectPort, zIndex: number): SceneObject {
  if (!object.objectId || !object.assetId || runtimeObjectKind(object) !== 'system_sticker' || object.assetType !== 'sticker') {
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

function fabricObjectToCorePattern(object: FabricObjectPort): SceneCorePatternObject {
  if (!object.objectId || !object.personalAssetId || !object.versionId || runtimeObjectKind(object) !== 'core_pattern') {
    throw editorError('SCENE_VALIDATION_FAILED', 'Canvas core pattern is missing its Personal Asset reference.')
  }
  return fabricObjectToPersonalTransform(object)
}

function fabricObjectToPersonalElement(object: FabricObjectPort, zIndex: number): ScenePersonalElement {
  if (!object.objectId || !object.personalAssetId || !object.versionId || runtimeObjectKind(object) !== 'personal_element') {
    throw editorError('SCENE_VALIDATION_FAILED', 'Canvas personal element is missing its Personal Asset reference.')
  }
  return { ...fabricObjectToPersonalTransform(object), zIndex }
}

function fabricObjectToPersonalTransform(object: FabricObjectPort): SceneCorePatternObject {
  if (hasUnsupportedFabricTransform(object)) {
    throw editorError('SCENE_VALIDATION_FAILED', 'Fabric flip/skew transforms are not representable in SceneDocument.')
  }
  const scaleX = object.scaleX
  const scaleY = object.scaleY
  if (typeof scaleX !== 'number' || !Number.isFinite(scaleX) || typeof scaleY !== 'number' || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    throw editorError('SCENE_VALIDATION_FAILED', 'Personal Asset scale is invalid.')
  }
  return {
    objectId: object.objectId!,
    personalAssetId: object.personalAssetId!,
    versionId: object.versionId!,
    left: finiteOrThrow(object.left, 'Personal Asset position is invalid.'),
    top: finiteOrThrow(object.top, 'Personal Asset position is invalid.'),
    scaleX,
    scaleY,
    angle: normalizeSceneAngle(object.angle ?? 0),
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

function runtimeObjectKind(object: FabricObjectPort): SceneObjectKind | undefined {
  if (object.sceneObjectKind === 'system_sticker' || object.sceneObjectKind === 'core_pattern' || object.sceneObjectKind === 'personal_element') {
    return object.sceneObjectKind
  }
  return object.assetType === 'sticker' ? 'system_sticker' : undefined
}

function isElementRuntimeObject(object: FabricObjectPort): boolean {
  const kind = runtimeObjectKind(object)
  return kind === 'system_sticker' || kind === 'personal_element'
}

function personalAssetKey(personalAssetId: string, versionId: string): string {
  return `${personalAssetId}:${versionId}`
}

function personalLoadFailure(personalRecoveryCode: PersonalRecoveryCode, message: string): PersonalLoadFailure {
  return { personalRecoveryCode, message }
}

function isPersonalLoadFailure(value: unknown): value is PersonalLoadFailure {
  return value !== null
    && typeof value === 'object'
    && 'personalRecoveryCode' in value
    && typeof value.personalRecoveryCode === 'string'
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
