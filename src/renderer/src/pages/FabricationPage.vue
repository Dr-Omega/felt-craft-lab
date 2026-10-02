<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { FabricationJob, ForegroundMode } from '@shared/fabrication-desktop'
import Stage1920 from '../components/projection/v2/Stage1920.vue'
import ExplodeScreenV2 from '../components/projection/v2/ExplodeScreenV2.vue'
import type { ExplodeLayerInput } from '../components/projection/ProjectionExplodeCanvas.vue'
import { takeFabricationInput } from '../app-nav'
import LayerEditorPanel from '../components/projection/LayerEditorPanel.vue'
import type { ScreenBox } from '../fabrication/panel-placement'
import type { LayerColors, SceneBinding } from '@shared/fabrication-colors'
import { recolorLayers } from '../fabrication/recolor'

// Module/session ID is retained in sessionStorage on navigation, never treated as PASS.
const SESSION = 'felt-fabrication-job'
const mode = ref<ForegroundMode>('birefnet-general')
const name = ref('')
const bytes = ref<Uint8Array>()
const original = ref('')
const job = ref<FabricationJob>()
const error = ref('')
const starting = ref(false)
const pollingFailed = ref(false)
const assets = ref<Record<string, string>>({})
const layers = ref<ExplodeLayerInput[]>([])
const colors = ref<LayerColors>()
const selected = ref(0)
const dirty = ref(false)
const saving = ref(false)
const rendering = ref(false)
const colorMessage = ref('')
const painted = ref<{ layers: string[]; assemblies: string[]; composite: string }>()
let binding: SceneBinding | undefined
let renderGeneration = 0
const selectedLayer = computed(() => colors.value?.layers[selected.value])
const workspaceOpen = ref(false)
const previewElement = ref<HTMLButtonElement>()
const editToolsOpen = ref(false)
const panelAnchor = ref<ScreenBox>({ left: 0, top: 0, width: 0, height: 0 })
function updatePanelAnchor(): void {
  const box = previewElement.value?.getBoundingClientRect()
  if (box) panelAnchor.value = { left: box.left, top: box.top, width: box.width, height: box.height }
}
function openColors(): void { updatePanelAnchor(); workspaceOpen.value = true; editToolsOpen.value = false }
const explode = ref(35)
const showFirstStep = ref(true)
const screen = ref<'images' | 'explode'>('images')
const urls = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const busy = computed(() => starting.value || ['background', 'fabrication'].includes(job.value?.status || ''))
const result = computed(() => job.value?.result)
const visibleLayers = computed(() => showFirstStep.value ? layers.value : layers.value.slice(1))
const assemblies = computed(() => Object.keys(assets.value).filter(key => key.startsWith('assembly-')))

