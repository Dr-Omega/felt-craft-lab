import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadFormalCatalog } from '../../src/renderer/src/catalog/load-formal-catalog'
import { isAssetUnlocked } from '../../src/renderer/src/catalog/asset-access-helpers'

const manifestPath = resolve('assets/generated/assets.manifest.json')

describe('formal catalog load boundary', () => {
  it('loads Manifest only after validateAssetRecord + snapshot context checks', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const catalog = loadFormalCatalog(raw)
    expect(catalog.assets).toHaveLength(71)
    expect(catalog.assetSnapshotId.startsWith('snapshot_ywn_')).toBe(true)
    expect(catalog.snapshotContext.snapshots[catalog.assetSnapshotId]).toHaveLength(71)
  })

  it('rejects bare type assertions by failing invalid Manifest roots', () => {
    expect(() => loadFormalCatalog({ assetSnapshotId: 'x', assets: 'nope' })).toThrow(/assets must be an array/)
    expect(() =>
      loadFormalCatalog({
        assetSnapshotId: 'snap',
        assets: [],
        snapshotContext: { snapshots: { snap: [{ assetId: 'a', type: 'sticker' }] } }
      })
    ).toThrow(/size/)
  })

  it('rejects test_only even if AssetRecord shape could otherwise validate', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      assetSnapshotId: string
      assets: Array<Record<string, unknown>>
      snapshotContext: { snapshots: Record<string, Array<{ assetId: string; type: string }>> }
    }
    const clone = structuredClone(raw)
    const first = clone.assets[0]!
    first.status = 'test_only'
    first.assetId = 'sticker_test_only_001'
    first.imageUrl = 'felt-resource://material/sticker_test_only_001.png'
    clone.snapshotContext.snapshots[clone.assetSnapshotId] = [
      ...clone.snapshotContext.snapshots[clone.assetSnapshotId],
      { assetId: 'sticker_test_only_001', type: String(first.type) }
    ]
    // Keep sizes aligned for the status check to be reached after validateAssetRecord
    // by replacing one ready asset instead of appending mismatched snapshot entries.
    const replaced = structuredClone(raw)
    replaced.assets[0] = { ...replaced.assets[0], status: 'test_only' }
    expect(() => loadFormalCatalog(replaced)).toThrow(/status must be ready/)
  })

  it('treats missing AssetAccess as locked', () => {
    expect(isAssetUnlocked(undefined)).toBe(false)
    expect(
      isAssetUnlocked({
        userId: 'user_demo_001',
        assetId: 'sticker_fu_001',
        unlocked: false,
        updatedAt: '2026-07-30T05:20:00.000Z'
      })
    ).toBe(false)
    expect(
      isAssetUnlocked({
        userId: 'user_demo_001',
        assetId: 'sticker_fu_001',
        unlocked: true,
        unlockSource: 'theme_complete',
        updatedAt: '2026-07-30T05:20:00.000Z'
      })
    ).toBe(true)
  })
})
