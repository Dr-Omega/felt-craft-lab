<script setup lang="ts">
defineProps<{
  left: number
  top: number
  below?: boolean
}>()

const emit = defineEmits<{
  forward: []
  backward: []
  bringToFront: []
  sendToBack: []
  remove: []
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
      <button type="button" aria-label="往前" @click="emit('forward')">往前</button>
      <button type="button" aria-label="往后" @click="emit('backward')">往后</button>
    </div>
    <div class="oqt-row" role="group" aria-label="置顶置底">
      <button type="button" aria-label="置顶" @click="emit('bringToFront')">置顶</button>
      <button type="button" aria-label="置底" @click="emit('sendToBack')">置底</button>
    </div>
    <div class="oqt-row oqt-row-remove" role="group" aria-label="拿掉对象">
      <button type="button" class="oqt-remove" aria-label="拿掉" @click="emit('remove')">拿掉</button>
    </div>
  </aside>
</template>

<style scoped>
.object-quick-tools {
  position: absolute;
  z-index: 9;
  display: grid;
  gap: 6px;
  padding: 8px;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #c5d5d0);
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
  border: 1px solid var(--line, #c5d5d0);
  background: #fff;
  color: var(--ink, #16302b);
  font: inherit;
  padding: 6px 12px;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.object-quick-tools button:hover {
  background: var(--paper, #eef4f2);
}

.object-quick-tools .oqt-remove {
  background: var(--danger, #9b2c2c);
  border-color: var(--danger, #9b2c2c);
  color: #fff;
}

.object-quick-tools .oqt-remove:hover {
  background: #7f2222;
  border-color: #7f2222;
}
</style>
