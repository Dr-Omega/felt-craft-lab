import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '../../src/shared/contracts'
import {
  assetsForTheme,
  normalizeSelectedAssetId,
  pickSelectedAsset
} from '../../src/renderer/src/catalog/editor-selection'

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

describe('editor theme-scoped selection', () => {
  const catalog = [
    asset({ assetId: 'sticker_spring_001', type: 'sticker', themeId: 'spring_festival' }),
    asset({ assetId: 'sticker_lantern_001', type: 'sticker', themeId: 'lantern_festival' }),
    asset({ assetId: 'background_spring_001', type: 'background', themeId: 'spring_festival' }),
    asset({ assetId: 'background_lantern_001', type: 'background', themeId: 'lantern_festival' })
  ]

  it('initializes selected ids from the Scene theme collections', () => {
    const stickers = assetsForTheme(catalog, 'sticker', 'lantern_festival')
    const backgrounds = assetsForTheme(catalog, 'background', 'lantern_festival')
    expect(stickers.map((row) => row.assetId)).toEqual(['sticker_lantern_001'])
    expect(backgrounds.map((row) => row.assetId)).toEqual(['background_lantern_001'])
    expect(normalizeSelectedAssetId('', stickers)).toBe('sticker_lantern_001')
    expect(normalizeSelectedAssetId('', backgrounds)).toBe('background_lantern_001')
  })

  it('normalizes stale cross-theme selected ids after theme/collection change', () => {
    const stickers = assetsForTheme(catalog, 'sticker', 'spring_festival')
    expect(normalizeSelectedAssetId('sticker_lantern_001', stickers)).toBe('sticker_spring_001')
    expect(pickSelectedAsset('sticker_lantern_001', stickers)).toBeUndefined()
    expect(pickSelectedAsset('sticker_spring_001', stickers)?.themeId).toBe('spring_festival')
  })

  it('returns empty selection when the theme has no assets of that type', () => {
    const empty = assetsForTheme(catalog, 'sticker', 'missing_theme')
    expect(normalizeSelectedAssetId('sticker_spring_001', empty)).toBe('')
    expect(pickSelectedAsset('sticker_spring_001', empty)).toBeUndefined()
  })
})
