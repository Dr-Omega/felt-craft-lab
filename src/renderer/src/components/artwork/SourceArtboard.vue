<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
// One transform for the entire supplied 1920×1080 PSD export, never per layer.
const scale = ref(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
const resize = () => { scale.value = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) }
onMounted(() => window.addEventListener('resize', resize))
onUnmounted(() => window.removeEventListener('resize', resize))
</script>
<template>
  <div class="source-art-viewport"><div class="source-artboard" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }"><slot /></div></div>
</template>
<style scoped>
.source-art-viewport { position: fixed; inset: 0; pointer-events: none; }
.source-artboard { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px; transform-origin: center; pointer-events: none; }
</style>
