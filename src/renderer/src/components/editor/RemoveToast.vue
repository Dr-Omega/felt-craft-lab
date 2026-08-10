<script setup lang="ts">
defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  undo: []
}>()
</script>

<template>
  <div v-if="open" class="remove-toast" role="status" aria-live="polite">
    <span>拿掉啦</span>
    <button type="button" aria-label="撤销" @click="emit('undo')">撤销</button>
  </div>
</template>
