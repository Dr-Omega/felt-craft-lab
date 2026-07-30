import type { SchemaVersion, UtcIso8601 } from './common'

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
  createdAt: UtcIso8601
  updatedAt: UtcIso8601
}

