<script setup lang="ts">
defineProps<{ image: string; bounds: string; label: string; disabled?: boolean }>()
defineEmits<{ click: [] }>()
</script>
<template>
  <button class="artwork-button" :aria-label="label" :disabled="disabled" @click="$emit('click')">
    <svg :viewBox="bounds" aria-hidden="true"><image :href="image" width="1920" height="1080" /></svg>
  </button>
</template>
<style scoped>
.artwork-button { padding: 0; border: 0; background: transparent; }
svg { display: block; width: 100%; height: 100%; }
</style>