function objectUrl(data: Uint8Array, mime: string): string {
  const url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type: mime }))
  urls.add(url)
  return url
}
function release(): void {
  renderGeneration++; colors.value = undefined; painted.value = undefined; dirty.value = false
  urls.forEach(url => URL.revokeObjectURL(url)); urls.clear()
  assets.value = {}; layers.value = []; original.value = ''
}
function input(data: Uint8Array, label: string): void {
  binding = undefined
  release(); bytes.value = data; name.value = label; job.value = undefined; error.value = ''
  sessionStorage.removeItem(SESSION)
  localStorage.removeItem(SESSION)
  original.value = objectUrl(data, data[0] === 137 ? 'image/png' : 'image/jpeg')
}
async function choose(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) { error.value = '请选择不超过 10 MB 的图片。'; return }
  input(new Uint8Array(await file.arrayBuffer()), file.name)
}
async function asset(key: string): Promise<string> {
  if (assets.value[key]) return assets.value[key]
  const data = await window.electronAPI.fabrication.asset(job.value!.id, key)
  if (disposed) return ''
  const url = objectUrl(data.bytes, data.mime)
  assets.value[key] = url
  return url
}
async function loadResult(): Promise<void> {
  if (!result.value) return
  for (const key of Object.keys(result.value.assets)) await asset(key)
  if (disposed) return
  colors.value = await window.electronAPI.fabrication.colors(job.value!.id)
  selected.value = 0; dirty.value = false
  await paint()
}
async function paint(): Promise<void> {
  if (!result.value || !colors.value) return
  const generation = ++renderGeneration
  rendering.value = true
  const view = result.value, doc = JSON.parse(JSON.stringify(colors.value)) as LayerColors
  try {
    const next = await recolorLayers(doc, view.steps.map(step => assets.value[step.asset]), view.width, view.height)
    if (disposed || generation !== renderGeneration) return
    painted.value = next
    layers.value = doc.layers.map(layer => ({ layerNumber: layer.layerIndex + 1,
      label: `第 ${layer.layerIndex + 1} 层 ${layer.hex} · ${layer.pieceIds.length} 块`,
      image: { width: view.width, height: view.height, objectUrl: next.layers[layer.layerIndex] } }))
  } catch (e) { if (generation === renderGeneration) error.value = String(e) }
  finally { if (generation === renderGeneration) rendering.value = false }
}
function changeColor(hex: string): void {
  if (!selectedLayer.value || saving.value) return
  selectedLayer.value.hex = hex; dirty.value = true; colorMessage.value = ''
  void paint()
}
async function saveColors(): Promise<void> {
  if (!job.value || !colors.value || saving.value) return
  saving.value = true; error.value = ''
  try {
    colors.value = await window.electronAPI.fabrication.saveColors(job.value.id, JSON.parse(JSON.stringify(colors.value)))
    dirty.value = false; colorMessage.value = '换色已保存，重新打开可继续编辑。'
  } catch (e) { error.value = String(e) }
  finally { saving.value = false }
}
async function discardColors(): Promise<void> {
  if (!job.value) return
  try { colors.value = await window.electronAPI.fabrication.colors(job.value.id); dirty.value = false; await paint() }
  catch (e) { error.value = String(e) }
}
async function poll(): Promise<void> {
  if (disposed || !job.value) return
  pollingFailed.value = false
  try {
    job.value = await window.electronAPI.fabrication.status(job.value.id)
    if (job.value.status !== 'background') await asset('foreground').catch(() => '')
    if (job.value.status === 'complete') await loadResult()
    else if (['background', 'fabrication'].includes(job.value.status)) timer = setTimeout(poll, 1000)
  } catch (e) { if (!disposed) { error.value = String(e); pollingFailed.value = true } }
}
async function start(): Promise<void> {
  if (!bytes.value || busy.value) return
  error.value = ''; starting.value = true
  try {
    if (!window.electronAPI?.fabrication) throw new Error('请在已配置算法环境的 Electron 应用中运行。')
    release(); screen.value = 'images'; job.value = undefined
    sessionStorage.removeItem(SESSION)
    original.value = objectUrl(bytes.value, bytes.value[0] === 137 ? 'image/png' : 'image/jpeg')
    job.value = await window.electronAPI.fabrication.start(bytes.value, mode.value, binding)
    sessionStorage.setItem(SESSION, job.value.id)
    localStorage.setItem(SESSION, job.value.id)
    void poll()
  } catch (e) { error.value = String(e) }
  finally { starting.value = false }
}
onMounted(async () => {
  window.addEventListener('resize', updatePanelAnchor)
  const supplied = takeFabricationInput()
  if (supplied) { input(supplied.bytes, supplied.name); binding = supplied.binding }
  else {
    const id = sessionStorage.getItem(SESSION) || localStorage.getItem(SESSION)
    if (id && window.electronAPI?.fabrication) {
      try { job.value = await window.electronAPI.fabrication.resume(id); void poll() }
      catch (e) { error.value = `无法恢复上次任务：${String(e)}` }
    }
  }
})
onUnmounted(() => { window.removeEventListener('resize', updatePanelAnchor); disposed = true; clearTimeout(timer); release() })
</script>

