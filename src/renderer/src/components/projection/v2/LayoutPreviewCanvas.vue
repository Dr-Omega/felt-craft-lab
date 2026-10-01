<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { layoutLayersOnPages, type LayoutLayerInput } from '../../../projection/pdf-layout'
import { maxLayerWidthMmForSubject, type SubjectSizeChoice } from '../../../projection/subject-size'
import { PAGE_MM } from '../../../projection/pdf-layout'

const props = defineProps<{
  layers: LayoutLayerInput[]
  subjectSize: SubjectSizeChoice
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)

async function renderPreview(): Promise<void> {
  const canvas = canvasEl.value
  if (!canvas || props.layers.length === 0) return
  const maxW = maxLayerWidthMmForSubject(props.subjectSize)
  const pages = layoutLayersOnPages(props.layers, 'a4', { maxLayerWidthMm: maxW })
  const page = pages[0]
  if (!page) return

  const paper = PAGE_MM.a4
  const scale = canvas.width / paper.width
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fffef8'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (const item of page.placed) {
    const image = await decodeImage(item.layer.image.objectUrl)
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
</template>

<style scoped>
.layout-preview-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fffef8;
}
</style>
