<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import { isAssetUnlocked } from '../../catalog/ywn-catalog'
import {
  deriveCategoriesFromAssets,
  filterAssetsByCategoryAndQuery
} from '../../catalog/category-display'
import AssetAudioControls from './AssetAudioControls.vue'

const props = defineProps<{
  assets: readonly AssetRecord[]
  accessByAssetId: Record<string, AssetAccessState | undefined>
  selectedAssetId: string
  open: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  select: [assetId: string]
  add: [asset: AssetRecord]
  ask: [asset: AssetRecord]
  close: []
}>()

const ALL_CATEGORY_ID = 'all'
const searchQuery = ref('')
const activeCategoryId = ref(ALL_CATEGORY_ID)

const categories = computed(() => deriveCategoriesFromAssets(props.assets))

const visibleAssets = computed(() => filterAssetsByCategoryAndQuery(props.assets, {
  activeCategoryId: activeCategoryId.value,
  searchQuery: searchQuery.value
}))

function selectedAsset(): AssetRecord | null {
  if (!props.selectedAssetId) return null
  return props.assets.find((asset) => asset.assetId === props.selectedAssetId) ?? null
}

// Selection safety: if the current selection is filtered out by the active
// category or search query, surface a normalized empty selection so callers
// can decide whether to keep, swap, or clear. The sheet never auto-reselects
// a different asset; it only signals the drop.
const selectedStillVisible = computed(() => {
  const current = selectedAsset()
  if (!current) return true
  return visibleAssets.value.some((asset) => asset.assetId === current.assetId)
})

watch(selectedStillVisible, (stillVisible) => {
  if (!stillVisible && props.selectedAssetId) {
    emit('select', '')
  }
})

// Reset filter inputs when the sheet is reopened so a previous filter does
// not silently hide every asset for the next session.
watch(() => props.open, (open) => {
  if (open) {
    searchQuery.value = ''
    activeCategoryId.value = ALL_CATEGORY_ID
  }
})

function unlocked(asset: AssetRecord): boolean {
  return isAssetUnlocked(props.accessByAssetId[asset.assetId])
}

function clearSearch(): void {
  searchQuery.value = ''
}

function selectAllCategory(): void {
  activeCategoryId.value = ALL_CATEGORY_ID
}

function selectCategory(id: string): void {
  activeCategoryId.value = id
}

function addSelection(): void {
  const asset = selectedAsset()
  if (!asset) return
  emit('add', asset)
}

function askSelection(): void {
  const asset = selectedAsset()
  if (!asset) return
  if (!unlocked(asset)) return
  emit('ask', asset)
}
</script>

<template>
    <button
      class="sheet-backdrop"
      type="button"
      aria-label="关闭素材盒"
      :class="{ 'is-open': open }"
      @click="emit('close')"
    ></button>
    <aside class="material-sheet" :class="{ 'is-open': open }" aria-label="素材盒">
      <button class="sheet-handle" type="button" aria-label="关闭素材盒" @click="emit('close')"></button>
      <header class="sheet-header">
        <h2>素材盒</h2>
        <button class="sheet-close" type="button" aria-label="关闭素材盒" @click="emit('close')">×</button>
      </header>
      <div class="sheet-toolbar">
        <label class="sheet-search">
          <span class="sheet-search-label">搜索素材</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索素材……"
            aria-label="搜索素材"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="sheet-search-clear"
            aria-label="清空搜索"
            @click="clearSearch"
          >×</button>
        </label>
        <div class="sheet-category" role="tablist" aria-label="素材分类">
          <button
            type="button"
            role="tab"
            class="category-chip"
            :class="{ 'is-selected': activeCategoryId === ALL_CATEGORY_ID }"
            :aria-selected="activeCategoryId === ALL_CATEGORY_ID"
            @click="selectAllCategory"
          >全部</button>
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            role="tab"
            class="category-chip"
            :class="{ 'is-selected': activeCategoryId === category.id }"
            :aria-selected="activeCategoryId === category.id"
            @click="selectCategory(category.id)"
          >
            {{ category.displayName }}
            <span class="category-chip-count" aria-hidden="true">{{ category.count }}</span>
          </button>
        </div>
      </div>
      <div class="material-grid">
        <button
          v-for="asset in visibleAssets"
          :key="asset.assetId"
          class="material-card"
          type="button"
          :class="{ 'is-selected': selectedAssetId === asset.assetId, 'is-locked': !unlocked(asset) }"
          :aria-label="`${asset.nameZh}${unlocked(asset) ? '' : '，锁定'}`"
          @click="emit('select', asset.assetId)"
        >
          <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.nameZh" />
          <span v-if="!unlocked(asset)" class="card-lock" aria-hidden="true">🔒</span>
          <span class="material-card-name">{{ asset.nameZh }}</span>
        </button>
        <p v-if="visibleAssets.length === 0" class="material-empty">这里还没有符合的素材，换个词或换个分类试试。</p>
      </div>
      <div v-if="selectedAsset()" class="sheet-footer">
        <div class="sheet-footer-name">
          <p class="sheet-footer-name-zh">{{ selectedAsset()?.nameZh }}</p>
          <p v-if="selectedAsset()?.nameEn" class="sheet-footer-name-en">{{ selectedAsset()?.nameEn }}</p>
        </div>
        <div class="sheet-footer-secondary">
          <AssetAudioControls :asset="selectedAsset()" :active="open" />
        </div>
        <div class="sheet-footer-primary">
          <button
            class="sheet-ask"
            type="button"
            :disabled="busy || !unlocked(selectedAsset()!)"
            title="问问它"
            aria-label="问问它"
            @click="askSelection"
          >
            问问它
          </button>
          <button
            class="sheet-add"
            type="button"
            :disabled="busy || !unlocked(selectedAsset()!)"
            @click="addSelection"
          >
            放进作品
          </button>
        </div>
      </div>
    </aside>
