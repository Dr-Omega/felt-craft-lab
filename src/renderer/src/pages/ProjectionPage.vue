<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import PsdFrameStage from '../components/shell/PsdFrameStage.vue'
import ProjectionExplodeCanvas from '../components/projection/ProjectionExplodeCanvas.vue'
import { getProjectionLaunch, openProjectionWithScene, subscribeAppNav, type ProjectionLaunchContext } from '../app-nav'
import {
  createProjectionDemoScene,
  PROJECTION_DEMO_LAYER_LABELS
} from '../projection/projection-demo-scene'
import { buildProjectionLayers } from '../projection/projection-layers'
import { loadLayerImage, revokeLoadedLayerImages, type LoadedLayerImage } from '../projection/load-layer-image'
import { exportLayoutPdf, type PaperSize } from '../projection/pdf-layout'
import type { ProjectionLayerDescriptor } from '../projection/projection-layers'

const launch = ref<ProjectionLaunchContext | undefined>(getProjectionLaunch())
const includeBackground = ref(false)
/** UI slider 0–100; Three.js uses normalized 0–1 separation. */
const explodePercent = ref(45)
const explodeNormalized = computed(() => explodePercent.value / 100)
const paperSize = ref<PaperSize>('a4')
const busy = ref(false)
const errorMessage = ref('')
const descriptors = ref<ProjectionLayerDescriptor[]>([])
const loadedImages = ref<LoadedLayerImage[]>([])
let reloadGeneration = 0

const isDev = import.meta.env.DEV

const hasScene = computed(() => Boolean(launch.value?.scene))
const workName = computed(() => launch.value?.scene.workName?.trim() || '我的作品')
const explodeLayers = computed(() =>
  descriptors.value.map((descriptor, index) => ({
    layerNumber: descriptor.layerNumber,
    label: descriptor.label,
    image: loadedImages.value[index]!
  }))
)

async function reloadLayers(): Promise<void> {
  const generation = ++reloadGeneration
  errorMessage.value = ''
  revokeLoadedLayerImages(loadedImages.value)
  loadedImages.value = []
  descriptors.value = []

  if (!launch.value?.scene) return

  busy.value = true
  try {
    const built = await buildProjectionLayers(launch.value.scene, {
      includeBackground: includeBackground.value
    })
    if (generation !== reloadGeneration) return
    if (built.length === 0) {
      errorMessage.value = '这件作品还没有可展示的图层。'
      return
    }
    const images: LoadedLayerImage[] = []
    for (const layer of built) {
      images.push(await loadLayerImage(layer.imageUrl))
      if (generation !== reloadGeneration) {
        revokeLoadedLayerImages(images)
        return
      }
    }
    descriptors.value = built
    loadedImages.value = images
  } catch (error) {
    if (generation === reloadGeneration) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (generation === reloadGeneration) {
      busy.value = false
    }
  }
}

