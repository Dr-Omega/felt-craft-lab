<script setup lang="ts">
import { AUTH_DESIGN_HEIGHT, AUTH_DESIGN_WIDTH } from '../../ui/auth-assets'
import { onMounted, onUnmounted, ref } from 'vue'

const scale = ref(1)

function updateScale(): void {
  scale.value = Math.min(
    window.innerWidth / AUTH_DESIGN_WIDTH,
    window.innerHeight / AUTH_DESIGN_HEIGHT
  )
}

onMounted(() => {
  updateScale()
  window.addEventListener('resize', updateScale)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateScale)
})
</script>

<template>
  <div class="auth-viewport">
    <div
      class="auth-artboard"
      :style="{ transform: `scale(${scale})` }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.auth-viewport {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8e8a8;
  overflow: hidden;
}

.auth-artboard {
  position: relative;
  width: 1920px;
  height: 1080px;
  flex-shrink: 0;
  transform-origin: center center;
}
</style>
