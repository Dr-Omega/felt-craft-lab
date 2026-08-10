<script setup lang="ts">
import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import { isAssetUnlocked } from '../../catalog/ywn-catalog'

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
  close: []
}>()

function unlocked(asset: AssetRecord): boolean {
  return isAssetUnlocked(props.accessByAssetId[asset.assetId])
}

function selectedAsset(): AssetRecord | null {
  return props.assets.find((asset) => asset.assetId === props.selectedAssetId) ?? null
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
      <div class="sheet-category" aria-label="素材分类">
        <button class="category-chip is-selected" type="button">全部</button>
      </div>
      <div class="material-grid">
        <button
          v-for="asset in assets"
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
      </div>
      <div v-if="selectedAsset()" class="sheet-footer">
        <span class="sheet-selection">{{ selectedAsset()?.nameZh }}</span>
        <button
          class="sheet-add"
          type="button"
          :disabled="busy || !unlocked(selectedAsset()!)"
          @click="selectedAsset() && emit('add', selectedAsset()!)"
        >
          放进作品
        </button>
      </div>
    </aside>
</template>
