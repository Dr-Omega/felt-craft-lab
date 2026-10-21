<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { getSavedWork, getWorkDisplayEntry, returnFromSavedWork } from '../app-nav'
import { buildWorkDisplay, type WorkDisplay } from '../workflows/work-display'
import Stage1920 from '../components/projection/v2/Stage1920.vue'
import ExplodeScreenV2 from '../components/projection/v2/ExplodeScreenV2.vue'
import ExportScreenV2 from '../components/projection/v2/ExportScreenV2.vue'
import { defaultSubjectSizeChoice, type SubjectSizeChoice } from '../projection/subject-size'
import { exportCuttingPdf } from '../projection/cutting-pdf'
import { buildAssemblyGuide } from '../projection/assembly-guide'
import { BlueprintStore } from '../persistence/blueprints'
import { cuttingPageThumbnail } from '../projection/cutting-thumbnail'
import { planCuttingPages, type CutPiece } from '../projection/cutting-layout'
import { prepareWorkCuts } from '../workflows/work-cutting'
import CuttingPreview from '../components/projection/v2/CuttingPreview.vue'
import { handDrawnAssets } from '../ui/hand-drawn-assets'
import { authAssets } from '../ui/auth-assets'

const work = getSavedWork()
const display = ref<WorkDisplay>()
const error = ref('')
const loading = ref(true)
const entryScreen = getWorkDisplayEntry()
const screen = ref<'picture' | 'explode' | 'export'>(entryScreen)
const isArtworkScreen = computed(() => screen.value !== 'picture' && Boolean(display.value))
const subjectSize = ref(defaultSubjectSizeChoice())
const exporting = ref(false)
// Prepared source geometry is immutable; layout must not alter its contours.
const cuts = shallowRef<CutPiece[]>([])
const preparing = ref(false)
const progress = ref('')
let preparationGeneration = 0
const plan = computed(() => {
  if (!cuts.value.length) return undefined
  try { return planCuttingPages(cuts.value, subjectSize.value) } catch { return undefined }
})
async function prepareCuts() {
  if (!work || preparing.value) return
  preparing.value = true; error.value = ''
  const generation = preparationGeneration
  try {
    const prepared = await prepareWorkCuts(work, text => { progress.value = text }, controller.signal, {
      backgroundMode: includeBackground.value ? 'layers' : 'image',
      backgroundImage: display.value?.layers.find(layer => layer.background)?.image
    })
    if (generation === preparationGeneration && !controller.signal.aborted) cuts.value = prepared
  }
  catch (cause) { if (!controller.signal.aborted) error.value = (cause as Error).message }
  finally { preparing.value = false; progress.value = '' }
}
async function downloadPdf(choice: SubjectSizeChoice) {
  if (!work || !display.value || exporting.value || !cuts.value.length) return
  exporting.value = true; error.value = ''
  try {
    const next = planCuttingPages(cuts.value, choice)
    subjectSize.value = choice
    const guide = buildAssemblyGuide(cuts.value, display.value)
    const blob = await exportCuttingPdf(next, work.projectName, guide)
    await new BlueprintStore().save(work, { pdf:blob, thumbnail:await cuttingPageThumbnail(next.pages[0]),
      size:choice, backgroundMode:includeBackground.value ? 'layers' : 'image' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${work.projectName.replace(/[\\/:*?"<>|]/g, '_')}-彩色裁片图纸.pdf`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (cause) { error.value = (cause as Error).message }
  finally { exporting.value = false }
}
const step = ref(0)
const explode = ref(35)
const includeBackground = ref(true)
watch(includeBackground, () => { preparationGeneration++; cuts.value = []; error.value = '' })
const controller = new AbortController()
const layers = computed(() => (display.value?.layers ?? [])
  .filter(layer => includeBackground.value || !layer.background)
  .map((layer, index) => ({ id: layer.id, layerNumber: index + 1, label: layer.label,
    image: { width: display.value!.width, height: display.value!.height, objectUrl: layer.image } })))
async function back(): Promise<void> {
  try { await returnFromSavedWork() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
onMounted(async () => {
  try {
    if (!work) throw new Error('请从已保存作品进入展示。')
    const result = await buildWorkDisplay(work, controller.signal)
    if (controller.signal.aborted) return
    display.value = result
    step.value = result.layers.length - 1
    if (entryScreen === 'export') {
      const saved = await new BlueprintStore().getForWork(work)
      if (saved) { includeBackground.value = saved.backgroundMode === 'layers'; subjectSize.value = saved.size }
      await nextTick()
      await prepareCuts()
    }
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { loading.value = false }
})
onUnmounted(() => controller.abort())
</script>
<template>
  <section class="work-display art-scrollbars" :class="{ 'work-display--artwork': isArtworkScreen }"
    :style="{ backgroundImage: isArtworkScreen ? 'none' : `url(${authAssets.background})` }" aria-label="已保存作品展示">
    <template v-if="isArtworkScreen">
      <Stage1920>
        <ExplodeScreenV2 v-if="screen === 'explode'" :layers="layers" :explode="explode / 100" :explode-percent="explode"
          :include-background="includeBackground" background-label="作品背景"
          @update:explode-percent="explode = $event" @enable-background="includeBackground = true"
          @disable-background="includeBackground = false" @back="entryScreen === 'explode' ? back() : (screen = 'picture')" @next="screen = 'export'" />
        <ExportScreenV2 v-else :layers="[]" :ready="cuts.length > 0" :subject-size="subjectSize" :work-name="work?.projectName || '作品'"
          :busy="exporting"
          @back="screen = 'explode'" @finish="back" @confirm-export="downloadPdf">
          <template #preview>
            <CuttingPreview v-if="plan" :plan="plan" />
            <div v-else class="cut-preparation">
              <p v-if="preparing" role="status">{{ progress || '正在准备裁片…' }}</p>
              <button class="hand-btn-primary" :disabled="preparing" @click="prepareCuts">{{ preparing ? '正在准备…' : error ? '重试准备裁片' : '准备图纸排版' }}</button>
            </div>
          </template>
        </ExportScreenV2>
      </Stage1920>
      <p v-if="error || exporting" class="export-notice" :role="error ? 'alert' : 'status'">{{ error || '正在生成 PDF……' }}</p>
    </template>
    <template v-else>
      <header><button class="hand-icon-btn hand-icon-btn--back" aria-label="返回作品" @click="back"><img :src="handDrawnAssets.btnBack" alt="" /></button><h1>{{ work?.projectName }} · 展示</h1>
        <button class="hand-btn-primary" :disabled="!display" @click="screen = 'explode'">图层展开</button></header>
      <p v-if="loading" role="status">正在加载作品…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="display" class="display-content">
        <figure v-if="display.layers.length"><img :src="display.assemblies[step]" alt="按保存的位置和层序重建的作品" />
          <figcaption>第 {{ step + 1 }} / {{ display.layers.length }} 个展示图层 · {{ display.layers[step]?.label }}</figcaption>
        </figure>
        <p v-else role="status">还没有放入素材或背景。</p>
        <aside class="text-box-surface" aria-label="作品图层">
          <button class="hand-btn-secondary" @click="step = display.layers.length - 1">完整画面</button>
          <ol><li v-for="(layer, index) in display.layers" :key="layer.id">
            <button :aria-pressed="step === index" @click="step = index">
              <img :src="layer.image" alt="" />{{ layer.label }}
            </button>
          </li></ol>
        </aside>
      </div>
    </template>
  </section>
</template>
<style scoped>
.work-display { height: 100%; background-color: #fbf2bb; background-size: cover; background-position: center; overflow: auto; padding: 14px; }
.work-display--artwork { padding: 0; overflow: hidden; }
.export-notice { position: fixed; left: 15px; bottom: 0; z-index: 100; background: #fff8dc; padding: 6px; }
.cut-preparation { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 60px; box-sizing: border-box; pointer-events: auto; text-align: center; color: #594738; background: #fffbed; font-size: 26px; }
.cut-preparation h2 { font-size: 38px; }.cut-preparation p { line-height: 1.6; }.cut-preparation button { font-size: 28px; padding: 16px 36px; }
header { display: flex; align-items: center; gap: 16px; padding: 8px 12px; background: #fff4bde8; border-radius: 12px; } h1 { flex: 1; font-size: 22px; margin: 8px; overflow-wrap: anywhere; }
.display-content { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; height: calc(100% - 110px); }
figure { margin: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; }
figure > img { width: 100%; height: calc(100% - 45px); object-fit: contain; }
figcaption { padding: 10px; background: #fff4bde8; border-radius: 12px; } aside { overflow: auto; padding: 18px; } ol { padding: 0; list-style: none; }
li button { width: 100%; text-align: left; margin: 6px 0; display: flex; align-items: center; gap: 8px; border: 2px solid transparent; background: transparent; }
li img { width: 62px; height: 54px; object-fit: contain; background: transparent; }
[aria-pressed="true"] { border-color: #7d261a; background: #fff4bd; } .disclaimer { color: #755b45; font-size: 13px; }
button:focus-visible { outline: 3px solid #7d261a; outline-offset: 2px; }
@media(max-width: 700px) { .display-content { grid-template-columns: minmax(0, 1fr); height: auto; } figure > img { max-height: 65vh; } header { flex-wrap: wrap; } h1 { font-size: 18px; } }
</style>
