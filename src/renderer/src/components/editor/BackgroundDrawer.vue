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
    </div>
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
