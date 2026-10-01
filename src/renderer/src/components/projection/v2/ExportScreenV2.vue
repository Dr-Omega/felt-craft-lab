<script setup lang="ts">
import { ref } from 'vue'
import LayoutPreviewCanvas from './LayoutPreviewCanvas.vue'
import { exportV2Assets, exportV2HitAreas } from '../../../ui/export-v2-assets'
import { boxStyle, VIEWPORT_BOUNDS } from '../../../ui/stage-1920'
import {
  SIZE_METAPHOR_OPTIONS,
  choiceFromMetaphor,
  choiceFromSpecificInput,
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
const specificText = ref('8×8')
const metaphorId = ref('apple')

function toggleModal(): void {
  modalOpen.value = !modalOpen.value
}

function selectMode(next: SubjectSizeMode): void {
  mode.value = next
}

function onConfirm(): void {
  if (mode.value === 'specific') {
    const choice = choiceFromSpecificInput(specificText.value)
    if (!choice) {
      window.alert('请填写具体尺寸，例如 12×15 或 12cm×15cm')
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
      <img class="layer z-31" :src="exportV2Assets.btnSpecific" alt="" />
      <img class="layer z-32" :src="exportV2Assets.btnOptional" alt="" />
      <img class="layer z-33" :src="exportV2Assets.textField" alt="" />

      <input
        v-if="mode === 'specific'"
        v-model="specificText"
        class="field-input z-34"
        :style="boxStyle(exportV2HitAreas.modalField)"
        placeholder="例如 12×15 cm"
        aria-label="具体尺寸"
      />
      <select
        v-else
        v-model="metaphorId"
        class="field-input z-34"
        :style="boxStyle(exportV2HitAreas.modalField)"
        aria-label="大小比喻"
      >
        <option v-for="option in SIZE_METAPHOR_OPTIONS" :key="option.id" :value="option.id">
          {{ option.label }} — {{ option.description }}
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
        class="hit hit--confirm z-40"
        :style="boxStyle(exportV2HitAreas.modalConfirm)"
        aria-label="确认导出"
        @click="onConfirm"
      />
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

.hit {
  position: absolute;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.hit--confirm {
  opacity: 0.02;
}

.field-input {
  position: absolute;
  margin: 0;
  padding: 0 16px;
  border: 0;
  background: transparent;
  color: #594738;
  font-size: 22px;
  outline: none;
  box-sizing: border-box;
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
</style>
