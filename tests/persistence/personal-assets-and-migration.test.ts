import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFeltCraftDatabase,
  DraftStore,
  FELT_PERSISTENCE_DB_VERSION,
  PersonalAssetStore,
  PersonalAssetVersionStore,
  ProjectStore,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'
import { cloneFixture, fixtureTime, validAccess, validFeltDraft, validFeltProject, validScene } from './fixtures'

const personalAssetId = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
const versionId = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const userId = 'user_demo_001'

function legacyScene(): Record<string, unknown> {
  const scene = cloneFixture(validScene) as unknown as Record<string, unknown>
  scene.schemaVersion = 1
  delete scene.personalBackground
  delete scene.corePattern
  delete scene.personalElements
  return scene
}

const personalVersion = {
  versionId,
  personalAssetId,
  versionNumber: 1,
  sourceImageRef: 'felt-resource://material/personal-flower-v1.png',
  parentVersionId: null,
  createdAt: fixtureTime
}

const personalAsset = {
  personalAssetId,
  userId,
  role: 'element' as const,
  sourceType: 'uploaded' as const,
  name: '我的花朵',
  currentVersionId: versionId,
  createdAt: fixtureTime,
  updatedAt: fixtureTime
}

describe('Draft and Project record migration', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-migration-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await db.delete()
  })

  it('migrates old Draft V1 on get/list and persists V2 on the next save', async () => {
    const raw = { ...cloneFixture(validFeltDraft()), scene: legacyScene() }
    await db.table('drafts').put(raw)
    const store = new DraftStore(db)

    const restored = await store.get(raw.draftId)
    expect(restored?.scene.schemaVersion).toBe(2)
    expect(restored?.scene.objects).toEqual(validScene.objects)
    expect((await store.list())[0]?.scene.personalElements).toEqual([])

    await store.save(restored)
    const persisted = await db.table('drafts').get(raw.draftId)
    expect((persisted as { scene: { schemaVersion: number } }).scene.schemaVersion).toBe(2)
  })

  it('migrates old Project V1 while preserving project fields and preview', async () => {
    const raw = { ...cloneFixture(validFeltProject()), scene: legacyScene() }
    await db.table('projects').put(raw)
    const restored = await new ProjectStore(db).get(raw.projectId)

    expect(restored).toMatchObject({
      projectName: raw.projectName,
      previewUrl: raw.previewUrl,
      syncStatus: raw.syncStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    })
    expect(restored?.scene.schemaVersion).toBe(2)
  })
})

