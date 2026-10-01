<script setup lang="ts">
import ProjectionExplodeCanvas from '../ProjectionExplodeCanvas.vue'
import { explodeV2Assets, explodeV2HitAreas } from '../../../ui/explode-v2-assets'
import { boxStyle, VIEWPORT_BOUNDS } from '../../../ui/stage-1920'
import type { ExplodeLayerInput } from '../ProjectionExplodeCanvas.vue'

const props = defineProps<{
  layers: ExplodeLayerInput[]
  explode: number
  explodePercent: number
  includeBackground: boolean
}>()

const emit = defineEmits<{
  'update:explodePercent': [value: number]
  enableBackground: []
  disableBackground: []
  next: []
  back: []
}>()
</script>

<template>
  <div class="explode-v2-screen" aria-label="3D 展开页">
    <img class="layer layer--big-bg" :src="explodeV2Assets.bigBackground" alt="" />
    <img class="layer layer--frame-bg" :src="explodeV2Assets.frameBackground" alt="" />
    <div class="layer layer--viewport" :style="boxStyle(VIEWPORT_BOUNDS)">
      <ProjectionExplodeCanvas v-if="layers.length > 0" :layers="layers" :explode="explode" />
    </div>

    <button
      type="button"
      class="hit hit--check"
      :class="{ 'is-active': includeBackground }"
      :style="boxStyle(explodeV2HitAreas.check)"
      aria-label="显示背景"
      @click="emit('enableBackground')"
    >
      <img :src="explodeV2Assets.btnCheck" alt="" />
    </button>
    <button
      type="button"
      class="hit hit--cross"
      :class="{ 'is-active': !includeBackground }"
      :style="boxStyle(explodeV2HitAreas.cross)"
      aria-label="隐藏背景"
      @click="emit('disableBackground')"
    >
      <img :src="explodeV2Assets.btnCross" alt="" />
    </button>
    <button
      type="button"
      class="hit hit--next"
      :style="boxStyle(explodeV2HitAreas.next)"
      aria-label="下一步"
      @click="emit('next')"
    >
      <img :src="explodeV2Assets.btnNext" alt="" />
    </button>

    <div class="explode-slider">
      <label class="explode-slider__label">展开程度 {{ explodePercent }}%</label>
      <input
        :value="explodePercent"
        type="range"
        min="0"
        max="100"
        step="1"
        @input="emit('update:explodePercent', Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <img class="layer layer--frame-border" :src="explodeV2Assets.frameBorder" alt="" />
    <button
      type="button"
      class="hit hit--back"
      :style="boxStyle(explodeV2HitAreas.back)"
      aria-label="返回"
      @click="emit('back')"
    >
      <img :src="explodeV2Assets.btnBack" alt="" />
    </button>
  </div>
</template>

<style scoped>
.explode-v2-screen {
  position: relative;
  width: 1920px;
  height: 1080px;
}

.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}

.layer--viewport {
  inset: auto;
  overflow: hidden;
  border-radius: 6px;
}

.hit {
  position: absolute;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.hit img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.hit.is-active {
  filter: drop-shadow(0 0 8px rgba(125, 38, 26, 0.55));
}

.explode-slider {
  position: absolute;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  width: min(520px, 72%);
  padding: 10px 16px;
  border: 3px solid #7d261a;
  border-radius: 999px;
  background: rgba(245, 229, 164, 0.92);
  display: grid;
  gap: 6px;
  z-index: 12;
}

.explode-slider__label {
  text-align: center;
  color: #7d261a;
  font-weight: 700;
  font-size: 18px;
}

.explode-slider input[type='range'] {
  width: 100%;
  accent-color: #7d261a;
}

.layer--frame-border,
.hit--back {
  z-index: 20;
}

.hit--next,
.hit--check,
.hit--cross {
  z-index: 11;
}
</style>