async function downloadPdf(): Promise<void> {
  if (!launch.value?.scene || descriptors.value.length === 0) return
  busy.value = true
  errorMessage.value = ''
  try {
    const layers = descriptors.value.map((descriptor, index) => ({
      descriptor,
      image: loadedImages.value[index]!
    }))
    const blob = await exportLayoutPdf({
      workName: workName.value,
      paper: paperSize.value,
      layers
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${workName.value}-排版-${paperSize.value.toUpperCase()}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

watch(includeBackground, () => {
  void reloadLayers()
})

watch(
  () => launch.value?.scene.sceneId,
  () => {
    void reloadLayers()
  }
)

function syncLaunch(): void {
  launch.value = getProjectionLaunch()
}

function loadDemoScene(): void {
  openProjectionWithScene({
    scene: createProjectionDemoScene(),
    sourceLabel: '演示 · 中秋四层贴纸'
  })
  syncLaunch()
}

function shouldAutoLoadDemo(): boolean {
  if (!isDev) return false
  if (getProjectionLaunch()?.scene) return false
  const params = new URLSearchParams(window.location.search)
  return params.has('projectionDemo') || window.location.hash === '#projection-demo'
}

let unsubscribeNav = subscribeAppNav(syncLaunch)

onMounted(() => {
  syncLaunch()
  if (shouldAutoLoadDemo()) {
    loadDemoScene()
  } else {
    void reloadLayers()
  }
})

onUnmounted(() => {
  unsubscribeNav()
  revokeLoadedLayerImages(loadedImages.value)
})
</script>

<template>
  <section class="projection-page" aria-label="3D 投影屏">
    <PsdFrameStage frame="projection-screen">
      <div class="projection-viewport">
        <div v-if="!hasScene" class="projection-empty text-box-surface">
          <p class="projection-empty-title">还没有作品可以展示</p>
          <p class="projection-empty-hint">请先从 Editor 或 Library 选择作品</p>
          <template v-if="isDev">
            <button type="button" class="primary" @click="loadDemoScene">加载演示作品（4 层贴纸 + 背景）</button>
            <ul class="demo-layer-hint">
              <li v-for="line in PROJECTION_DEMO_LAYER_LABELS" :key="line">{{ line }}</li>
            </ul>
          </template>
        </div>

        <template v-else>
          <div class="projection-stage">
            <ProjectionExplodeCanvas
              v-if="explodeLayers.length > 0"
              :layers="explodeLayers"
              :explode="explodeNormalized"
            />
            <p v-else-if="!busy" class="projection-empty-inline">暂无可展示图层。</p>
          </div>

          <aside class="projection-controls text-box-surface">
            <h3>{{ workName }}</h3>
            <p v-if="launch?.sourceLabel" class="muted">{{ launch?.sourceLabel }}</p>

            <label class="control-row control-row--inline">
              背景参与分层展示
              <input v-model="includeBackground" type="checkbox" :disabled="busy" />
            </label>

            <label class="control-row">
              炸开程度 {{ explodePercent }}%
              <input v-model.number="explodePercent" type="range" min="0" max="100" step="1" :disabled="busy" />
            </label>

            <fieldset class="control-row">
              <legend>纸张</legend>
              <label><input v-model="paperSize" type="radio" value="a4" :disabled="busy" /> A4</label>
              <label><input v-model="paperSize" type="radio" value="a3" :disabled="busy" /> A3</label>
            </fieldset>

            <button type="button" class="primary" :disabled="busy || explodeLayers.length === 0" @click="downloadPdf">
              下载排版 PDF
            </button>

            <p v-if="busy" class="muted">处理中…</p>
            <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

            <ul v-if="descriptors.length > 0" class="layer-list">
              <li v-for="layer in descriptors" :key="`${layer.kind}-${layer.assetId}-${layer.layerNumber}`">
                {{ layer.layerNumber }}. {{ layer.label }}
              </li>
            </ul>
          </aside>
        </template>
      </div>
    </PsdFrameStage>
  </section>
</template>

<style scoped>
.projection-page {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

.projection-page :deep(.psd-frame-stage__content) {
  pointer-events: auto;
}

.projection-viewport {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 34%);
  gap: 10px;
  padding: 8px;
  box-sizing: border-box;
  background: rgba(245, 236, 216, 0.82);
}

.projection-stage {
  min-height: 0;
  border: 1px dashed rgba(140, 110, 80, 0.45);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 252, 245, 0.65);
}

.projection-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  font-size: 0.9rem;
  overflow: auto;
}

.projection-controls h3 {
  margin: 0;
  font-size: 1rem;
}

.control-row {
  display: grid;
  gap: 6px;
}

.control-row--inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
}

.control-row legend {
  font-size: 0.85rem;
}

.muted {
  margin: 0;
  color: var(--muted);
}

.error {
  margin: 0;
  color: var(--danger);
}

.layer-list {
  margin: 0;
  padding-left: 1.2rem;
  max-height: 140px;
  overflow: auto;
  list-style: none;
}

.projection-empty {
  grid-column: 1 / -1;
  place-self: center;
  text-align: center;
  padding: 24px;
  max-width: 420px;
}

.projection-empty-title {
  margin: 0 0 8px;
  font-size: 1.2rem;
  font-weight: 700;
}

.projection-empty-hint {
  margin: 0;
  color: var(--muted);
}

.demo-layer-hint {
  margin: 12px 0 0;
  padding-left: 1.2rem;
  text-align: left;
  color: var(--muted);
  font-size: 0.85rem;
}

.projection-empty-inline {
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--muted);
}
</style>