describe('Dexie V2 upgrade and personal asset stores', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-personal-assets-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await db.delete()
  })

  it('upgrades V1 tables without losing Draft, Project, AssetAccess, or Favorite rows', async () => {
    const name = `felt-upgrade-${crypto.randomUUID()}`
    const oldDb = new Dexie(name)
    oldDb.version(1).stores({
      drafts: 'draftId, updatedAt',
      projects: 'projectId, updatedAt, projectName',
      assetAccess: '[userId+assetId], userId, assetId, updatedAt',
      favorites: '[userId+assetId], userId, assetId, createdAt'
    })
    await oldDb.open()
    await oldDb.table('drafts').put({ ...cloneFixture(validFeltDraft()), scene: legacyScene() })
    await oldDb.table('projects').put({ ...cloneFixture(validFeltProject()), scene: legacyScene() })
    await oldDb.table('assetAccess').put(validAccess)
    await oldDb.table('favorites').put({ userId: validAccess.userId, assetId: validAccess.assetId, createdAt: fixtureTime })
    await oldDb.close()

    const upgraded = createFeltCraftDatabase(name)
    await upgraded.open()
    expect(FELT_PERSISTENCE_DB_VERSION).toBe(2)
    expect(await upgraded.table('drafts').count()).toBe(1)
    expect(await upgraded.table('projects').count()).toBe(1)
    expect(await upgraded.table('assetAccess').count()).toBe(1)
    expect(await upgraded.table('favorites').count()).toBe(1)
    expect(await upgraded.table('personalAssets').count()).toBe(0)
    expect(await upgraded.table('personalAssetVersions').count()).toBe(0)
    await upgraded.delete()
  })

  it('supports PersonalAsset and PersonalAssetVersion CRUD with independent tables', async () => {
    const versions = new PersonalAssetVersionStore(db)
    const assets = new PersonalAssetStore(db)
    await versions.save(personalVersion)
    await assets.save(personalAsset)

    expect(await assets.get(personalAssetId)).toEqual(personalAsset)
    expect(await assets.listForUser(userId)).toHaveLength(1)
    expect(await versions.get(versionId)).toEqual(personalVersion)
    expect(await versions.listForAsset(personalAssetId)).toEqual([personalVersion])

    await assets.delete(personalAssetId)
    expect(await assets.get(personalAssetId)).toBeUndefined()
    expect(await versions.get(versionId)).toEqual(personalVersion)
    await versions.delete(versionId)
    expect(await versions.get(versionId)).toBeUndefined()
  })

  it('makes PersonalAssetVersion immutable while allowing exact idempotent saves', async () => {
    const versions = new PersonalAssetVersionStore(db)
    const savedV1 = await versions.save(personalVersion)
    expect(await versions.save({ ...personalVersion })).toEqual(savedV1)
    expect(await db.table('personalAssetVersions').count()).toBe(1)

    const version2 = {
      ...personalVersion,
      versionId: 'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19',
      versionNumber: 2,
      parentVersionId: versionId
    }
    await versions.save(version2)

    const mutations = [
      { ...version2, sourceImageRef: 'felt-resource://material/personal-flower-v2.png' },
      { ...version2, personalAssetId: '7b3a9d6e-9b80-4f4f-9c47-44ef1e910f35' },
      { ...version2, versionNumber: 3 },
      { ...version2, parentVersionId: 'b4bcf8d2-f1f3-42d2-89ef-8c62b6a8e171' },
      { ...version2, createdAt: '2026-07-31T05:20:00.000Z' }
    ]
    for (const mutation of mutations) {
      await expect(versions.save(mutation)).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })
    }

    expect(await versions.get(versionId)).toEqual(personalVersion)
    expect(await versions.get(version2.versionId)).toEqual(version2)
    expect(await db.table('personalAssetVersions').count()).toBe(2)
  })

  it('enforces contiguous Personal Asset Version chains and unique version numbers', async () => {
    const versions = new PersonalAssetVersionStore(db)
    await versions.save(personalVersion)

    await expect(versions.save({
      ...personalVersion,
      versionId: 'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19',
      versionNumber: 2,
      parentVersionId: 'f3d111f5-f6a8-4b45-83af-2c90c6036f52'
    })).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })

    const otherAssetId = '7b3a9d6e-9b80-4f4f-9c47-44ef1e910f35'
    const otherVersionId = 'b4bcf8d2-f1f3-42d2-89ef-8c62b6a8e171'
    await versions.save({
      ...personalVersion,
      personalAssetId: otherAssetId,
      versionId: otherVersionId
    })
    await expect(versions.save({
      ...personalVersion,
      versionId: 'c7f0e8a2-09a7-4532-b3bb-9960be7af1d7',
      versionNumber: 2,
      parentVersionId: otherVersionId
    })).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })

    await expect(versions.save({
      ...personalVersion,
      versionId: 'd8a1009a-12de-4bd6-b5e4-33b70e4cd2c6',
      versionNumber: 3,
      parentVersionId: versionId
    })).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })

    await expect(versions.save({
      ...personalVersion,
      versionId: 'e9a2110b-23ef-4ce7-c6f5-44c81f5de3d7'
    })).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })

    const version2 = {
      ...personalVersion,
      versionId: 'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19',
      versionNumber: 2,
      parentVersionId: versionId
    }
    const version3 = {
      ...personalVersion,
      versionId: 'c7f0e8a2-09a7-4532-b3bb-9960be7af1d7',
      versionNumber: 3,
      parentVersionId: version2.versionId
    }
    await expect(versions.save(version2)).resolves.toEqual(version2)
    await expect(versions.save(version3)).resolves.toEqual(version3)
    expect(await versions.listForAsset(personalAssetId)).toHaveLength(3)
  })

  it('rejects a current version row owned by another Personal Asset at the Store boundary', async () => {
    const versions = new PersonalAssetVersionStore(db)
    const assets = new PersonalAssetStore(db)
    await versions.save({
      ...personalVersion,
      personalAssetId: '7b3a9d6e-9b80-4f4f-9c47-44ef1e910f35'
    })
    await expect(assets.save(personalAsset)).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })
    await db.table('personalAssets').put(personalAsset)
    await expect(assets.get(personalAssetId)).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })
  })

  it('validates a raw current version row before trusting its ownership', async () => {
    const assets = new PersonalAssetStore(db)
    await db.table('personalAssetVersions').put({
      ...personalVersion,
      sourceImageRef: 'https://example.com/not-safe.png'
    })

    await expect(assets.save(personalAsset)).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })
    await db.table('personalAssets').put(personalAsset)
    await expect(assets.get(personalAssetId)).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })
  })
})
