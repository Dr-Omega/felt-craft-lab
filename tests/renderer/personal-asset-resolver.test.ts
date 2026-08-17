import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFeltCraftDatabase,
  PersonalAssetStore,
  PersonalAssetVersionStore,
  setFeltCraftDatabaseForTests,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'
import { createCatalogResolver } from '../../src/renderer/src/catalog/ywn-catalog'

const assetId = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
const v1Id = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const v2Id = 'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19'
const otherAssetId = '2a8c8c2b-66ef-43b5-9ea4-748af0eac3b4'
const otherVersionId = '8d4bbd2b-7288-4a19-b0dd-5bf43fd1cb9e'
const userId = 'user_demo_001'

const version = (versionId: string, versionNumber: number, parentVersionId: string | null, personalAssetId = assetId) => ({
  versionId,
  personalAssetId,
  versionNumber,
  sourceImageRef: `felt-resource://material/personal/${versionId}.png`,
  parentVersionId,
  createdAt: '2026-07-30T05:20:00.000Z'
})

const asset = {
  personalAssetId: assetId,
  userId,
  role: 'background' as const,
  sourceType: 'uploaded' as const,
  name: 'Historical background',
  currentVersionId: v2Id,
  createdAt: '2026-07-30T05:10:00.000Z',
  updatedAt: '2026-07-30T05:20:00.000Z'
}

describe('catalog Personal Asset resolver', () => {
  let db: FeltCraftDatabase

  beforeEach(async () => {
    db = createFeltCraftDatabase(`felt-resolver-${crypto.randomUUID()}`)
    const versions = new PersonalAssetVersionStore(db)
    await versions.save(version(v1Id, 1, null))
    await versions.save(version(v2Id, 2, v1Id))
    await new PersonalAssetStore(db).save(asset)
    setFeltCraftDatabaseForTests(db)
  })

  afterEach(async () => {
    setFeltCraftDatabaseForTests(undefined)
    await db.delete()
  })

  it('resolves a valid historical version without falling back to currentVersionId', async () => {
    const resolved = await createCatalogResolver().resolvePersonalAsset!(assetId, v1Id)
    expect(resolved.asset).toEqual(asset)
    expect(resolved.version).toEqual(version(v1Id, 1, null))
  })

  it('rejects missing asset, missing version, and wrong version ownership', async () => {
    const resolver = createCatalogResolver()
    await expect(resolver.resolvePersonalAsset!('1ea8d75e-5949-440c-9db5-c7b4eaf4a6d1', v1Id)).rejects.toThrow()
    await expect(resolver.resolvePersonalAsset!(assetId, '7f1d2e3c-4b5a-46c7-8d9e-0f1a2b3c4d5e')).rejects.toThrow()

    const versions = new PersonalAssetVersionStore(db)
    await versions.save(version(otherVersionId, 1, null, otherAssetId))
    await expect(resolver.resolvePersonalAsset!(assetId, otherVersionId)).rejects.toThrow()
  })
})
