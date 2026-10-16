import type { SchemaVersion, UtcIso8601 } from './common'

export interface ScenePersonalBackground {
  personalAssetId: string
  versionId: string
}

export interface ScenePersonalTransformBase {
  objectId: string
  personalAssetId: string
  versionId: string
  /** Centre-point x coordinate in pixels, from the canvas top-left origin. */
  left: number
  /** Centre-point y coordinate in pixels, from the canvas top-left origin. */
  top: number
  scaleX: number
  scaleY: number
  /** Clockwise degrees, normalized to [-180, 180). */
  angle: number
  visible: boolean
  locked: boolean
}

/** A personal core pattern occupies its own fixed tier and has no zIndex. */
export interface SceneCorePatternObject extends ScenePersonalTransformBase {}

/** Personal elements share the global Element tier with system stickers. */
export interface ScenePersonalElement extends ScenePersonalTransformBase {
  /** Global Element-tier position, continuous with SceneObject.zIndex. */
  zIndex: number
}

/** @deprecated Use SceneCorePatternObject or ScenePersonalElement explicitly. */
export type ScenePersonalObject = SceneCorePatternObject

export interface SceneObject {
  objectId: string
  assetId: string
  assetType: 'sticker'
  /** Centre-point x coordinate in pixels, from the canvas top-left origin. */
  left: number
  /** Centre-point y coordinate in pixels, from the canvas top-left origin. */
  top: number
  scaleX: number
  scaleY: number
  /** Clockwise degrees, normalized to [-180, 180). */
  angle: number
  /** Sticker layers are the continuous integer sequence 1..N. */
  zIndex: number
  visible: boolean
  locked: boolean
}

export interface SceneCanvas {
  width: number
  height: number
  backgroundColor?: string
  /** Explicit user-chosen artwork color, not the legacy editor paper surface. */
  backgroundColorSource?: 'user'
}

/**
 * The editable source of truth for a work. A preview is deliberately absent:
 * it is only a display artifact carried by ProjectRecord.
 */
export interface SceneDocument {
  schemaVersion: SchemaVersion
  sceneId: string
  userId: string
  workName: string
  themeId: string
  assetSnapshotId: string
  canvas: SceneCanvas
  /** A material background; null encodes either solid-color or transparent. */
  backgroundAssetId: string | null
  objects: SceneObject[]
  /** A version-pinned personal asset used as the whole-scene background. */
  personalBackground: ScenePersonalBackground | null
  /** A version-pinned whole instance of a personal core pattern. */
  corePattern: SceneCorePatternObject | null
  /** Version-pinned personal element instances. */
  personalElements: ScenePersonalElement[]
  createdAt: UtcIso8601
  updatedAt: UtcIso8601
}