</template>

<style scoped>
/* MaterialSheet — visuals aligned with EditorPage wood/apricot tokens. The
   parent sheet layout (max-height, flex/grid shell, footer position) lives
   in EditorPage.vue so the bottom action bar can be the only fixed-height
   zone while the asset list is the only scrollable zone. */
.sheet-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 24px 4px;
  border-bottom: 1px solid rgba(89, 71, 56, 0.08);
}

.sheet-search {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--wood-surface, #efe2c9);
  border: 1px solid var(--wood-mid, #d9b98a);
  border-radius: var(--radius-pill, 999px);
  color: var(--color-text, #594738);
}

.sheet-search-label {
  color: var(--color-text-soft, #8b7355);
  font-size: 0.85rem;
  white-space: nowrap;
}

.sheet-search input {
  border: 0;
  background: transparent;
  outline: none;
  font: inherit;
  color: inherit;
  min-width: 0;
  padding: 0;
}

.sheet-search input::placeholder {
  color: var(--color-text-faint, #b8a48a);
}

.sheet-search-clear {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-text-soft, #8b7355);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 4px;
}

.sheet-category {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 8px;
  border: 0;
}

.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-pill, 999px);
  background: #fffef8;
  border: 1px solid var(--wood-mid, #d9b98a);
  color: var(--color-text, #594738);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}

.category-chip-count {
  display: inline-block;
  min-width: 1.5em;
  text-align: center;
  font-size: 0.75rem;
  color: var(--color-text-soft, #8b7355);
  background: var(--wood-surface, #efe2c9);
  border-radius: var(--radius-pill, 999px);
  padding: 0 6px;
}

.category-chip.is-selected {
  background: var(--color-primary, #e8a572);
  border-color: var(--color-primary, #e8a572);
  color: var(--color-on-primary, #fff);
  font-weight: 600;
}

.category-chip.is-selected .category-chip-count {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.material-empty {
  margin: auto;
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-soft, #8b7355);
  font-size: 0.95rem;
  grid-column: 1 / -1;
}

/* Footer three-layer layout: name (info) / secondary (audio) / primary
   (ask + add). The primary row carries the visual weight; the others
   are intentionally low-emphasis to keep the action hierarchy obvious. */
.sheet-footer {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  padding: 10px 24px 14px;
  border-top: 1px solid rgba(89, 71, 56, 0.08);
  background: var(--wood-light, #f0e2c5);
  text-align: center;
}

.sheet-footer-name {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1.2;
}

.sheet-footer-name-zh {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text, #594738);
}

.sheet-footer-name-en {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-soft, #8b7355);
  letter-spacing: 0.04em;
}

.sheet-footer-secondary {
  display: flex;
  justify-content: center;
}

.sheet-footer-primary {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 2px;
}

.sheet-ask,
.sheet-add {
  min-height: 40px;
  padding: 0 22px;
  border-radius: var(--radius-pill, 999px);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.sheet-ask {
  border: 1px solid var(--color-primary, #e8a572);
  background: #fffef8;
  color: var(--color-primary, #e8a572);
}

.sheet-ask:hover:not(:disabled) {
  background: var(--color-primary-soft, #f4c9a4);
}

.sheet-add {
  border: 0;
  background: var(--color-primary, #e8a572);
  color: var(--color-on-primary, #fff);
  box-shadow: 0 4px 12px rgba(232, 165, 114, 0.32);
}

.sheet-add:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(232, 165, 114, 0.42);
}

.sheet-ask:disabled,
.sheet-add:disabled {
  cursor: not-allowed;
  opacity: 0.46;
  box-shadow: none;
  transform: none;
}
</style>
