<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  getAppView,
  isMainAppView,
  openEditorCanvas,
  openLibrary,
  openProjection,
  subscribeAppNav,
  type AppView,
  type MainAppView
} from './app-nav'
import AppShell from './components/shell/AppShell.vue'
import SplashPage from './pages/SplashPage.vue'
import LoginPage from './pages/LoginPage.vue'
import LibraryPage from './pages/LibraryPage.vue'
import EditorPage from './pages/EditorPage.vue'
import ProjectionPage from './pages/ProjectionPage.vue'

const view = ref<AppView>(getAppView())
const editorRef = ref<{ requestBack: () => void } | null>(null)
const mainView = computed<MainAppView | null>(() => (isMainAppView(view.value) ? view.value : null))

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

onMounted(() => {
  syncView()
})

onUnmounted(() => {
  unsubscribe()
})
</script>

<template>
  <SplashPage v-if="view === 'splash'" />
  <LoginPage v-else-if="view === 'login'" />
  <AppShell v-else-if="mainView" :active-view="mainView" @navigate="handleNavigate">
    <LibraryPage v-if="mainView === 'library'" />
    <EditorPage v-if="mainView === 'editor'" ref="editorRef" />
    <ProjectionPage v-if="mainView === 'projection'" />
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
</style>
