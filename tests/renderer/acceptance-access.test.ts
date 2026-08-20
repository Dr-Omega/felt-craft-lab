import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { AssetAccessState, AssetRecord } from '../../src/shared/contracts'
import {
  editorAssetsForAcceptanceAccess,
  isAcceptanceUnlockAllAssetsEnabled,
  isAssetUnlocked,
  seedAcceptanceUnlockedAccess
} from '../../src/renderer/src/catalog/acceptance-access'
import {
  AssetAccessStore,
  createFeltCraftDatabase,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'

function asset(assetId: string, type: AssetRecord['type']): AssetRecord {
  return {
    assetId,
    type,
    themeId: 'spring_festival',
    categoryIds: ['test'],
    nameZh: assetId,
    nameEn: assetId,
    introZh: 'test',
    keywords: [],
    imageUrl: `felt-resource://material/snapshot-test/${assetId}.png`,
    audio: {},
    contentVersion: 1,
    status: 'ready'
  }
}

describe('acceptance unlock-all-assets mode', () => {
  it('recognizes only the explicit true flag', () => {
    expect(isAcceptanceUnlockAllAssetsEnabled('true')).toBe(true)
    expect(isAcceptanceUnlockAllAssetsEnabled('false')).toBe(false)
    expect(isAcceptanceUnlockAllAssetsEnabled(undefined)).toBe(false)
  })

  it('seeds unlocked access for every current Editor asset when enabled', async () => {
    const assets = [asset('background-1', 'background'), asset('sticker-1', 'sticker')]
    const saved: AssetAccessState[] = []
    const store = {
      listForUser: async () => [],
      save: async (raw: AssetAccessState): Promise<AssetAccessState> => {
        saved.push(raw)
        return raw
      }
    }

    const seeded = await seedAcceptanceUnlockedAccess(store, assets, true)

    expect(editorAssetsForAcceptanceAccess(assets)).toHaveLength(2)
    expect(seeded).toHaveLength(2)
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'user_demo_001', assetId: 'background-1', unlocked: true }),
      expect.objectContaining({ userId: 'user_demo_001', assetId: 'sticker-1', unlocked: true })
    ]))
    expect(saved.every((row) => isAssetUnlocked(row))).toBe(true)
  })

  it('writes through AssetAccessStore and can be read by the normal refresh path', async () => {
    const db: FeltCraftDatabase = createFeltCraftDatabase(`felt-acceptance-${crypto.randomUUID()}`)
    try {
      const store = new AssetAccessStore(db)
      await seedAcceptanceUnlockedAccess(store, [asset('background-1', 'background')], true)

      const rows = await store.listForUser('user_demo_001')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ assetId: 'background-1', unlocked: true })
    } finally {
      await db.delete()
    }
  })

  it('does not rewrite access rows that are already unlocked', async () => {
    const assets = [asset('background-1', 'background')]
    const saved: AssetAccessState[] = []
    const store = {
      listForUser: async () => [
        {
          userId: 'user_demo_001',
          assetId: 'background-1',
          unlocked: true,
          updatedAt: new Date().toISOString()
        }
      ],
      save: async (raw: AssetAccessState): Promise<AssetAccessState> => {
        saved.push(raw)
        return raw
      }
    }

    const seeded = await seedAcceptanceUnlockedAccess(store, assets, true)

    expect(seeded).toHaveLength(0)
    expect(saved).toHaveLength(0)
  })

  it('does not write access when the flag is disabled, so absent rows stay locked', async () => {
    const saved: AssetAccessState[] = []
    const store = {
      listForUser: async () => [],
      save: async (raw: AssetAccessState): Promise<AssetAccessState> => {
        saved.push(raw)
        return raw
      }
    }

    await seedAcceptanceUnlockedAccess(store, [asset('sticker-1', 'sticker')], false)

    expect(saved).toHaveLength(0)
    expect(isAssetUnlocked(undefined)).toBe(false)
  })
})
