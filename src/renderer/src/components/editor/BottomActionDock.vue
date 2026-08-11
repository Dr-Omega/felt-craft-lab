<script setup lang="ts">
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
      class="dock-tool"
      type="button"
      aria-label="撤销"
      title="撤销"
      :disabled="busy || canEdit === false || canUndo === false"
      @click="emit('undo')"
    >
      <span aria-hidden="true">↶</span>
    </button>
    <button
      class="dock-material"
      type="button"
      aria-label="打开素材盒"
      title="素材盒"
      :class="{ 'is-open': sheetOpen }"
      :disabled="busy || canEdit === false"
      @click="emit('toggleSheet')"
    >
      <span class="material-box-icon" aria-hidden="true">✿</span>
    </button>
    <button
      class="dock-tool"
      type="button"
      aria-label="重做"
      title="重做"
      :disabled="busy || canEdit === false || canRedo === false"
      @click="emit('redo')"
    >
      <span aria-hidden="true">↷</span>
    </button>
  </nav>
</template>
