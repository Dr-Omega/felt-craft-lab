<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Stage1920 from '../components/projection/v2/Stage1920.vue'
import ExplodeScreenV2 from '../components/projection/v2/ExplodeScreenV2.vue'
import ExportScreenV2 from '../components/projection/v2/ExportScreenV2.vue'
import { useProjectionV2Session } from '../composables/projection-v2-session'
import { createProjectionDemoScene } from '../projection/projection-demo-scene'
import { buildProjectionLayers } from '../projection/projection-layers'
import { loadLayerImage, revokeLoadedLayerImages } from '../projection/load-layer-image'
import { exportLayoutPdf } from '../projection/pdf-layout'
import { maxLayerWidthMmForSubject, type SubjectSizeChoice } from '../projection/subject-size'
import { showCenterToast } from '../composables/center-toast'
import { openProjectionWithScene } from '../app-nav'

const session = useProjectionV2Session()
let reloadGeneration = 0

async function reloadLayers(): Promise<void> {
  const generation = ++reloadGeneration
  revokeLoadedLayerImages(session.loadedImages.value)
  session.loadedImages.value = []
  session.descriptors.value = []

  const scene = createProjectionDemoScene()
  session.workName.value = scene.workName?.trim() || '我的作品'

  try {
    const built = await buildProjectionLayers(scene, {
      includeBackground: session.includeBackground.value
    })
    if (generation !== reloadGeneration) return
    const images = []
    for (const layer of built) {
      images.push(await loadLayerImage(layer.imageUrl))
      if (generation !== reloadGeneration) {
        revokeLoadedLayerImages(images)
        return
      }
    }
    session.descriptors.value = built
    session.loadedImages.value = images
  } catch (error) {
    showCenterToast(error instanceof Error ? error.message : String(error))
  }
}

async function downloadPdf(choice: SubjectSizeChoice): Promise<void> {
  if (session.layoutLayers.value.length === 0) return
  session.subjectSize.value = choice
  try {
    const blob = await exportLayoutPdf({
      workName: session.workName.value,
      paper: 'a4',
      layers: session.layoutLayers.value,
      maxLayerWidthMm: maxLayerWidthMmForSubject(choice)
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${session.workName.value}-排版-A4.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
    showCenterToast('PDF 已开始下载')
  } catch (error) {
    showCenterToast(error instanceof Error ? error.message : String(error))
  }
}

function onEnableBackground(): void {
  if (session.includeBackground.value) return
  session.includeBackground.value = true
  void reloadLayers()
}

function onDisableBackground(): void {
  if (!session.includeBackground.value) return
  session.includeBackground.value = false
  void reloadLayers()
}

onMounted(() => {
  openProjectionWithScene({
    scene: createProjectionDemoScene(),
    sourceLabel: '演示 · 中秋四层贴纸'
  })
  void reloadLayers()
})

onUnmounted(() => {
  revokeLoadedLayerImages(session.loadedImages.value)
})
</script>

<template>
  <div class="projection-workflow-v2">
    <Stage1920>
      <ExplodeScreenV2
        v-if="session.screen.value === 'explode'"
        :layers="session.explodeLayers.value"
        :explode="session.explodeNormalized.value"
        :explode-percent="session.explodePercent.value"
        :include-background="session.includeBackground.value"
        @update:explode-percent="session.explodePercent.value = $event"
        @enable-background="onEnableBackground"
        @disable-background="onDisableBackground"
        @next="session.screen.value = 'export'"
        @back="showCenterToast('功能正在开发中。')"
      />
      <ExportScreenV2
        v-else
        :layers="session.layoutLayers.value"
        :subject-size="session.subjectSize.value"
        :work-name="session.workName.value"
        @back="session.screen.value = 'explode'"
        @finish="showCenterToast('功能正在开发中。')"
        @confirm-export="downloadPdf"
      />
    </Stage1920>
  </div>
</template>

<style scoped>
.projection-workflow-v2 {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
