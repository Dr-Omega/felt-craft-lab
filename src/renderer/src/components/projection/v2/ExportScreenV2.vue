<script setup lang="ts">
import { computed, ref } from 'vue'
import LayoutPreviewCanvas from './LayoutPreviewCanvas.vue'
import { exportModalBox, exportV2Assets, exportV2HitAreas } from '../../../ui/export-v2-assets'
import { boxStyle, VIEWPORT_BOUNDS } from '../../../ui/stage-1920'
import {
  SIZE_METAPHOR_OPTIONS,
  choiceFromMetaphor,
  choiceFromSpecificInput,
  type SubjectSizeChoice,
  type SubjectSizeMode
} from '../../../projection/subject-size'
import type { LayoutLayerInput } from '../../../projection/pdf-layout'

const props = defineProps<{
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

const metaphorLabel = computed(
  () => SIZE_METAPHOR_OPTIONS.find((item) => item.id === metaphorId.value)?.label ?? ''
)

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
    <img class="layer" :src="exportV2Assets.bigBackground" alt="" />
    <img class="layer layer--projection-frame" :src="exportV2Assets.projectionFrame" alt="" />
    <div class="layer layer--preview" :style="boxStyle(VIEWPORT_BOUNDS)">
      <LayoutPreviewCanvas :layers="layers" :subject-size="subjectSize" />
    </div>

    <button
      type="button"
      class="hit"
      :style="boxStyle(exportV2HitAreas.exportToggle)"
      aria-label="导出"
      @click="toggleModal"
    >
      <img :src="exportV2Assets.btnExport" alt="" />
    </button>
    <button
      type="button"
      class="hit"
      :style="boxStyle(exportV2HitAreas.finish)"
      aria-label="完成作品"
      @click="emit('finish')"
    >
      <img :src="exportV2Assets.btnFinish" alt="" />
    </button>

    <div v-if="modalOpen" class="export-modal" :style="boxStyle(exportModalBox)">
      <img class="export-modal__art" :src="exportV2Assets.exportModal" alt="" />
      <p class="export-modal__paper">背景：A4</p>
      <p class="export-modal__hint">图案大小：</p>

      <button
        type="button"
        class="hit hit--mode"
        :class="{ 'is-active': mode === 'specific' }"
        :style="boxStyle(exportV2HitAreas.modalSpecific)"
        @click="selectMode('specific')"
      >
        <img :src="exportV2Assets.btnSpecific" alt="具体" />
      </button>
      <button
        type="button"
        class="hit hit--mode"
        :class="{ 'is-active': mode === 'metaphor' }"
        :style="boxStyle(exportV2HitAreas.modalOptional)"
        @click="selectMode('metaphor')"
      >
        <img :src="exportV2Assets.btnOptional" alt="可选" />
      </button>

      <div class="export-modal__field" :style="boxStyle(exportV2HitAreas.modalField)">
        <img class="export-modal__field-bg" :src="exportV2Assets.textField" alt="" />
        <input
          v-if="mode === 'specific'"
          v-model="specificText"
          class="export-modal__input"
          placeholder="例如 12×15 cm"
          aria-label="具体尺寸"
        />
        <select v-else v-model="metaphorId" class="export-modal__select" aria-label="大小比喻">
          <option v-for="option in SIZE_METAPHOR_OPTIONS" :key="option.id" :value="option.id">
            {{ option.label }} — {{ option.description }}
          </option>
        </select>
      </div>

      <p v-if="mode === 'metaphor'" class="export-modal__choice">已选：{{ metaphorLabel }}</p>

      <button
        type="button"
        class="export-modal__confirm"
        :style="boxStyle(exportV2HitAreas.modalConfirm)"
        @click="onConfirm"
      >
        确认
      </button>
    </div>

    <img class="layer layer--frame-border" :src="exportV2Assets.frameBorder" alt="" />
    <button
      type="button"
      class="hit hit--back"
      :style="boxStyle(exportV2HitAreas.back)"
      aria-label="返回展开页"
      @click="emit('back')"
    >
      <img :src="exportV2Assets.btnBack" alt="" />
    </button>
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
  inset: auto;
  padding: 8px;
  box-sizing: border-box;
}

.hit {
  position: absolute;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 12;
}

.hit img {
  display: block;
  width: 100%;
  height: 100%;
}

.hit--back,
.layer--frame-border {
  z-index: 20;
}

.export-modal {
  z-index: 30;
}

.export-modal__art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.export-modal__paper,
.export-modal__hint,
.export-modal__choice {
  position: absolute;
  left: 72px;
  margin: 0;
  color: #7d261a;
  font-weight: 700;
  font-size: 22px;
  z-index: 2;
}

.export-modal__paper {
  top: 250px;
}

.export-modal__hint {
  top: 300px;
}

.export-modal__choice {
  top: 560px;
  left: 80px;
  font-size: 18px;
}

.hit--mode.is-active {
  filter: drop-shadow(0 0 8px rgba(125, 38, 26, 0.55));
}

.export-modal__field {
  position: absolute;
  z-index: 2;
}

.export-modal__field-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.export-modal__input,
.export-modal__select {
  position: relative;
  z-index: 1;
  width: calc(100% - 24px);
  height: calc(100% - 20px);
  margin: 10px 12px;
  border: 0;
  background: transparent;
  color: #594738;
  font-size: 18px;
  outline: none;
}

.export-modal__confirm {
  position: absolute;
  z-index: 2;
  border: 3px solid #7d261a;
  border-radius: 999px;
  background: #f5e5a4;
  color: #7d261a;
  font-size: 22px;
  font-weight: 700;
  cursor: pointer;
}
</style>
