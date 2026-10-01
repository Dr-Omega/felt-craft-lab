<script setup lang="ts">
import { ref } from 'vue'
import LayoutPreviewCanvas from './LayoutPreviewCanvas.vue'
import { exportV2Assets, exportV2HitAreas } from '../../../ui/export-v2-assets'
import { boxStyle, VIEWPORT_BOUNDS } from '../../../ui/stage-1920'
import {
  SIZE_METAPHOR_OPTIONS,
  choiceFromMetaphor,
  choiceFromSpecificCm,
  type SubjectSizeChoice,
  type SubjectSizeMode
} from '../../../projection/subject-size'
import type { LayoutLayerInput } from '../../../projection/pdf-layout'

defineProps<{
  layers: LayoutLayerInput[]
  subjectSize: SubjectSizeChoice
  workName: string
}>()

const emit = defineEmits<{
  back: []
  finish: []
  confirmExport: [choice: SubjectSizeChoice]
}>()

const modalOpen = ref(false)
const mode = ref<SubjectSizeMode>('metaphor')
const widthCm = ref('')
const heightCm = ref('')
const metaphorId = ref('apple')

function toggleModal(): void {
  modalOpen.value = !modalOpen.value
}

function selectMode(next: SubjectSizeMode): void {
  mode.value = next
}

function onConfirm(): void {
  if (mode.value === 'specific') {
    const choice = choiceFromSpecificCm(Number(widthCm.value), Number(heightCm.value))
    if (!choice) {
      window.alert('请填写具体尺寸，例如 12 cm × 15 cm')
      return
    }
    emit('confirmExport', choice)
    modalOpen.value = false
    return
  }
  const choice = choiceFromMetaphor(metaphorId.value)
  if (!choice) return
  emit('confirmExport', choice)
  modalOpen.value = false
}
</script>

<template>
  <div class="export-v2-screen" aria-label="导出页">
    <img class="layer z-1" :src="exportV2Assets.bigBackground" alt="" />
    <img class="layer z-2" :src="exportV2Assets.projectionFrame" alt="" />

    <div class="layer layer--preview z-3" :style="boxStyle(VIEWPORT_BOUNDS)">
      <LayoutPreviewCanvas :layers="layers" :subject-size="subjectSize" />
    </div>

    <img class="layer z-4" :src="exportV2Assets.btnExport" alt="" />
    <img class="layer z-5" :src="exportV2Assets.btnFinish" alt="" />

    <template v-if="modalOpen">
      <img class="layer z-30" :src="exportV2Assets.exportModal" alt="" />
      <img
        class="layer z-31 mode-layer"
        :class="{ 'mode-layer--active': mode === 'specific', 'mode-layer--inactive': mode !== 'specific' }"
        :src="exportV2Assets.btnSpecific"
        alt=""
      />
      <img
        class="layer z-32 mode-layer"
        :class="{ 'mode-layer--active': mode === 'metaphor', 'mode-layer--inactive': mode !== 'metaphor' }"
        :src="exportV2Assets.btnOptional"
        alt=""
      />
      <img class="layer z-33" :src="exportV2Assets.textField" alt="" />

      <div v-if="mode === 'specific'" class="specific-field z-34" :style="boxStyle(exportV2HitAreas.modalField)">
        <input v-model="widthCm" class="specific-field__num" type="number" min="1" step="0.1" aria-label="宽度厘米" />
        <span class="specific-field__unit">cm</span>
        <span class="specific-field__times">×</span>
        <input v-model="heightCm" class="specific-field__num" type="number" min="1" step="0.1" aria-label="高度厘米" />
        <span class="specific-field__unit">cm</span>
      </div>
      <select
        v-else
        v-model="metaphorId"
        class="field-select z-34"
        :style="boxStyle(exportV2HitAreas.modalField)"
        aria-label="大小比喻"
      >
        <option v-for="option in SIZE_METAPHOR_OPTIONS" :key="option.id" :value="option.id">
          {{ option.label }}
        </option>
      </select>

      <button
        type="button"
        class="hit z-40"
        :style="boxStyle(exportV2HitAreas.modalSpecific)"
        aria-label="具体尺寸"
        @click="selectMode('specific')"
      />
      <button
        type="button"
        class="hit z-40"
        :style="boxStyle(exportV2HitAreas.modalOptional)"
        aria-label="可选比喻"
        @click="selectMode('metaphor')"
      />
      <button
        type="button"
        class="modal-confirm z-41"
        :style="boxStyle(exportV2HitAreas.modalConfirm)"
        aria-label="确认导出"
        @click="onConfirm"
      >
        确认
      </button>
    </template>

    <img class="layer z-16" :src="exportV2Assets.frameBorder" alt="" />
    <img class="layer z-17" :src="exportV2Assets.btnBack" alt="" />

    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(exportV2HitAreas.exportToggle)"
      aria-label="导出"
      @click="toggleModal"
    />
    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(exportV2HitAreas.finish)"
      aria-label="完成作品"
      @click="emit('finish')"
    />
    <button
      type="button"
      class="hit z-40"
      :style="boxStyle(exportV2HitAreas.back)"
      aria-label="返回展开页"
      @click="emit('back')"
    />
  </div>
</template>

<style scoped>
.export-v2-screen {
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

.layer--preview {
  overflow: hidden;
}

.mode-layer--inactive {
  opacity: 0.52;
  mix-blend-mode: multiply;
}

.mode-layer--active {
  opacity: 1;
  mix-blend-mode: normal;
}

.hit {
  position: absolute;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.modal-confirm {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 4px solid #7d261a;
  border-radius: 999px;
  background: #f5e5a4;
  color: #7d261a;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.specific-field {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-sizing: border-box;
  padding: 0 20px;
  color: #594738;
  font-size: 34px;
  font-weight: 700;
}

.specific-field__num {
  width: 108px;
  border: 0;
  border-bottom: 2px solid #7d261a;
  background: transparent;
  color: #594738;
  font: inherit;
  text-align: center;
  outline: none;
}

.specific-field__num::-webkit-outer-spin-button,
.specific-field__num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.field-select {
  position: absolute;
  margin: 0;
  padding: 0 20px;
  border: 0;
  background: transparent;
  color: #594738;
  font-size: 34px;
  font-weight: 700;
  outline: none;
  box-sizing: border-box;
  accent-color: #f5e5a4;
}

.field-select option {
  background: #fff8dc;
  color: #594738;
}

.field-select option:checked,
.field-select option:hover {
  background: #f5e5a4;
  color: #7d261a;
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
.z-16 {
  z-index: 16;
}
.z-17 {
  z-index: 17;
}
.z-30 {
  z-index: 30;
}
.z-31 {
  z-index: 31;
}
.z-32 {
  z-index: 32;
}
.z-33 {
  z-index: 33;
}
.z-34 {
  z-index: 34;
}
.z-40 {
  z-index: 40;
}
.z-41 {
  z-index: 41;
}
</style>
