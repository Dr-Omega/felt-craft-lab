<script setup lang="ts">
defineProps<{
  left: number
  top: number
  below?: boolean
}>()

const emit = defineEmits<{
  forward: []
  backward: []
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
    <button type="button" aria-label="往前" @click="emit('forward')">往前</button>
    <button type="button" aria-label="往后" @click="emit('backward')">往后</button>
    <button type="button" aria-label="拿掉" @click="emit('remove')">拿掉</button>
  </aside>
</template>
