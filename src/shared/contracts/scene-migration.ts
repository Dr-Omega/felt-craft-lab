import { LEGACY_SCENE_SCHEMA_VERSION, SCHEMA_VERSION } from './common'
import type { SceneDocument } from './scene'

type RawObject = Record<string, unknown>

function clonePersistedValue(raw: unknown): unknown {
  try {
    return structuredClone(raw)
  } catch {
    throw new Error('Persisted SceneDocument cannot be cloned.')
  }
}

function requireObject(raw: unknown): RawObject {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Persisted SceneDocument must be an object.')
  }
  return raw as RawObject
}

/**
 * Explicitly migrates persisted Scene data before the V2 runtime validator.
 * The input is never mutated and V2 data is cloned without business changes.
 */
export function migrateSceneDocument(raw: unknown): SceneDocument {
  const cloned = clonePersistedValue(raw)
  const value = requireObject(cloned)

  if (value.schemaVersion === LEGACY_SCENE_SCHEMA_VERSION) {
    return {
      ...value,
      schemaVersion: SCHEMA_VERSION,
      personalBackground: null,
      corePattern: null,
      personalElements: []
    } as unknown as SceneDocument
  }

  if (value.schemaVersion === SCHEMA_VERSION) {
    return value as unknown as SceneDocument
  }

  throw new Error(`Unsupported SceneDocument schemaVersion: ${String(value.schemaVersion)}`)
}

export function migrateDraftRecord(raw: unknown): unknown {
  const cloned = clonePersistedValue(raw)
  const value = requireObject(cloned)
  return {
    ...value,
    scene: migrateSceneDocument(value.scene)
  }
}

export function migrateProjectRecord(raw: unknown): unknown {
  const cloned = clonePersistedValue(raw)
  const value = requireObject(cloned)
  return {
    ...value,
    scene: migrateSceneDocument(value.scene)
  }
}
