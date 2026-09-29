import { describe, expect, it } from 'vitest'
import type { AssetAccessState, AssetRecord } from '../../src/shared/contracts'
import {
  assetsForEditor,
  normalizeSelectedAssetId,
  pickSelectedAsset
} from '../../src/renderer/src/catalog/editor-selection'
import { isAssetUnlocked } from '../../src/renderer/src/catalog/asset-access-helpers'
import { seedAcceptanceUnlockedAccess } from '../../src/renderer/src/catalog/acceptance-access'
import {
  getCatalogAssetsForSnapshot,
  YWN_SNAPSHOT_ID
} from '../../src/renderer/src/catalog/ywn-catalog'
import { prepareNewWorkScene } from '../../src/renderer/src/catalog/library-new-work'

function asset(partial: Partial<AssetRecord> & Pick<AssetRecord, 'assetId' | 'type' | 'themeId'>): AssetRecord {
  return {
    categoryIds: ['x'],
    nameZh: partial.assetId,
    nameEn: partial.assetId,
    introZh: 'intro',
    keywords: [],
    imageUrl: `felt-resource://material/${partial.assetId}.png`,
    audio: {},
    contentVersion: 1,
    status: 'ready',
    ...partial
  }
}

describe('editor snapshot-scoped selection', () => {
  const catalog = [
    asset({ assetId: 'sticker_spring_001', type: 'sticker', themeId: 'spring_festival' }),
    asset({ assetId: 'sticker_lantern_001', type: 'sticker', themeId: 'lantern_festival' }),
    asset({ assetId: 'background_spring_001', type: 'background', themeId: 'spring_festival' }),
    asset({ assetId: 'background_lantern_001', type: 'background', themeId: 'lantern_festival' })
  ]

  it('shows every typed snapshot asset with the Scene theme first', () => {
    const stickers = assetsForEditor(catalog, 'sticker', 'lantern_festival')
    const backgrounds = assetsForEditor(catalog, 'background', 'lantern_festival')
    expect(stickers.map((row) => row.assetId)).toEqual([
      'sticker_lantern_001',
      'sticker_spring_001'
    ])
    expect(backgrounds.map((row) => row.assetId)).toEqual([
      'background_lantern_001',
      'background_spring_001'
    ])
    expect(normalizeSelectedAssetId('', stickers)).toBe('sticker_lantern_001')
    expect(normalizeSelectedAssetId('', backgrounds)).toBe('background_lantern_001')
  })

  it('keeps cross-theme assets selectable and preserves catalog order inside each group', () => {
    const stickers = assetsForEditor(catalog, 'sticker', 'spring_festival')
    expect(stickers.map((row) => row.assetId)).toEqual([
      'sticker_spring_001',
      'sticker_lantern_001'
    ])
    expect(normalizeSelectedAssetId('sticker_lantern_001', stickers)).toBe('sticker_lantern_001')
    expect(pickSelectedAsset('sticker_lantern_001', stickers)?.themeId).toBe('lantern_festival')
    expect(pickSelectedAsset('sticker_spring_001', stickers)?.themeId).toBe('spring_festival')
  })

  it('keeps all snapshot assets when the Scene theme has no matching asset', () => {
    const stickers = assetsForEditor(catalog, 'sticker', 'missing_theme')
    expect(stickers.map((row) => row.assetId)).toEqual([
      'sticker_spring_001',
      'sticker_lantern_001'
    ])
    expect(normalizeSelectedAssetId('sticker_spring_001', stickers)).toBe('sticker_spring_001')
  })

  it('keeps locked cross-theme sticker and background options visible but unusable', () => {
    const stickers = assetsForEditor(catalog, 'sticker', 'lantern_festival')
    const backgrounds = assetsForEditor(catalog, 'background', 'lantern_festival')
    const crossThemeSticker = pickSelectedAsset('sticker_spring_001', stickers)
    const crossThemeBackground = pickSelectedAsset('background_spring_001', backgrounds)

    expect(crossThemeSticker).toBeDefined()
    expect(crossThemeBackground).toBeDefined()
    expect(isAssetUnlocked(undefined)).toBe(false)
  })

  it('shows every theme from the acceptance Scene snapshot without crossing snapshot boundaries', () => {
    const prepared = prepareNewWorkScene('全主题验收作品', 'all')
    const scene = prepared.scene
    expect(scene?.assetSnapshotId).toBe(YWN_SNAPSHOT_ID)
    expect(scene?.themeId).not.toBe('all')

    const snapshotAssets = getCatalogAssetsForSnapshot(scene!.assetSnapshotId)
    for (const type of ['background', 'sticker'] as const) {
      const options = assetsForEditor(snapshotAssets, type, scene!.themeId)
      expect(new Set(options.map((asset) => asset.themeId)).size).toBeGreaterThan(1)
      expect(options.every((asset) => snapshotAssets.some((row) => row.assetId === asset.assetId))).toBe(true)
    }
  })

  it('combines all-theme selection with acceptance unlock-all access for both asset types', async () => {
    const prepared = prepareNewWorkScene('全主题全解锁验收作品', 'all')
    const snapshotAssets = getCatalogAssetsForSnapshot(prepared.scene!.assetSnapshotId)
    const saved: AssetAccessState[] = []
    await seedAcceptanceUnlockedAccess(
      {
        save: async (row: AssetAccessState) => {
          saved.push(row)
          return row
        }
      },
      snapshotAssets,
      true
    )
    const accessById = new Map(saved.map((row) => [row.assetId, row]))

    for (const type of ['background', 'sticker'] as const) {
      const options = assetsForEditor(snapshotAssets, type, prepared.scene!.themeId)
      expect(options.length).toBeGreaterThan(1)
      expect(options.every((asset) => isAssetUnlocked(accessById.get(asset.assetId)))).toBe(true)
    }
  })
})
