import { describe, expect, it } from 'vitest'
import { migrateSceneDocument, validateSceneDocument } from '../../src/shared/contracts'
import { cloneFixture, validScene } from './contracts.fixtures'

function legacyScene(): Record<string, unknown> {
  const scene = cloneFixture(validScene) as unknown as Record<string, unknown>
  scene.schemaVersion = 1
  delete scene.personalBackground
  delete scene.corePattern
  delete scene.personalElements
  return scene
}

describe('SceneDocument V1 to V2 migration', () => {
  it('preserves V1 fields and adds deterministic empty personal fields without mutation', () => {
    const raw = legacyScene()
    const before = cloneFixture(raw)
    const migrated = migrateSceneDocument(raw)

    expect(raw).toEqual(before)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.sceneId).toBe(validScene.sceneId)
    expect(migrated.backgroundAssetId).toBe(validScene.backgroundAssetId)
    expect(migrated.objects).toEqual(validScene.objects)
    expect(migrated.canvas).toEqual(validScene.canvas)
    expect(migrated.createdAt).toBe(validScene.createdAt)
    expect(migrated.updatedAt).toBe(validScene.updatedAt)
    expect(migrated.personalBackground).toBeNull()
    expect(migrated.corePattern).toBeNull()
    expect(migrated.personalElements).toEqual([])
    expect(validateSceneDocument(migrated).ok).toBe(true)
  })

  it('keeps already-valid V2 business data unchanged and rejects unknown versions', () => {
    const v2 = cloneFixture(validScene)
    expect(migrateSceneDocument(v2)).toEqual(v2)
    expect(() => migrateSceneDocument({ ...legacyScene(), schemaVersion: 99 })).toThrow(/Unsupported SceneDocument schemaVersion/)
  })
})
