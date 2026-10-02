<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { FabricationJob, ForegroundMode } from '@shared/fabrication-desktop'
import type { LayerColors, SceneBinding } from '@shared/fabrication-colors'
import { validateColors } from '@shared/fabrication-colors'
import type { CanvasRecolorLink } from '../../fabrication/canvas-recolor'
import { recolorLayers } from '../../fabrication/recolor'
import type { ScreenBox } from '../../fabrication/panel-placement'
import LayerEditorPanel from './LayerEditorPanel.vue'

const props = defineProps<{ input: Uint8Array; binding: SceneBinding | null; anchor: ScreenBox; savedEdit?: CanvasRecolorLink;
  apply: (png: string, colors: LayerColors, jobId: string, sourceSha256: string) => Promise<void> }>()
const emit = defineEmits<{ close: []; preview: [png: string] }>()
const job = ref<FabricationJob>(), colors = ref<LayerColors>(), selected = ref(0)
const mode = ref<ForegroundMode>('embedded-alpha')
const saving = ref(false), dirty = ref(false), rendering = ref(false), starting = ref(false)
const error = ref(''), message = ref('正在准备这个元素的可编辑图层，作品留在原画布。')
const painted = ref<Awaited<ReturnType<typeof recolorLayers>>>()
const images: string[] = []
const busy = computed(() => starting.value || ['background','fabrication'].includes(job.value?.status || ''))
let key = '', sourceHash = '', generation = 0, disposed = false
let timer: ReturnType<typeof setTimeout> | undefined

async function paint(showOnCanvas = true): Promise<void> {
  if (!job.value?.result || !colors.value) return
  const current = ++generation; rendering.value = true
  try {
    const result = job.value.result
    const next = await recolorLayers(JSON.parse(JSON.stringify(colors.value)), images, result.width, result.height)
    if (!disposed && current === generation) { painted.value = next; if (showOnCanvas) emit('preview', next.composite) }
  } catch (e) { if (!disposed && current === generation) error.value = String(e) }
  finally { if (current === generation) rendering.value = false }
}
async function load(): Promise<void> {
  const current = job.value
  if (!current?.result) throw new Error('没有完整分层结果。')
  let doc = await window.electronAPI.fabrication.colors(current.id)
  if (current.result.sourceSha256 !== sourceHash || JSON.stringify(doc.binding) !== JSON.stringify(props.binding)) {
    throw new Error('保存的分层与当前元素不一致，未载入其他元素的图层。')
  }
  if (props.savedEdit) doc = { ...validateColors(props.savedEdit.colors, doc), revision: doc.revision }
  for (const step of current.result.steps) {
    const data = await window.electronAPI.fabrication.asset(current.id, step.asset)
    if (disposed) return
    images.push(URL.createObjectURL(new Blob([new Uint8Array(data.bytes).buffer], { type: data.mime })))
  }
  if (disposed) return
  colors.value = doc; selected.value = 0
  message.value = '选中一层调色，效果直接显示在作品中。'
  await paint(false)
  // A newly decomposed source can be applied without forcing a gratuitous color change.
  if (!props.savedEdit) { dirty.value = true; message.value = '真实分层已完成，可按层换色或直接应用到原画布。' }
}
async function poll(): Promise<void> {
  if (disposed || !job.value) return
  try {
    const next = await window.electronAPI.fabrication.status(job.value.id)
    if (disposed) return
    job.value = next; message.value = next.message
    if (next.status === 'complete') await load()
    else if (['background','fabrication'].includes(next.status)) timer = setTimeout(poll, 1000)
    else error.value = '此元素未完成分层，未使用示例图层替代。可关闭后重新尝试。'
  } catch (e) { if (!disposed) error.value = String(e) }
}
async function start(): Promise<void> {
  if (busy.value || !key) return
  starting.value = true; error.value = ''
  try {
    const next = await window.electronAPI.fabrication.start(props.input, mode.value, props.binding ? JSON.parse(JSON.stringify(props.binding)) : undefined)
    localStorage.setItem(key, next.id)
    if (disposed) return
    job.value = next; void poll()
  } catch (e) { if (!disposed) error.value = String(e) }
  finally { starting.value = false }
}
function changeColor(hex: string): void {
  const layer = colors.value?.layers[selected.value]
  if (!layer || saving.value) return
  layer.hex = hex; dirty.value = true; message.value = ''; void paint()
}
async function save(): Promise<void> {
  if (!colors.value || !job.value || !painted.value || saving.value || rendering.value) return
  saving.value = true; error.value = ''
  try {
    const saved = await window.electronAPI.fabrication.saveColors(job.value.id, JSON.parse(JSON.stringify(colors.value)))
    if (!disposed) {
      colors.value = saved
      await props.apply(painted.value.composite, saved, job.value.id, sourceHash)
      dirty.value = false; message.value = '已应用到画布，关闭面板不会恢复原色。保存作品后可继续编辑。'
    }
  } catch (e) { if (!disposed) error.value = String(e) }
  finally { saving.value = false }
}
onMounted(async () => {
  try {
    if (!window.electronAPI?.fabrication) throw new Error('请在已配置算法环境的桌面应用中使用。')
    sourceHash = props.savedEdit?.sourceSha256 || [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(props.input).buffer))].map(x => x.toString(16).padStart(2,'0')).join('')
    const identity = new TextEncoder().encode(JSON.stringify({ sourceHash, binding: props.binding }))
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', identity))].map(x => x.toString(16).padStart(2,'0')).join('')
    key = `felt-element-layers:${hash}`
    const id = props.savedEdit?.jobId || localStorage.getItem(key)
    if (id) {
      job.value = await window.electronAPI.fabrication.resume(id)
      if (disposed) return
      if (job.value.status === 'complete') await load()
      else if (['background','fabrication'].includes(job.value.status)) void poll()
      else error.value = '上次未完成，可以重试准备图层。'
    } else {
      // Source opacity selects an existing foreground mode, never an inferred RGB encoding.
      const url = URL.createObjectURL(new Blob([new Uint8Array(props.input).buffer], {type:'image/png'}))
      try {
        const image = new Image(); image.src = url; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        mode.value = data.some((alpha, i) => i % 4 === 3 && alpha < 255) ? 'embedded-alpha' : 'birefnet-general'
      } finally { URL.revokeObjectURL(url) }
      if (!disposed) await start()
    }
  } catch (e) { if (!disposed) error.value = String(e) }
})
onUnmounted(() => { disposed = true; generation++; clearTimeout(timer); images.forEach(url => URL.revokeObjectURL(url)) })
</script>

<template>
  <LayerEditorPanel :anchor="anchor" :colors="colors" :selected="selected" :images="painted?.layers"
    :saving="saving" :dirty="dirty" :rendering="rendering" :message="message" :error="error" save-label="应用到画布"
    @select="selected = $event" @color="changeColor" @save="save" @close="emit('close')">
    <div v-if="!colors" class="process-controls">
      <p>{{ busy ? '正在准备图层…' : '暂无可编辑图层' }}</p>
      <button v-if="error && !busy && !savedEdit" @click="start">重试准备图层</button>
      <small v-if="busy">关闭面板不会取消正在进行的处理。</small>
    </div>
  </LayerEditorPanel>
</template>
<style scoped>
.process-controls { display: grid; gap: 8px; } label { display: grid; gap: 4px; } select { max-width: 100%; padding: 6px; }
</style>
