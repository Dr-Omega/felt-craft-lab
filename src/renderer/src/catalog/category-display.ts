import type { AssetRecord } from '@shared/contracts'

/**
 * Children-friendly Chinese display names for the known category ids shipped
 * with the YWN formal catalog. The internal categoryId is NEVER shown to a
 * child user — any unknown id falls back to the generic "其他" label so the
 * chip never displays a raw snake_case technical id. Asset filtering still
 * uses the original id, and assets are never hidden because of an unmapped
 * category.
 */
const KNOWN_CATEGORY_DISPLAY: Readonly<Record<string, string>> = Object.freeze({
  festival_scene: '场景',
  festival_decoration: '装饰',
  festival_food: '食物',
  festival_story: '故事角色',
  festival_poetry: '诗词',
  festival_custom: '习俗',
  // Defensive aliases so older snapshots that still emit them stay readable.
  scene: '场景',
  decoration: '装饰',
  food: '食物',
  story: '故事角色',
  poetry: '诗词',
  custom: '习俗'
})

/**
 * Generic fallback label shown to a child when the underlying categoryId
 * is not in the known map. Kept as a constant so tests can pin the
 * expected value and the renderer can rely on a single source of truth.
 */
export const UNKNOWN_CATEGORY_DISPLAY = '其他'

export function categoryDisplayName(categoryId: string): string {
  if (typeof categoryId !== 'string' || categoryId.length === 0) return '未分类'
  // The internal id never reaches a child. The known map is checked first;
  // anything else (including new categories that haven't been mapped yet)
  // gets the generic "其他" label so the chip list never shows snake_case.
  return KNOWN_CATEGORY_DISPLAY[categoryId] ?? UNKNOWN_CATEGORY_DISPLAY
}

export interface DerivedCategory {
  id: string
  displayName: string
  count: number
}

/**
 * Derive the dynamic category chip list from the current MaterialSheet
 * asset set. Ordering is: known-display first, unknown last, alphabetical
 * within each group. The "all" chip is always pinned at index 0 by callers.
 */
export function deriveCategoriesFromAssets(assets: readonly AssetRecord[]): DerivedCategory[] {
  const counts = new Map<string, number>()
  for (const asset of assets) {
    if (!Array.isArray(asset.categoryIds)) continue
    for (const id of asset.categoryIds) {
      if (typeof id !== 'string' || id.length === 0) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  const known: DerivedCategory[] = []
  const unknown: DerivedCategory[] = []
  for (const [id, count] of counts) {
    const entry: DerivedCategory = { id, displayName: categoryDisplayName(id), count }
    if (Object.prototype.hasOwnProperty.call(KNOWN_CATEGORY_DISPLAY, id)) known.push(entry)
    else unknown.push(entry)
  }

  known.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
  unknown.sort((a, b) => a.id.localeCompare(b.id))

  return [...known, ...unknown]
}

/**
 * Filter assets by the current active category and search query. The search
 * is a substring match across nameZh / nameEn / keywords with English
 * case-insensitive comparison. An empty query short-circuits to the category
 * filter only.
 */
export function filterAssetsByCategoryAndQuery(
  assets: readonly AssetRecord[],
  options: { activeCategoryId: string; searchQuery: string }
): AssetRecord[] {
  const { activeCategoryId, searchQuery } = options
  const query = searchQuery.trim().toLowerCase()

  return assets.filter((asset) => {
    if (activeCategoryId !== 'all' && !asset.categoryIds.includes(activeCategoryId)) {
      return false
    }
    if (query.length === 0) return true
    if (asset.nameZh.toLowerCase().includes(query)) return true
    if (asset.nameEn.toLowerCase().includes(query)) return true
    for (const keyword of asset.keywords) {
      if (typeof keyword === 'string' && keyword.toLowerCase().includes(query)) return true
    }
    return false
  })
}
