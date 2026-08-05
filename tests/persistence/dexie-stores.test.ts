import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AssetAccessStore,
  createFeltCraftDatabase,
  DraftStore,
  FavoriteStore,
  isFavoriteRecord,
  ProjectStore,
  setFeltCraftDatabaseForTests,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'
import { cloneFixture, feltPreviewRef, fixtureTime, validAccess, validFeltDraft, validFeltProject } from './fixtures'

describe('Dexie V1 stores', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-test-${crypto.randomUUID()}`)
    setFeltCraftDatabaseForTests(db)
  })

  afterEach(async () => {
    setFeltCraftDatabaseForTests(undefined)
    await db.delete()
  })

  it('supports Draft CRUD with contract validation', async () => {
    const store = new DraftStore(db)
    const draft = validFeltDraft()
    const saved = await store.save(draft)
    expect(saved.draftId).toBe(draft.draftId)
    expect(await store.get(draft.draftId)).toEqual(draft)
    expect(await store.list()).toHaveLength(1)
    await store.delete(draft.draftId)
    expect(await store.get(draft.draftId)).toBeUndefined()
  })

  it('rejects illegal Draft on write and read', async () => {
    const store = new DraftStore(db)
    const bad = cloneFixture(validFeltDraft())
    // @ts-expect-error intentional invalid status
    bad.status = 'published'
    await expect(store.save(bad)).rejects.toMatchObject({ shared: { code: 'DRAFT_SAVE_FAILED' } })

    await db.table('drafts').put({
      draftId: 'cc2b2db3-0ef0-4db9-a89c-b2fb0eff1dc1',
      scene: validFeltDraft().scene,
      updatedAt: fixtureTime,
      status: 'published'
    })
    await expect(store.get('cc2b2db3-0ef0-4db9-a89c-b2fb0eff1dc1')).rejects.toMatchObject({
      shared: { code: 'DRAFT_SAVE_FAILED' }
    })
  })

  it('supports Project CRUD with FELT_RESOURCE_REF_POLICY', async () => {
    const store = new ProjectStore(db)
    const project = validFeltProject({ previewUrl: feltPreviewRef('aaaaaaaabbbb4ccc8dddeeeeeeeeeeee.png') })
    await store.save(project)
    expect(await store.get(project.projectId)).toEqual(project)
    expect(await store.list()).toHaveLength(1)
    await store.delete(project.projectId)
    expect(await store.get(project.projectId)).toBeUndefined()
  })

  it('rejects Project with mock:// previewUrl under felt policy', async () => {
    const store = new ProjectStore(db)
    const project = validFeltProject({
      previewUrl: 'mock://previews/c3ac4f13-c4be-4ce0-8781-c60b78a21e83.png'
    })
    await expect(store.save(project)).rejects.toMatchObject({ shared: { code: 'PROJECT_SAVE_FAILED' } })
  })

  it('supports AssetAccess CRUD with compound key', async () => {
    const store = new AssetAccessStore(db)
    const access = cloneFixture(validAccess)
    await store.save(access)
    expect(await store.get(access.userId, access.assetId)).toEqual(access)
    expect(await store.listForUser(access.userId)).toHaveLength(1)
    await store.delete(access.userId, access.assetId)
    expect(await store.get(access.userId, access.assetId)).toBeUndefined()
  })

  it('rejects illegal AssetAccess on write', async () => {
    const store = new AssetAccessStore(db)
    const bad = cloneFixture(validAccess)
    // @ts-expect-error intentional
    bad.unlocked = 'yes'
    await expect(store.save(bad)).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT' } })
  })

  it('enforces Favorites uniqueness on [userId+assetId]', async () => {
    const store = new FavoriteStore(db)
    const favorite = {
      userId: validAccess.userId,
      assetId: validAccess.assetId,
      createdAt: fixtureTime
    }
    await store.save(favorite)
    await store.save({ ...favorite, createdAt: '2026-07-31T05:20:00.000Z' })
    const listed = await store.listForUser(favorite.userId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.createdAt).toBe('2026-07-31T05:20:00.000Z')
    expect(await store.get(favorite.userId, favorite.assetId)).toMatchObject({
      createdAt: '2026-07-31T05:20:00.000Z'
    })
  })

  it('rejects illegal Favorites', async () => {
    const store = new FavoriteStore(db)
    await expect(store.save({ userId: '', assetId: 'a', createdAt: fixtureTime })).rejects.toMatchObject({
      shared: { code: 'INVALID_ARGUMENT' }
    })
  })

  it('rejects calendar-invalid Favorite timestamps without throwing from the validator', async () => {
    const store = new FavoriteStore(db)
    const illegalCalendar = {
      userId: validAccess.userId,
      assetId: validAccess.assetId,
      createdAt: '2026-02-31T05:20:00.000Z'
    }
    expect(() => isFavoriteRecord(illegalCalendar)).not.toThrow()
    expect(isFavoriteRecord(illegalCalendar)).toBe(false)
    await expect(store.save(illegalCalendar)).rejects.toMatchObject({
      shared: { code: 'INVALID_ARGUMENT' }
    })
  })
})
