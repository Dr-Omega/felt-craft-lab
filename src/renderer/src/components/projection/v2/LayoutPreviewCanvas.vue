<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { layoutLayersOnPages, type LayoutLayerInput } from '../../../projection/pdf-layout'
import { layoutOptionsForSubject, type SubjectSizeChoice } from '../../../projection/subject-size'
import { PAGE_MM } from '../../../projection/pdf-layout'

const props = defineProps<{
  layers: LayoutLayerInput[]
  subjectSize: SubjectSizeChoice
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const error = ref('')
let revision=0
onUnmounted(()=>{revision++})

async function renderPreview(): Promise<void> {
  const current=++revision
  error.value=''
  const canvas = canvasEl.value
  if (!canvas) return

  const paper = PAGE_MM.a4
  const scale = canvas.width / paper.width
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fffef8'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  try {
  const pages = layoutLayersOnPages(props.layers, 'a4', layoutOptionsForSubject(props.subjectSize))
  const page = pages[0]
  if (!page) return
  for (const item of page.placed) {
    const image = await decodeImage(item.layer.image.objectUrl)
    if(current!==revision) return
    const x = item.x * scale
    const y = item.y * scale
    const w = item.width * scale
    const h = item.height * scale
    ctx.drawImage(image, x, y, w, h)
    ctx.strokeStyle = '#8c6e50'
    ctx.setLineDash([4, 4])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])
    ctx.fillStyle = '#594738'
    ctx.font = `${Math.max(10, 10 * scale)}px sans-serif`
    ctx.fillText(String(item.layer.descriptor.layerNumber), x + 4, y + 14)
  }
  } catch(cause) { if(current===revision) error.value=cause instanceof Error?cause.message:String(cause) }
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('预览图片解码失败'))
    image.src = src
  })
}

onMounted(() => {
  void renderPreview()
})

watch(
  () => [props.layers, props.subjectSize],
  () => {
    void renderPreview()
  },
  { deep: true }
)
</script>

<template>
  <canvas ref="canvasEl" class="layout-preview-canvas" width="420" height="594" aria-label="排版预览" />
  <p v-if="error" class="preview-error" role="alert">{{ error }}</p>
</template>

<style scoped>
.preview-error { position: absolute; inset: 12px; color: #7d261a; }
.layout-preview-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fffef8;
}
</style>
