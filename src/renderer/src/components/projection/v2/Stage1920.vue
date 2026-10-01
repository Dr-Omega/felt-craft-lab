<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { STAGE_H, STAGE_W } from '../../../ui/stage-1920'

const hostEl = ref<HTMLDivElement | null>(null)
const scale = ref(1)

const scaledWidth = computed(() => STAGE_W * scale.value)
const scaledHeight = computed(() => STAGE_H * scale.value)

function updateScale(): void {
  const width = hostEl.value?.clientWidth ?? window.innerWidth
  const height = hostEl.value?.clientHeight ?? window.innerHeight
  if (width <= 0 || height <= 0) return
  scale.value = Math.min(width / STAGE_W, height / STAGE_H)
}

let observer: ResizeObserver | undefined

onMounted(() => {
  updateScale()
  requestAnimationFrame(updateScale)
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
      class="stage1920-scaler"
      :style="{ width: `${scaledWidth}px`, height: `${scaledHeight}px` }"
    >
      <div class="stage1920-inner" :style="{ transform: `scale(${scale})` }">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage1920-host {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #f6edd3;
}

.stage1920-scaler {
  position: relative;
  flex-shrink: 0;
}

.stage1920-inner {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  transform-origin: 0 0;
}
</style>
