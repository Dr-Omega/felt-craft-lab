<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { STAGE_H, STAGE_W } from '../../../ui/stage-1920'

const hostEl = ref<HTMLDivElement | null>(null)
const scale = ref(1)

function updateScale(): void {
  if (!hostEl.value) return
  const rect = hostEl.value.getBoundingClientRect()
  scale.value = Math.min(rect.width / STAGE_W, rect.height / STAGE_H)
}

let observer: ResizeObserver | undefined

onMounted(() => {
  updateScale()
  window.addEventListener('resize', updateScale)
  if (hostEl.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => updateScale())
    observer.observe(hostEl.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', updateScale)
  observer?.disconnect()
})
</script>

<template>
  <div ref="hostEl" class="stage1920-host">
    <div
      class="stage1920-inner"
      :style="{ width: `${STAGE_W}px`, height: `${STAGE_H}px`, transform: `scale(${scale})` }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stage1920-host {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #f6edd3;
}

.stage1920-inner {
  position: relative;
  transform-origin: center center;
}
</style>
