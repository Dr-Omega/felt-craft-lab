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
const userId = 'd1be2c2e-7b1e-4b0f-a7f7-34bb0de5b9b8'

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
})
