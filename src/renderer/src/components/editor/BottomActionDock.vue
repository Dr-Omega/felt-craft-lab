<script setup lang="ts">
import { handDrawnAssets } from '../../ui/hand-drawn-assets'

defineProps<{
  busy?: boolean
  sheetOpen?: boolean
  canEdit?: boolean
  canUndo?: boolean
  canRedo?: boolean
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  toggleSheet: []
}>()
</script>

<template>
  <nav class="bottom-action-dock" aria-label="画布工具">
    <button
      class="hand-icon-btn hand-icon-btn--undo"
      type="button"
      aria-label="撤销"
      title="撤销"
      :disabled="busy || canEdit === false || canUndo === false"
      @click="emit('undo')"
    >
      <img :src="handDrawnAssets.btnRoundUndo" alt="" />
    </button>
    <button
      class="hand-icon-btn hand-icon-btn--material"
      type="button"
      aria-label="打开素材盒"
      title="素材盒"
      :class="{ 'is-open': sheetOpen }"
      :disabled="busy || canEdit === false"
      @click="emit('toggleSheet')"
    >
      <img :src="handDrawnAssets.btnRoundMaterial" alt="" />
    </button>
    <button
      class="hand-icon-btn hand-icon-btn--redo"
      type="button"
      aria-label="重做"
      title="重做"
      :disabled="busy || canEdit === false || canRedo === false"
      @click="emit('redo')"
    >
      <img :src="handDrawnAssets.btnRoundRedo" alt="" />
    </button>
  </nav>
</template>

<style scoped>
.bottom-action-dock {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.hand-icon-btn.is-open {
  filter: drop-shadow(0 0 8px rgba(232, 165, 114, 0.55));
}
</style>
