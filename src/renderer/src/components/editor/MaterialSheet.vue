<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import { isAssetUnlocked } from '../../catalog/ywn-catalog'
import {
  deriveCategoriesFromAssets,
  filterAssetsByCategoryAndQuery
} from '../../catalog/category-display'
import { handDrawnAssets } from '../../ui/hand-drawn-assets'
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
  unlock: [themeId: string]
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


</script>

<template>
  <Teleport to="body">
    <div class="material-sheet-layer" :class="{ 'is-open': open }">
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
        <button class="hand-icon-btn hand-icon-btn--close sheet-close" type="button" aria-label="关闭素材盒" @click="emit('close')">
          <img :src="handDrawnAssets.btnClose" alt="" />
        </button>
      </header>
      <div class="sheet-toolbar">
        <label class="sheet-search">
          <input
            v-model="searchQuery"
            type="search"
            placeholder="找一找素材……"
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
          <span class="material-card-image">
            <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="''" />
            <span v-if="!unlocked(asset)" class="card-lock" aria-hidden="true">🔒</span>
          </span>
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
          <button type="button" @click="emit('ask', selectedAsset()!)">问问它</button>
          <AssetAudioControls :asset="selectedAsset()" :active="open" />
        </div>
        <div class="sheet-footer-primary">
          <p v-if="!unlocked(selectedAsset()!)">该主题尚未解锁，完成主题引导后才能使用。</p>
          <button v-if="!unlocked(selectedAsset()!)" type="button" :disabled="busy" @click="emit('unlock', selectedAsset()!.themeId)">前往解锁本主题</button>
          <button
            class="hand-btn-primary sheet-add"
            type="button"
            :disabled="busy || !unlocked(selectedAsset()!)"
            @click="addSelection"
          >
            放进作品
          </button>
        </div>
      </div>
    </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.material-sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 85;
  pointer-events: none;
}

.material-sheet-layer.is-open {
  pointer-events: auto;
}

.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  border: 0;
  background: rgba(89, 71, 56, 0.28);
  opacity: 0;
  pointer-events: none;
  transition: opacity 220ms ease;
}

.sheet-backdrop.is-open {
  opacity: 1;
  pointer-events: auto;
}

.material-sheet {
  position: fixed;
  left: 50%;
  bottom: 20px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: calc(100% - 80px);
  max-width: 1280px;
  max-height: 70vh;
  min-height: 360px;
  overflow: hidden;
  transform: translate(-50%, calc(100% + 24px));
  transition: transform 280ms cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: auto;
}

.material-sheet.is-open {
  transform: translate(-50%, 0);
}

.sheet-handle {
  width: 48px;
  height: 5px;
  margin: 10px auto 4px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill, 999px);
  background: var(--wood-mid, #d9b98a);
  cursor: pointer;
  opacity: 0.75;
  flex: 0 0 auto;
}

.sheet-close {
  justify-self: end;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px 10px;
  border-bottom: 1px solid rgba(89, 71, 56, 0.08);
  flex: 0 0 auto;
}

.sheet-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.sheet-close {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-soft, #8b7355);
  font-size: 26px;
  cursor: pointer;
}

.material-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-auto-rows: max-content;
  align-items: start;
  gap: 14px;
  max-width: 1210px;
  width: 100%;
  margin: 0 auto;
  padding: 4px 30px 12px;
  flex: 1 1 auto;
  min-height: 180px;
  overflow-y: auto;
  align-content: start;
}

.material-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
}

.material-card-image {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--wood-light, #f0e2c5);
}

.material-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.material-card:hover:not(.is-locked) {
  transform: translateY(-2px);
}

.material-card.is-selected {
  border-color: var(--color-primary, #e8a572);
  box-shadow: 0 4px 14px rgba(232, 165, 114, 0.3);
}

.material-card.is-locked {
  opacity: 0.55;
}

.material-card-name {
  position: static;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  background: var(--text-box-fill, #f5ecd8);
  color: var(--color-text, #594738);
  font-size: 11px;
  line-height: 1.1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  border-top: 2px solid rgba(92, 64, 48, 0.12);
}

.card-lock {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  font-size: 12px;
}

@media (max-width: 1439px) {
  .material-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

@media (min-width: 1920px) {
  .material-grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}

/* MaterialSheet — visuals aligned with EditorPage wood/apricot tokens. */
.sheet-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 24px 4px;
  border-bottom: 1px solid rgba(89, 71, 56, 0.08);
}

.sheet-search {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--text-box-fill, #f5ecd8);
  border: 3px solid var(--text-box-border, #d4a843);
  border-radius: var(--radius-pill, 999px);
  color: var(--color-text, #594738);
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
  background: var(--text-box-fill, #f5ecd8);
  border: 2px solid var(--text-box-border, #d4a843);
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
  gap: 4px;
  padding: 8px 24px 12px;
  border-top: 1px solid rgba(89, 71, 56, 0.08);
  background: var(--wood-light, #f0e2c5);
  text-align: center;
}

.sheet-footer-name {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  line-height: 1.2;
}

.sheet-footer-name-zh {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text, #594738);
}

.sheet-footer-name-en {
  margin: 0;
  font-size: 10px;
  color: var(--color-text-faint, #b8a48a);
  letter-spacing: 0.04em;
  opacity: 0.85;
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
  font: inherit;
  cursor: pointer;
}

.sheet-ask:disabled,
.sheet-add:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}
</style>
