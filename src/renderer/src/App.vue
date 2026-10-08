<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getAppView,
  getProjectionLaunch,
  isMainAppView,
  openEditorCanvas,
  openLibrary,
  openProjection,
  openPlaza,
  openStatus,
  subscribeAppNav,
  type AppView,
  type MainAppView
} from './app-nav'
import AppShell from './components/shell/AppShell.vue'
import SplashPage from './pages/SplashPage.vue'
import LoginPage from './pages/LoginPage.vue'
import LobbyPage from './pages/LobbyPage.vue'
import LibraryPage from './pages/LibraryPage.vue'
import EditorPage from './pages/EditorPage.vue'
import ProjectionPage from './pages/ProjectionPage.vue'
import StatusPage from './pages/StatusPage.vue'
import PlazaPage from './pages/PlazaPage.vue'
import PersonalCenterPage from './pages/PersonalCenterPage.vue'
import RewardCenterPage from './pages/RewardCenterPage.vue'
import CenterToastOverlay from './components/shell/CenterToastOverlay.vue'

const view = ref<AppView>(getAppView())
const editorRef = ref<{ requestBack: () => void } | null>(null)
const mainView = computed<MainAppView | null>(() => (isMainAppView(view.value) ? view.value : null))
const projectionPageKey = computed(() => {
  if (view.value !== 'projection') return 'projection-idle'
  return getProjectionLaunch()?.scene.sceneId ?? 'projection-empty'
})

function syncView(): void {
  view.value = getAppView()
}

let unsubscribe = subscribeAppNav(syncView)

function handleNavigate(target: MainAppView): void {
  if (!mainView.value || target === mainView.value) return

  if (mainView.value === 'editor' && target === 'library') {
    editorRef.value?.requestBack()
    return
  }

  if (target === 'library') openLibrary()
  else if (target === 'editor') openEditorCanvas()
  else openProjection()
}

function syncHashFromView(next: AppView): void {
  const hash = next === 'status' ? '#status' : ''
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
  }
}

function applyHashRoute(): void {
  if (window.location.hash === '#status') {
    openStatus()
  }
}

function onHashChange(): void {
  applyHashRoute()
}

onMounted(() => {
  applyHashRoute()
  syncView()
  syncHashFromView(view.value)
  window.addEventListener('hashchange', onHashChange)
})

watch(view, (next) => {
  syncHashFromView(next)
})

onUnmounted(() => {
  unsubscribe()
  window.removeEventListener('hashchange', onHashChange)
})
</script>

<template>
  <CenterToastOverlay />
  <SplashPage v-if="view === 'splash'" />
  <LoginPage v-else-if="view === 'login'" />
  <LobbyPage v-else-if="view === 'lobby'" />
  <PlazaPage v-else-if="view === 'plaza'" />
  <PersonalCenterPage v-else-if="view === 'profile'" />
  <RewardCenterPage v-else-if="view === 'rewards'" />
  <div v-else-if="view === 'status'" class="status-shell">
    <header class="status-shell__bar">
      <button type="button" class="ghost" @click="openPlaza">返回分享广场</button>
    </header>
    <StatusPage />
  </div>
  <AppShell v-else-if="mainView" :active-view="mainView" @navigate="handleNavigate" @back-to-plaza="openPlaza">
    <LibraryPage v-if="mainView === 'library'" />
    <EditorPage v-if="mainView === 'editor'" ref="editorRef" />
    <ProjectionPage v-if="mainView === 'projection'" :key="projectionPageKey" />
  </AppShell>
</template>

<style>
@import './styles/text-box.css';
@import './styles/hand-drawn-ui.css';

:root {
  color-scheme: light;
  --ink: #594738;
  --muted: #8b7355;
  --paper: #f5ecd8;
  --panel: #f5ecd8;
  --line: #d4a843;
  --accent: #e8a572;
  --danger: #9b2c2c;
  font-family: "ZCOOL KuaiLe", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--ink);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  overflow: hidden;
}

button {
  appearance: none;
  font: inherit;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  /* see hand-drawn-ui.css */
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

button.ghost {
  /* see hand-drawn-ui.css */
}

.status-shell {
  min-height: 100vh;
  padding: 20px 24px 32px;
  overflow: auto;
  background: var(--paper);
}

.status-shell__bar {
  margin-bottom: 16px;
}
</style>
