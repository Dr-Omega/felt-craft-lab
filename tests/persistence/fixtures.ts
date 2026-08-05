import { cloneFixture, fixtureTime, validAccess, validDraft, validScene } from '../shared/contracts.fixtures'
import type { DraftRecord, ProjectRecord, SceneDocument } from '../../src/shared/contracts'

/** Minimal valid 1×1 PNG (binary). */
export const MINIMAL_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
)

/** Hyphen-free UUID filename — ResourceRef relative paths disallow `-`. */
export function feltPreviewRef(fileName = '11111111111141118111111111111111.png'): string {
  return `felt-resource://preview/${fileName}`
}

export function validFeltProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const scene = cloneFixture(validScene)
  return {
    projectId: 'c3ac4f13-c4be-4ce0-8781-c60b78a21e83',
    projectName: scene.workName,
    scene,
    previewUrl: feltPreviewRef(),
    syncStatus: 'local_only',
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    ...overrides
  }
}

export function validFeltDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    ...cloneFixture(validDraft),
    ...overrides
  }
}

export function preparedScene(overrides: Partial<SceneDocument> = {}): SceneDocument {
  return { ...cloneFixture(validScene), ...overrides }
}

export { cloneFixture, fixtureTime, validAccess, validDraft, validScene }
