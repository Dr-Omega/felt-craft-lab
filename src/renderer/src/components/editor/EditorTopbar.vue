<script setup lang="ts">
import { handDrawnAssets } from '../../ui/hand-drawn-assets'

defineProps<{
  workName: string
}>()

const emit = defineEmits<{
  back: []
}>()
</script>

<template>
  <header class="editor-topbar">
    <button class="hand-icon-btn hand-icon-btn--back" type="button" aria-label="返回书本" @click="emit('back')">
      <img :src="handDrawnAssets.btnBack" alt="" />
    </button>
    <h1 class="topbar-title">{{ workName }}</h1>
  </header>
</template>

<style scoped>
.editor-topbar {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.topbar-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: #594738;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
