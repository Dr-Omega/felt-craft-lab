<script setup lang="ts">
import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import { isAssetUnlocked } from '../../catalog/ywn-catalog'
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
  apply: [asset: AssetRecord | null]
  close: []
}>()

function selectedAsset(): AssetRecord | null {
  return props.assets.find((asset) => asset.assetId === props.selectedAssetId) ?? null
}

function unlocked(asset: AssetRecord): boolean {
  return isAssetUnlocked(props.accessByAssetId[asset.assetId])
}
</script>

<template>
  <aside class="background-drawer" :class="{ 'is-open': open }" aria-label="背景选择">
    <div class="drawer-title">选个背景</div>
    <div class="background-list">
      <button
        class="background-card blank-card"
        type="button"
        :class="{ 'is-selected': selectedAssetId === '' }"
        @click="emit('select', '')"
      >
        <span class="blank-card-mark" aria-hidden="true">○</span>
        <span>空白纸</span>
      </button>
      <button
        v-for="asset in assets"
        :key="asset.assetId"
        class="background-card"
        type="button"
        :class="{ 'is-selected': selectedAssetId === asset.assetId, 'is-locked': !unlocked(asset) }"
        :aria-label="`${asset.nameZh}${unlocked(asset) ? '' : '，锁定'}`"
        @click="emit('select', asset.assetId)"
      >
        <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.nameZh" />
        <span v-if="!unlocked(asset)" class="card-lock" aria-hidden="true">🔒</span>
        <span class="card-name">{{ asset.nameZh }}</span>
      </button>
      <p v-if="assets.length === 0" class="background-empty">暂时没有可选背景</p>
    </div>
    <AssetAudioControls
      v-if="selectedAsset()"
      :asset="selectedAsset()"
      :active="open"
    />
    <button
      class="drawer-apply"
      type="button"
      :disabled="busy || (selectedAssetId !== '' && !unlocked(selectedAsset()!))"
      @click="emit('apply', selectedAsset())"
    >
      换成这个背景
    </button>
  </aside>
</template>

<style scoped>
.background-drawer {
  position: absolute;
  left: 100%;
  top: 50%;
  z-index: 29;
  margin-left: 6px;
  display: flex;
  flex-direction: column;
  width: 168px;
  height: min(320px, 70vh);
  max-height: 320px;
  gap: 8px;
  padding: 12px 10px 10px;
  border-radius: var(--text-box-radius, 18px);
  border: 3px solid var(--text-box-border, #d4a843);
  background: var(--text-box-fill, #f5ecd8);
  box-shadow: var(--text-box-shadow);
  opacity: 0;
  pointer-events: none;
  transform: translate(-8px, -50%) scale(0.96);
  transform-origin: left center;
  transition: opacity 220ms ease, transform 220ms ease;
  box-sizing: border-box;
}

.background-drawer.is-open {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, -50%) scale(1);
}

.drawer-title {
  flex-shrink: 0;
  color: var(--color-text-soft, #8b7355);
  font-size: 13px;
  letter-spacing: 1px;
  text-align: center;
}

.background-list {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: min-content;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
}

.background-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 8px 4px;
  color: var(--color-text-soft, #8b7355);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
}

.background-card {
  position: relative;
  aspect-ratio: 1;
  min-width: 0;
  min-height: 56px;
  overflow: hidden;
  padding: 0;
  border: 3px solid var(--text-box-border, #d4a843);
  border-radius: var(--text-box-radius, 18px);
  background: var(--text-box-fill, #f5ecd8);
  cursor: pointer;
}

.background-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.background-card.is-selected {
  border-color: var(--color-primary, #e8a572);
  box-shadow: 0 4px 14px rgba(232, 165, 114, 0.3);
}

.background-card.is-locked {
  opacity: 0.55;
}

.background-card .card-name {
  position: absolute;
  inset: auto 4px 4px;
  overflow: hidden;
  color: var(--color-text, #594738);
  font-size: 10px;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blank-card {
  display: grid;
  place-items: center;
  gap: 2px;
  color: var(--color-text-soft, #8b7355);
  font-size: 11px;
}

.blank-card-mark {
  font-size: 24px;
}

.card-lock {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  font-size: 12px;
}

.drawer-apply {
  flex-shrink: 0;
  min-height: 42px;
  border: 0;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-primary, #e8a572);
  color: var(--color-on-primary, #fff);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.drawer-apply:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
