<script setup lang="ts">
import ProjectionExplodeCanvas from '../ProjectionExplodeCanvas.vue'
import { explodeV2Assets, explodeV2HitAreas } from '../../../ui/explode-v2-assets'
import { boxStyle, VIEWPORT_BOUNDS } from '../../../ui/stage-1920'
import type { ExplodeLayerInput } from '../ProjectionExplodeCanvas.vue'

defineProps<{
  layers: ExplodeLayerInput[]
  explode: number
  explodePercent: number
  includeBackground: boolean
  backgroundLabel?: string
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
    <img class="layer z-1" :src="explodeV2Assets.bigBackground" alt="" />
    <img class="layer z-2" :src="explodeV2Assets.frameBackground" alt="" />

    <div class="layer layer--viewport z-3" :style="boxStyle(VIEWPORT_BOUNDS)">
      <ProjectionExplodeCanvas v-if="layers.length > 0" :layers="layers" :explode="explode" />
    </div>

    <img class="layer z-4" :src="explodeV2Assets.btnCheck" alt="" />
    <img class="layer z-5" :src="explodeV2Assets.btnCross" alt="" />
    <img class="layer z-6" :src="explodeV2Assets.btnNext" alt="" />

    <div class="explode-slider z-15">
      <label for="fabrication-explode" class="explode-slider__label">展开程度 {{ explodePercent }}%</label>
      <input
        id="fabrication-explode"
        :value="explodePercent"
        type="range"
        min="0"
        max="100"
        step="1"
        @input="emit('update:explodePercent', Number(($event.target as HTMLInputElement).value))"
      />
    </div>

    <img class="layer z-16" :src="explodeV2Assets.frameBorder" alt="" />
    <img class="layer z-17" :src="explodeV2Assets.btnBack" alt="" />

    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(explodeV2HitAreas.check)"
      :aria-label="`显示${backgroundLabel || '背景'}`"
      @click="emit('enableBackground')"
    />
    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(explodeV2HitAreas.cross)"
      :aria-label="`隐藏${backgroundLabel || '背景'}`"
      @click="emit('disableBackground')"
    />
    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(explodeV2HitAreas.next)"
      aria-label="下一步"
      @click="emit('next')"
    />
    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(explodeV2HitAreas.back)"
      aria-label="返回"
      @click="emit('back')"
    />
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
  left: 0;
  top: 0;
  width: 1920px;
  height: 1080px;
  pointer-events: none;
  user-select: none;
}

.layer--viewport {
  overflow: hidden;
  pointer-events: auto;
}

.hit {
  position: absolute;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.explode-slider {
  position: absolute;
  left: 50%;
  bottom: 132px;
  transform: translateX(-50%);
  width: 920px;
  padding: 16px 28px;
  border: 4px solid #7d261a;
  border-radius: 999px;
  background: rgba(245, 229, 164, 0.94);
  display: grid;
  gap: 10px;
  box-sizing: border-box;
}

.explode-slider__label {
  text-align: center;
  color: #7d261a;
  font-weight: 700;
  font-size: 32px;
  line-height: 1.2;
}

.explode-slider input[type='range'] {
  width: 100%;
  height: 28px;
  accent-color: #7d261a;
}

.z-1 {
  z-index: 1;
}
.z-2 {
  z-index: 2;
}
.z-3 {
  z-index: 3;
}
.z-4 {
  z-index: 4;
}
.z-5 {
  z-index: 5;
}
.z-6 {
  z-index: 6;
}
.z-15 {
  z-index: 15;
}
.z-16 {
  z-index: 16;
}
.z-17 {
  z-index: 17;
}
.z-40 {
  z-index: 40;
}
</style>
