import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '../../src/shared/contracts'
import {
  UNKNOWN_CATEGORY_DISPLAY,
  categoryDisplayName,
  deriveCategoriesFromAssets,
  filterAssetsByCategoryAndQuery
} from '../../src/renderer/src/catalog/category-display'

function makeAsset(overrides: Partial<AssetRecord> & { assetId: string; categoryIds: string[]; nameZh: string; nameEn: string; keywords: string[] }): AssetRecord {
  return {
    type: 'sticker',
    themeId: 'spring_festival',
    introZh: '',
    imageUrl: 'felt-resource://material/snap/x.png',
    audio: {},
    contentVersion: 1,
    status: 'ready',
    ...overrides
  } as AssetRecord
}

describe('categoryDisplayName', () => {
  it('returns a known display name for the YWN festival categories', () => {
    expect(categoryDisplayName('festival_scene')).toBe('场景')
    expect(categoryDisplayName('festival_decoration')).toBe('装饰')
    expect(categoryDisplayName('festival_food')).toBe('食物')
    expect(categoryDisplayName('festival_story')).toBe('故事角色')
    expect(categoryDisplayName('festival_poetry')).toBe('诗词')
    expect(categoryDisplayName('festival_custom')).toBe('习俗')
  })

  it('accepts the short-form aliases used by older snapshots', () => {
    expect(categoryDisplayName('scene')).toBe('场景')
    expect(categoryDisplayName('decoration')).toBe('装饰')
    expect(categoryDisplayName('food')).toBe('食物')
    expect(categoryDisplayName('story')).toBe('故事角色')
    expect(categoryDisplayName('poetry')).toBe('诗词')
    expect(categoryDisplayName('custom')).toBe('习俗')
  })

  it('falls back to the generic "其他" label for any unknown id so a child never sees a raw snake_case id', () => {
    expect(categoryDisplayName('galaxy_nebula')).toBe('其他')
    expect(categoryDisplayName('foo_bar')).toBe('其他')
    expect(categoryDisplayName('test_category')).toBe('其他')
    expect(categoryDisplayName('festival_poetry_extra')).toBe('其他')
  })

  it('exposes UNKNOWN_CATEGORY_DISPLAY as the pin-able generic label', () => {
    expect(UNKNOWN_CATEGORY_DISPLAY).toBe('其他')
  })

  it('returns "未分类" only when the input is empty or not a string', () => {
    expect(categoryDisplayName('')).toBe('未分类')
    // @ts-expect-error — exercising the runtime guard, not the TS contract.
    expect(categoryDisplayName(undefined)).toBe('未分类')
    // @ts-expect-error — exercising the runtime guard, not the TS contract.
    expect(categoryDisplayName(null)).toBe('未分类')
  })

  it('never returns a display name that still contains snake_case underscores for any known or unknown id', () => {
    const samples = [
      'festival_scene', 'festival_decoration', 'festival_food', 'festival_story',
      'festival_poetry', 'festival_custom',
      'scene', 'decoration', 'food', 'story', 'poetry', 'custom',
      'galaxy_nebula', 'foo_bar', 'test_category',
      'festival_poetry_extra', 'mystery', 'A', ''
    ]
    for (const id of samples) {
      const display = categoryDisplayName(id)
      if (display === '未分类') continue
      expect(display, `id=${id} → display=${display}`).not.toMatch(/_/)
    }
  })
})

