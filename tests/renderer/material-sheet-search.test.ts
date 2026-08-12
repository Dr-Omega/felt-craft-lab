import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sheet = readFileSync(resolve('src/renderer/src/components/editor/MaterialSheet.vue'), 'utf8')
const sheetScript = sheet.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
const sheetTemplate = sheet.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
const editorPage = readFileSync(resolve('src/renderer/src/pages/EditorPage.vue'), 'utf8')
const categoryDisplay = readFileSync(resolve('src/renderer/src/catalog/category-display.ts'), 'utf8')

describe('V4.6 Phase 2 MaterialSheet search and category filters', () => {
  it('renders a search input that filters by nameZh, nameEn, and keywords', () => {
    // The visible UI shows a single child-friendly placeholder; the
    // descriptive label is kept on aria-label only so the toolbar does not
    // repeat the words "搜索素材" twice.
    expect(sheet).toContain('aria-label="搜索素材"')
    expect(sheet).toContain('placeholder="找一找素材……"')
    expect(sheet).toContain('v-model="searchQuery"')
    expect(sheet).not.toContain('class="sheet-search-label"')
    expect(sheet).not.toContain('>搜索素材<')
    expect(categoryDisplay).toContain('filterAssetsByCategoryAndQuery')
    expect(categoryDisplay).toContain('asset.nameZh')
    expect(categoryDisplay).toContain('asset.nameEn')
    expect(categoryDisplay).toContain('asset.keywords')
  })

  it('produces dynamic category chips from the current assets and keeps 全部 pinned first', () => {
    expect(sheetScript).toContain('deriveCategoriesFromAssets')
    expect(sheet).toContain('role="tablist"')
    expect(sheet).toContain('selectAllCategory')
    // "全部" is the first chip before the dynamic list.
    const chipOrder = sheetTemplate.indexOf('全部')
    const dynamicFirst = sheetTemplate.indexOf('v-for="category in categories"')
    expect(chipOrder).toBeGreaterThan(-1)
    expect(dynamicFirst).toBeGreaterThan(-1)
    expect(chipOrder).toBeLessThan(dynamicFirst)
  })

  it('keeps the AssetAudioControls and 放进作品 behavior contract intact', () => {
    expect(sheet).toContain('<AssetAudioControls :asset="selectedAsset()" :active="open" />')
    expect(sheet).toContain(':disabled="busy || !unlocked(selectedAsset()!)"')
    expect(sheet).toContain('放进作品')
    expect(sheet).toContain("'is-locked'")
  })

  it('clears the selected asset when it is filtered out so the add button cannot add a hidden asset', () => {
    expect(sheetScript).toContain('selectedStillVisible')
    expect(sheetScript).toContain("emit('select', '')")
  })

  it('resets the active category and search query when the sheet is reopened', () => {
    expect(sheetScript).toContain('watch(() => props.open')
    expect(sheetScript).toContain('activeCategoryId.value = ALL_CATEGORY_ID')
    expect(sheetScript).toContain('searchQuery.value = \'\'')
  })

  it('keeps acceptance unlock-all and locked-add behavior untouched', () => {
    // The sheet must still let locked assets be browsed and played, but the
    // add button must remain disabled.
    expect(sheet).toContain("'is-locked'")
    expect(sheet).toContain('isAssetUnlocked')
    expect(sheet).toContain('!unlocked(selectedAsset()!)')
    expect(editorPage).toContain('seedAcceptanceUnlockedAccess')
    expect(editorPage).toContain('VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS')
  })

  it('does not pull more assets or cross snapshot boundaries to satisfy the search', () => {
    // No new fetch / resolver imports in the sheet.
    expect(sheetScript).not.toContain('loadFormalCatalog')
    expect(sheetScript).not.toContain('resolveEditorCatalogForSnapshot')
    expect(sheetScript).not.toContain('AssetAccessStore')
    expect(sheetScript).not.toContain('assetsForEditor')
  })

  it('falls back to a child-friendly generic label for unknown categories so no material is hidden', () => {
    expect(categoryDisplay).toContain('categoryDisplayName')
    // The fallback path returns the generic "其他" label when a category is
    // not in the known map. The internal id is still preserved on the
    // DerivedCategory so filtering and chip selection continue to work.
    const displayBody = categoryDisplay.match(/function categoryDisplayName[\s\S]*?\n}/)?.[0] ?? ''
    expect(displayBody).toContain('categoryId')
    expect(displayBody).toContain('未分类')
    expect(categoryDisplay).toContain('UNKNOWN_CATEGORY_DISPLAY')
    expect(categoryDisplay).toContain("'其他'")
    // Unknown categories go into the second group (known first, unknown last).
    const deriveBody = categoryDisplay.match(/function deriveCategoriesFromAssets[\s\S]*?\n}/)?.[0] ?? ''
    expect(deriveBody).toContain('unknown.push(entry)')
  })
})