<template>
  <section class="fabrication-page" aria-label="去背景与真实裁片分层">
    <h2>去背景与真实裁片分层</h2>
    <p>复用现有算法 · 原图不覆盖 · 完整底板与单色制作步骤 · 当前为待审核候选</p>
    <div class="controls">
      <label>选择图片 <input type="file" accept="image/png,image/jpeg" :disabled="busy" @change="choose" /></label>
      <label>前景来源
        <select v-model="mode" :disabled="busy">
          <option value="birefnet-general">BiRefNet General 自动去背景</option>
          <option value="embedded-alpha">输入已有透明前景（不运行模型）</option>
        </select>
      </label>
      <button class="primary" :disabled="busy || !bytes" @click="start">{{ busy ? '处理中…' : '开始处理' }}</button>
    </div>
    <p v-if="name">输入：{{ name }}</p>
    <p role="status" aria-live="polite">{{ job?.message }}</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <button v-if="pollingFailed" @click="poll">重新读取任务状态（不重新计算）</button>
    <p v-if="job && ['failed', 'timeout'].includes(job.status)" role="alert" class="error">本次未完成，未用示例或旧结果替代。可更换图片重试；日志保留在本地任务目录。</p>
    <div class="images">
      <figure v-if="original"><img :src="original" alt="未经修改的输入原图" /><figcaption>输入原图</figcaption></figure>
      <figure v-if="assets.foreground"><img :src="assets.foreground" alt="实际透明前景" /><figcaption>实际前景（颜色未做去混色恢复）</figcaption></figure>
    </div>
    <template v-if="result">
      <p class="summary">{{ result.pieceCount }} 块实际裁片 · {{ result.stepCount }} 个单色制作步骤 · 最大材料叠压 {{ result.materialDepth }} 层</p>
      <p>几何回读：{{ result.geometryStatus }}；视觉效果待人工确认；制造未评估。生产导出未启用。</p>
      <section v-if="colors && painted" class="inline-color-preview" aria-label="原位换色预览">
        <p>双击图案，再点“编辑”。拼贴作品请在原画布中选择元素编辑；这里保留当前处理结果，不另开背景页。</p>
        <button ref="previewElement" class="inline-color-object" aria-label="选择已分层元素" @dblclick="editToolsOpen = true" @keydown.enter.prevent="editToolsOpen = true" @keydown.space.prevent="editToolsOpen = true">
          <img :src="painted.composite" alt="当前元素的实际裁片叠贴" />
        </button>
        <button v-if="editToolsOpen" class="primary" @click="openColors">编辑</button>
      </section>
      <LayerEditorPanel v-if="workspaceOpen && colors && painted" :anchor="panelAnchor" :colors="colors" :selected="selected" :images="painted.layers"
        :saving="saving" :dirty="dirty" :rendering="rendering" :message="colorMessage" :error="error"
        @select="selected = $event" @color="changeColor" @save="saveColors" @discard="discardColors" @close="workspaceOpen = false" />
      <div class="controls">
        <button :aria-pressed="screen === 'images'" @click="screen = 'images'">实际展开与逐层图</button>
        <button :aria-pressed="screen === 'explode'" @click="screen = 'explode'">3D 展开</button>
      </div>
      <p v-if="screen === 'explode'">下方“背景”开关仅显示／隐藏首个制作步骤，不改变去背景结果或底板。展开距离不是材料厚度。</p>
      <div v-if="screen === 'explode'" class="stage">
        <Stage1920><ExplodeScreenV2 :layers="visibleLayers" :explode="explode / 100" :explode-percent="explode"
          :include-background="showFirstStep" background-label="首个制作步骤（仅影响显示）"
          @update:explode-percent="explode = $event" @enable-background="showFirstStep = true"
          @disable-background="showFirstStep = false" @next="screen = 'images'" @back="screen = 'images'" /></Stage1920>
      </div>
      <div v-else-if="painted" class="images">
        <figure v-for="(image, index) of painted.layers" :key="index"><img :src="image" :alt="`第 ${index + 1} 层完整裁片（换色后）`" /><figcaption>第 {{ index + 1 }} 层全部完整裁片 · 片号 {{ result.steps[index].pieceNumbers.join('、') }}</figcaption></figure>
        <figure v-for="(image, index) of painted.assemblies" :key="`paint-${index}`"><img :src="image" :alt="`换色后第 ${index + 1} 步叠贴`" /><figcaption>换色后叠贴至第 {{ index + 1 }} 层</figcaption></figure>
      </div>
      <details><summary>算法原始诊断图（保留原色，不随编辑覆盖）</summary><div class="images">
        <figure v-for="[key, label] of [['design','选中的制作设计'],['pieces','完整裁片展开（紫色为隐藏材料）'],['hidden','推断隐藏域'],['seams','实际接缝'],['numbers','实际片号'],['rerender','完整裁片独立重绘']]" :key="key">
          <img :src="assets[key]" :alt="label" /><figcaption>{{ label }}</figcaption>
        </figure>
      </div>
      <h3>单色制作步骤（不是原图的历史图层）</h3>
      <ol><li v-for="step of result.steps" :key="step.step">
        {{ step.colorSlotId }} · RGB {{ step.rgb.join(', ') }} · 片号 {{ step.pieceNumbers.join('、') }}
      </li></ol>
      <div class="images"><figure v-for="(key, index) of assemblies" :key="key">
        <img :src="assets[key]" :alt="`第 ${index + 1} 步实际叠贴`" /><figcaption>第 {{ index + 1 }} 步实际叠贴</figcaption>
      </figure></div></details>
      <details><summary>处理身份</summary><p class="identity">结果 SHA256：{{ result.resultSha256 }}<br />输入 SHA256：{{ result.sourceSha256 }}</p></details>
    </template>
  </section>
</template>

<style scoped>
.fabrication-page { overflow: auto; padding: 4px 12px 24px; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.inline-color-preview { margin: 16px 0; }
.inline-color-object { display: block; width: min(100%, 340px); height: 300px; padding: 0; border: 0; background: transparent; }
.inline-color-object img { display: block; width: 100%; height: 100%; object-fit: contain; }
label { display: grid; gap: 6px; }
select, input { max-width: 100%; font: inherit; padding: 6px; }
.images { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-top: 16px; }
figure { margin: 0; padding: 10px; border: 1px solid var(--line); background: var(--panel); }
figure img { display: block; width: 100%; height: 280px; object-fit: contain; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 / 20px 20px; }
figcaption { padding-top: 8px; }
.stage { width: 100%; aspect-ratio: 16 / 9; margin: 12px 0; }
.error { color: var(--danger); }
.summary { font-weight: 700; }
.identity { overflow-wrap: anywhere; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
</style>