describe('deriveCategoriesFromAssets', () => {
  it('aggregates every categoryId across the current asset set and counts it once per asset', () => {
    const assets = [
      makeAsset({ assetId: 'a1', nameZh: '灯笼', nameEn: 'Lantern', keywords: ['lantern'], categoryIds: ['festival_decoration'] }),
      makeAsset({ assetId: 'a2', nameZh: '汤圆', nameEn: 'Tangyuan', keywords: ['riceball'], categoryIds: ['festival_food'] }),
      makeAsset({ assetId: 'a3', nameZh: '兔子', nameEn: 'Rabbit', keywords: ['rabbit'], categoryIds: ['festival_story'] }),
      makeAsset({ assetId: 'a4', nameZh: '桂花', nameEn: 'Osmanthus', keywords: ['flower'], categoryIds: ['galaxy_nebula'] })
    ]
    const categories = deriveCategoriesFromAssets(assets)
    const ids = categories.map((c) => c.id)
    expect(ids).toContain('festival_decoration')
    expect(ids).toContain('festival_food')
    expect(ids).toContain('festival_story')
    expect(ids).toContain('galaxy_nebula')
  })

  it('puts known categories before unknown ones in alphabetical order', () => {
    const assets = [
      makeAsset({ assetId: 'a1', nameZh: 'x', nameEn: 'X', keywords: [], categoryIds: ['zeta_unknown'] }),
      makeAsset({ assetId: 'a2', nameZh: 'y', nameEn: 'Y', keywords: [], categoryIds: ['festival_food'] }),
      makeAsset({ assetId: 'a3', nameZh: 'z', nameEn: 'Z', keywords: [], categoryIds: ['festival_decoration'] })
    ]
    const categories = deriveCategoriesFromAssets(assets)
    const knownIds = categories.filter((c) => ['festival_food', 'festival_decoration'].includes(c.id)).map((c) => c.id)
    const unknownIds = categories.filter((c) => c.id === 'zeta_unknown').map((c) => c.id)
    // 装饰 and 食物 are both known; the test only asserts the *group* ordering
    // (known first, unknown last). The exact intra-group order depends on the
    // runtime locale collation, so we do not pin it here.
    expect(knownIds).toHaveLength(2)
    expect(unknownIds).toEqual(['zeta_unknown'])
    const firstUnknownIndex = categories.findIndex((c) => c.id === 'zeta_unknown')
    const lastKnownIndex = categories
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.id !== 'zeta_unknown')
      .pop()!.i
    expect(firstUnknownIndex).toBeGreaterThan(lastKnownIndex)
  })

  it('never returns categories that no current asset advertises', () => {
    const assets = [makeAsset({ assetId: 'a1', nameZh: 'x', nameEn: 'X', keywords: [], categoryIds: ['festival_food'] })]
    const categories = deriveCategoriesFromAssets(assets)
    expect(categories.map((c) => c.id)).toEqual(['festival_food'])
  })
})

describe('filterAssetsByCategoryAndQuery', () => {
  const assets = [
    makeAsset({ assetId: 'a1', nameZh: '汤圆', nameEn: 'Tangyuan', keywords: ['riceball', '元夕'], categoryIds: ['festival_food'] }),
    makeAsset({ assetId: 'a2', nameZh: '兔子', nameEn: 'Jade Rabbit', keywords: ['mid-autumn', '玉兔'], categoryIds: ['festival_story'] }),
    makeAsset({ assetId: 'a3', nameZh: '灯笼', nameEn: 'Lantern', keywords: ['lantern', 'lantern-street'], categoryIds: ['festival_decoration'] })
  ]

  it('passes every asset through when category is all and query is empty', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'all', searchQuery: '' })
    expect(out.map((a) => a.assetId)).toEqual(['a1', 'a2', 'a3'])
  })

  it('filters by categoryId strictly', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'festival_food', searchQuery: '' })
    expect(out.map((a) => a.assetId)).toEqual(['a1'])
  })

  it('matches Chinese nameZh substring', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'all', searchQuery: '兔' })
    expect(out.map((a) => a.assetId)).toEqual(['a2'])
  })

  it('matches English nameEn substring case-insensitively', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'all', searchQuery: 'JADE' })
    expect(out.map((a) => a.assetId)).toEqual(['a2'])
  })

  it('matches any keyword case-insensitively', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'all', searchQuery: 'RICEBALL' })
    expect(out.map((a) => a.assetId)).toEqual(['a1'])
  })

  it('composes category and search (AND)', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'festival_food', searchQuery: '汤' })
    expect(out.map((a) => a.assetId)).toEqual(['a1'])
    const empty = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'festival_food', searchQuery: '兔' })
    expect(empty).toEqual([])
  })

  it('trims whitespace and returns everything for an empty trimmed query', () => {
    const out = filterAssetsByCategoryAndQuery(assets, { activeCategoryId: 'all', searchQuery: '   ' })
    expect(out).toHaveLength(3)
  })
})
