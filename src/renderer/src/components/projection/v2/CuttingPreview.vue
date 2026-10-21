<script setup lang="ts">
import { computed } from 'vue'
import { cutPath, cuttingLabel, type CuttingPlan, type PlacedCut } from '../../../projection/cutting-layout'
import { VIEWPORT_BOUNDS } from '../../../ui/stage-1920'
const props = defineProps<{ plan: CuttingPlan }>()

// The screen shows all making layers on one transparent landscape surface.
// Printed A4 page positions remain exclusively in the supplied immutable plan.
const preview = computed(() => {
  const groups = new Map<string, PlacedCut[]>()
  for (const page of props.plan.pages) for (const piece of page.pieces) {
    const key = cuttingLabel(piece), group = groups.get(key) ?? []
    group.push(piece); groups.set(key, group)
  }
  const layers = [...groups.values()].map(pieces => {
    const left = Math.min(...pieces.map(p => p.x)), top = Math.min(...pieces.map(p => p.y))
    const width = Math.max(...pieces.map(p => p.x + p.width)) - left
    const height = Math.max(...pieces.map(p => p.y + p.height)) - top
    return { element: pieces[0].element, step: pieces[0].step, width: Math.max(width, 12), height,
      pieces: pieces.map(p => ({ ...p, x: p.x - left, y: p.y - top })) }
  }).sort((a, b) => a.element - b.element || a.step - b.step)
  // Keep the surrounding flower/rock artwork and bottom controls clear.
  const inset = { x: 100, top: 40, bottom: 110 }
  const availableWidth = VIEWPORT_BOUNDS.width - inset.x * 2
  const availableHeight = VIEWPORT_BOUNDS.height - inset.top - inset.bottom
  const widest = Math.max(1, ...layers.map(layer => layer.width))
  const totalWidth = layers.reduce((sum, layer) => sum + layer.width + 8, 0)
  const arrange = (wrapWidth: number) => {
    let x = 0, y = 0, rowHeight = 0, width = 0
    const placed = layers.map(layer => {
      if (x > 0 && x + layer.width > wrapWidth) { x = 0; y += rowHeight + 8; rowHeight = 0 }
      const result = { ...layer, x, y }
      width = Math.max(width, x + layer.width)
      x += layer.width + 8; rowHeight = Math.max(rowHeight, layer.height + 8)
      return result
    })
    const height = y + rowHeight
    return { layers: placed, width, height, scale: Math.min(availableWidth / Math.max(width, 1), availableHeight / Math.max(height, 1)) }
  }
  let best = arrange(widest)
  // Choose a readable common scale while preserving left-to-right making order.
  for (let i = 1; i <= 40; i++) {
    const candidate = arrange(widest + (totalWidth - widest) * i / 40)
    if (candidate.scale > best.scale) best = candidate
  }
  const x = inset.x + (availableWidth - best.width * best.scale) / 2
  const y = inset.top + (availableHeight - best.height * best.scale) / 2
  return { ...best, transform: `translate(${x} ${y}) scale(${best.scale})` }
})
</script>
<template>
  <div class="cutting-preview" aria-label="横屏彩色图层预览" tabindex="0">
    <svg :viewBox="`0 0 ${VIEWPORT_BOUNDS.width} ${VIEWPORT_BOUNDS.height}`" role="img" :aria-label="`${preview.layers.length} 个制作图层，按元素和制作层序排列`">
      <g :transform="preview.transform">
        <g v-for="layer in preview.layers" :key="cuttingLabel(layer)" class="cutting-preview__layer" :transform="`translate(${layer.x} ${layer.y})`">
          <template v-for="piece in layer.pieces" :key="piece.id">
            <image v-if="piece.imageUrl" :href="piece.imageUrl" :x="piece.x" :y="piece.y" :width="piece.width" :height="piece.height" />
            <path v-else :d="cutPath(piece)" :fill="piece.color" fill-rule="evenodd" stroke="#111" stroke-width="0.2" />
          </template>
          <text x="0" :y="layer.height + 5" font-size="4.2" fill="currentColor">{{ cuttingLabel(layer) }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>
<style scoped>
.cutting-preview { width: 100%; height: 100%; pointer-events: auto; background: transparent; color: #594738; }
svg { display: block; width: 100%; height: 100%; background: transparent; }
.cutting-preview:focus-visible { outline: 3px solid #7d261a; outline-offset: -3px; }
</style>
