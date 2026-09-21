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

function validFeltScene(): SceneDocument {
  const scene = cloneFixture(validScene)
  if (scene.subject) {
    scene.subject = {
      ...scene.subject,
      imageRef: feltPreviewRef('subjectrabbit00411181111111111111111.png')
    }
  }
  return scene
}

export function validFeltProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const scene = validFeltScene()
  return {
    projectId: 'c3ac4f13-c4be-4ce0-8781-c60b78a21e83',
    projectName: scene.workName,
    scene,
    previewUrl: feltPreviewRef(),
    completionStatus: 'completed',
    syncStatus: 'local_only',
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    ...overrides
  }
}

export function validFeltDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    ...cloneFixture(validDraft),
    scene: validFeltScene(),
    ...overrides
  }
}

export function preparedScene(overrides: Partial<SceneDocument> = {}): SceneDocument {
  return { ...validFeltScene(), ...overrides }
}

export { cloneFixture, fixtureTime, validAccess, validDraft, validScene }
