<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const defaultLearningZoneUrl = window.location.protocol === 'http:'
  ? `${window.location.origin}/learning-zone/`
  : 'http://127.0.0.1:3000/'
const configuredLearningZoneUrl = import.meta.env.VITE_LEARNING_ZONE_URL || defaultLearningZoneUrl
const learningZoneUrl = new URL(configuredLearningZoneUrl, window.location.href).toString()

const learningZoneFrame = ref<HTMLIFrameElement | null>(null)
const embeddedPageHeight = ref<number | null>(null)
let embeddedPageObserver: ResizeObserver | undefined
let embeddedDocument: Document | undefined

function forwardEmbeddedWheel(event: WheelEvent): void {
  const tray = (event.target as Element | null)?.closest?.('.sticker-tray') as HTMLElement | null
  if (tray) {
    const canScrollUp = tray.scrollTop > 1
    const canScrollDown = tray.scrollTop + tray.clientHeight < tray.scrollHeight - 1
    if ((event.deltaY < 0 && canScrollUp) || (event.deltaY > 0 && canScrollDown)) return
  }

  const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 20
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? window.innerHeight
      : 1
  window.scrollBy({ top: event.deltaY * multiplier, behavior: 'auto' })
}

function disconnectEmbeddedPage(): void {
  embeddedPageObserver?.disconnect()
  embeddedPageObserver = undefined
  embeddedDocument?.removeEventListener('wheel', forwardEmbeddedWheel)
  embeddedDocument = undefined
}

function measureEmbeddedPage(): void {
  const document = learningZoneFrame.value?.contentDocument
  if (!document) return

  const height = Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0
  )
  if (height > 0) embeddedPageHeight.value = height
}

function fitFrameToEmbeddedPage(): void {
  disconnectEmbeddedPage()
  embeddedPageHeight.value = null

  try {
    const document = learningZoneFrame.value?.contentDocument
    if (!document) return

    measureEmbeddedPage()
    embeddedDocument = document
    embeddedDocument.addEventListener('wheel', forwardEmbeddedWheel, { passive: true })
    embeddedPageObserver = new ResizeObserver(measureEmbeddedPage)
    embeddedPageObserver.observe(document.documentElement)
    if (document.body) embeddedPageObserver.observe(document.body)
  } catch {
    // Configured cross-origin pages keep the fixed-height, internally scrollable fallback.
  }
}

onBeforeUnmount(disconnectEmbeddedPage)
</script>

<template>
  <section class="learning-zone-page" aria-label="学习区测试">
    <header class="learning-zone-head">
      <div>
        <h2>学习区测试</h2>
        <p>在这里体验贴纸学习互动。</p>
      </div>
    </header>

    <div class="learning-zone-frame-wrap">
      <iframe
        ref="learningZoneFrame"
        class="learning-zone-frame"
        :src="learningZoneUrl"
        :style="embeddedPageHeight ? { height: `${embeddedPageHeight}px` } : undefined"
        title="学习区贴纸互动"
        loading="eager"
        allow="autoplay"
        @load="fitFrameToEmbeddedPage"
      />
    </div>
  </section>
</template>

<style scoped>
.learning-zone-page {
  display: grid;
  gap: 16px;
}

.learning-zone-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.learning-zone-head h2 {
  margin: 0 0 6px;
  font-size: 1.35rem;
}

.learning-zone-head p {
  margin: 0;
  color: var(--muted);
}

.learning-zone-frame-wrap {
  min-height: min(760px, calc(100vh - 220px));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
}

.learning-zone-frame {
  display: block;
  width: 100%;
  min-height: min(760px, calc(100vh - 220px));
  height: 760px;
  border: 0;
  background: #fff;
}

@media (max-width: 720px) {
  .learning-zone-head {
    flex-direction: column;
  }

  .learning-zone-frame-wrap {
    min-height: calc(100vh - 250px);
  }

  .learning-zone-frame {
    min-height: calc(100vh - 250px);
    height: calc(100vh - 250px);
  }
}
</style>
