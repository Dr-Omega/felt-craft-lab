<script setup lang="ts">
defineProps<{
  left: number
  top: number
  below?: boolean
  canChangeLayer?: boolean
  canRemove?: boolean
  canEditLayers?: boolean
}>()

const emit = defineEmits<{
  forward: []
  backward: []
  bringToFront: []
  sendToBack: []
  remove: []
  edit: []
}>()
</script>

<template>
  <aside
    class="object-quick-tools"
    :class="{ 'is-below': below }"
    :style="{ left: `${left}px`, top: `${top}px` }"
    aria-label="对象快捷工具"
  >
    <div class="oqt-row" role="group" aria-label="图层顺序">
      <button type="button" aria-label="往前" :disabled="canChangeLayer === false" @click="emit('forward')">往前</button>
      <button type="button" aria-label="往后" :disabled="canChangeLayer === false" @click="emit('backward')">往后</button>
    </div>
    <div class="oqt-row" role="group" aria-label="置顶置底">
      <button type="button" aria-label="置顶" :disabled="canChangeLayer === false" @click="emit('bringToFront')">置顶</button>
      <button type="button" aria-label="置底" :disabled="canChangeLayer === false" @click="emit('sendToBack')">置底</button>
    </div>
    <div v-if="canRemove !== false" class="oqt-row oqt-row-remove" role="group" aria-label="拿掉对象">
      <button type="button" class="oqt-remove" aria-label="拿掉" @click="emit('remove')">拿掉</button>
    </div>
    <div class="oqt-row oqt-row-remove"><button type="button" aria-label="编辑元素图层" :disabled="canEditLayers === false" @click="emit('edit')">编辑</button></div>
  </aside>
</template>

<style scoped>
.object-quick-tools {
  position: absolute;
  z-index: 9;
  display: grid;
  gap: 6px;
  padding: 8px;
  background: #fff1b7;
  border: 2px solid #71351c;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(89, 71, 56, 0.18);
  pointer-events: auto;
  min-width: 180px;
}

.oqt-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.oqt-row-remove {
  grid-template-columns: 1fr;
}

.object-quick-tools button {
  appearance: none;
  border: 0;
  background: transparent url('../../../../../assets/ui/hand-drawn/btn-primary.png') center / 100% 100% no-repeat;
  color: #71351c;
  font: inherit;
  padding: 8px 12px;
  min-height: 38px;
  font-weight: 700;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.object-quick-tools button:hover:not(:disabled) {
  filter: brightness(1.06);
}
.object-quick-tools button:focus-visible { outline: 3px solid #71351c; outline-offset: 2px; }

.object-quick-tools button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.object-quick-tools .oqt-remove {
  background-image: url('../../../../../assets/ui/hand-drawn/btn-secondary.png');
  color: #8e2516;
}
</style>
