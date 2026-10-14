<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getSavedWork, getWorkDisplayEntry, returnFromSavedWork } from '../app-nav'
import { buildWorkDisplay, type WorkDisplay } from '../workflows/work-display'
import Stage1920 from '../components/projection/v2/Stage1920.vue'
import ExplodeScreenV2 from '../components/projection/v2/ExplodeScreenV2.vue'
import ExportScreenV2 from '../components/projection/v2/ExportScreenV2.vue'
import { exportLayoutPdf, type LayoutLayerInput } from '../projection/pdf-layout'
import { defaultSubjectSizeChoice, layoutOptionsForSubject, type SubjectSizeChoice } from '../projection/subject-size'
import { handDrawnAssets } from '../ui/hand-drawn-assets'
import { authAssets } from '../ui/auth-assets'

const work = getSavedWork()
const display = ref<WorkDisplay>()
const error = ref('')
const loading = ref(true)
const entryScreen = getWorkDisplayEntry()
const screen = ref<'picture' | 'explode' | 'export'>(entryScreen)
const subjectSize = ref(defaultSubjectSizeChoice())
const exporting = ref(false)
const layoutLayers = computed<LayoutLayerInput[]>(() => layers.value.map((layer, index) => ({
  descriptor: { layerNumber: index + 1, kind: 'sticker', assetId: layer.id, label: layer.label, imageUrl: layer.image.objectUrl, zIndex: index },
  image: layer.image
})))
async function downloadPdf(choice: SubjectSizeChoice) {
  if (!work || exporting.value || !layoutLayers.value.length) return
  exporting.value = true; error.value = ''; subjectSize.value = choice
  try {
    const blob = await exportLayoutPdf({ workName: work.projectName + '（图层排版参考，非制造验收）', paper: 'a4', layers: layoutLayers.value, ...layoutOptionsForSubject(choice) })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${work.projectName.replace(/[\\/:*?"<>|]/g, '_')}-图层排版参考.pdf`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (cause) { error.value = (cause as Error).message }
  finally { exporting.value = false }
}
const step = ref(0)
const explode = ref(35)
const includeBackground = ref(true)
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
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { loading.value = false }
})
onUnmounted(() => controller.abort())
</script>
<template>
  <section class="work-display art-scrollbars" :style="{ backgroundImage: `url(${authAssets.background})` }" aria-label="已保存作品展示">
    <template v-if="screen !== 'picture' && display">
      <Stage1920>
        <ExplodeScreenV2 v-if="screen === 'explode'" :layers="layers" :explode="explode / 100" :explode-percent="explode"
          :include-background="includeBackground" background-label="场景背景与画布底色"
          @update:explode-percent="explode = $event" @enable-background="includeBackground = true"
          @disable-background="includeBackground = false" @back="entryScreen === 'explode' ? back() : (screen = 'picture')" @next="screen = 'export'" />
        <ExportScreenV2 v-else :layers="layoutLayers" :subject-size="subjectSize" :work-name="work?.projectName || '作品'"
          :busy="exporting"
          @back="screen = 'explode'" @finish="back" @confirm-export="downloadPdf" />
      </Stage1920>
      <p class="export-notice" role="status">仅供图层排版参考，不是精确制造纸样。{{ !layoutLayers.length ? '没有可导出的图层，请返回启用背景或添加元素。' : exporting ? '正在生成 PDF……' : error }}</p>
    </template>
    <template v-else>
      <header><button class="hand-icon-btn hand-icon-btn--back" aria-label="返回作品" @click="back"><img :src="handDrawnAssets.btnBack" alt="" /></button><h1>{{ work?.projectName }} · 展示</h1>
        <button class="hand-btn-primary" :disabled="!display" @click="screen = 'explode'">图层展开</button></header>
      <p v-if="loading" role="status">正在加载作品…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="display" class="display-content">
        <figure><img :src="display.assemblies[step]" alt="按保存的位置和层序重建的作品" />
          <figcaption>第 {{ step + 1 }} / {{ display.layers.length }} 个展示图层 · {{ display.layers[step]?.label }}</figcaption>
        </figure>
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
.export-notice { position: fixed; left: 15px; bottom: 0; z-index: 100; background: #fff8dc; padding: 6px; }
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
