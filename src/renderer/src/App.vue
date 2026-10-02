<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { APP_DISPLAY_NAME } from '@shared/constants/app'
import {
  getAppView,
  getStoryCardContext,
  openLibrary,
  openStoryCard,
  openStatus,
  subscribeAppNav,
  type AppView
} from './app-nav'
import LibraryPage from './pages/LibraryPage.vue'
import EditorPage from './pages/EditorPage.vue'
import StatusPage from './pages/StatusPage.vue'
import StoryCardPage from './pages/StoryCardPage.vue'
import { getFeltCraftDatabase, ProjectStore } from './persistence'
import { CATALOG_ASSETS, resolveEditorCatalogForSnapshot } from './catalog/ywn-catalog'
import { adaptStoryCardWorkContext } from './story-card/work-context.adapter'
import { createFreshAcceptanceWorkContext } from './story-card/acceptance-work-context'

const storyCardAcceptance = import.meta.env.DEV && import.meta.env.VITE_STORY_CARD_ACCEPTANCE === '1'
const view = ref<AppView>(storyCardAcceptance ? 'story-card' : getAppView())
const storyCardContext = ref(getStoryCardContext())

async function openStoryCardForAcceptance(): Promise<void> {
  const projects = await new ProjectStore(getFeltCraftDatabase()).list()
  const project = projects.find((item) => item.completionStatus === 'completed' && item.scene.subject)
    ?? projects.find((item) => item.completionStatus === 'completed'
      && item.scene.objects.some((object) => CATALOG_ASSETS.some((asset) => asset.assetId === object.assetId)))
  if (!project) {
    const previewAsset = CATALOG_ASSETS.find((asset) => asset.type === 'sticker')
    if (!previewAsset) return
    openStoryCard(createFreshAcceptanceWorkContext({
      workId: '00000000-0000-4000-8000-000000000001',
      completionStatus: 'completed',
      artworkImageRef: previewAsset.imageUrl,
      background: null,
      subject: { name: previewAsset.nameZh },
      stickers: []
    }))
    return
  }

  try {
    openStoryCard(createFreshAcceptanceWorkContext(adaptStoryCardWorkContext(project, {
      listBySnapshot: (snapshotId) => resolveEditorCatalogForSnapshot(snapshotId).assets
    })))
  } catch {
    const snapshotAssets = resolveEditorCatalogForSnapshot(project.scene.assetSnapshotId).assets
    const assets = snapshotAssets.length ? snapshotAssets : CATALOG_ASSETS
    const byId = new Map(assets.map((asset) => [asset.assetId, asset]))
    const subject = project.scene.subject?.name ?? byId.get(project.scene.objects[0]?.assetId)?.nameZh
    if (!subject) return
    openStoryCard(createFreshAcceptanceWorkContext({
      workId: project.projectId,
      completionStatus: 'completed',
      artworkImageRef: project.previewUrl,
      background: project.scene.backgroundAssetId
        ? { name: byId.get(project.scene.backgroundAssetId)?.nameZh ?? '作品背景' }
        : null,
      subject: { name: subject },
      stickers: project.scene.subject
        ? project.scene.objects.map((object) => ({ name: byId.get(object.assetId)?.nameZh ?? '作品素材' }))
        : project.scene.objects.slice(1).map((object) => ({ name: byId.get(object.assetId)?.nameZh ?? '作品素材' }))
    }))
  }
}

function syncView(): void {
  view.value = getAppView()
  storyCardContext.value = getStoryCardContext()
}

let unsubscribe = subscribeAppNav(syncView)

onMounted(() => {
  if (storyCardAcceptance) void openStoryCardForAcceptance()
  else syncView()
})

onUnmounted(() => {
  unsubscribe()
})
</script>

<template>
  <div class="shell" :class="{ 'story-mode': view === 'story-card' }">
    <header v-if="view !== 'story-card'" class="topbar">
      <div>
        <p class="eyebrow">Material Library · UI Workflows</p>
        <h1>{{ APP_DISPLAY_NAME }}</h1>
      </div>
      <nav class="nav">
        <button type="button" :class="{ active: view === 'library' }" @click="openLibrary">素材库</button>
        <button type="button" :class="{ active: view === 'status' }" @click="openStatus">运行状态</button>
      </nav>
    </header>

    <main class="content">
      <LibraryPage v-if="view === 'library'" />
      <EditorPage v-else-if="view === 'editor'" />
      <StoryCardPage v-else-if="view === 'story-card'" :work-context="storyCardContext" />
      <StatusPage v-else />
    </main>
  </div>
</template>

<style>
:root {
  color-scheme: light;
  --ink: #16302b;
  --muted: #4d6460;
  --paper: #eef4f2;
  --panel: #ffffff;
  --line: #c5d5d0;
  --accent: #1f6f63;
  --danger: #9b2c2c;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background:
    radial-gradient(circle at 12% 8%, rgba(31, 111, 99, 0.16), transparent 42%),
    linear-gradient(165deg, #e7f2ef 0%, var(--paper) 48%, #f7faf9 100%);
  color: var(--ink);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

button {
  appearance: none;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 8px 12px;
  font: inherit;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

button.ghost,
button.linkish {
  background: transparent;
}

button.linkish {
  border: 0;
  padding: 0;
  color: var(--accent);
  text-align: left;
}

button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 20px 48px;
}

.shell.story-mode {
  max-width: none;
  padding: 0;
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 24px;
}

.topbar h1 {
  margin: 4px 0 0;
  font-size: clamp(1.6rem, 3vw, 2.2rem);
}

.eyebrow {
  margin: 0;
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 0.75rem;
}

.nav {
  display: flex;
  gap: 8px;
}

.content {
  min-height: 60vh;
}

@media (max-width: 720px) {
  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
