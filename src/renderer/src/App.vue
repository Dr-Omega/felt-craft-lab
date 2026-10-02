<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getAppView, getEditorLaunch, openEditor, openCreate, openLibrary, openStatus, openFabrication, subscribeAppNav, type AppView, type MainAppView } from './app-nav'
import { prepareNewWorkScene } from './catalog/library-new-work'
import { listCatalogThemes } from './catalog/ywn-catalog'
import AppShell from './components/shell/AppShell.vue'
import FabricationPage from './pages/FabricationPage.vue'
import LibraryPage from './pages/LibraryPage.vue'
import EditorPage from './pages/EditorPage.vue'
import StatusPage from './pages/StatusPage.vue'
import CreateAssetPage from './pages/CreateAssetPage.vue'
import './styles/hand-drawn-ui.css'
const view = ref<AppView>(getAppView())
const unsubscribe = subscribeAppNav(() => { view.value = getAppView() })
onMounted(() => { view.value = getAppView() })
onUnmounted(unsubscribe)
function navigate(target: MainAppView): void {
  if (target === 'projection') { openFabrication(); return }
  if (target === 'library') { openLibrary(); return }
  const launch = getEditorLaunch()
  if (launch) { openEditor(launch); return }
  const prepared = prepareNewWorkScene('我的新作品', listCatalogThemes()[0] || 'all')
  if (prepared.scene) openEditor({ mode: 'new', scene: prepared.scene })
  else openLibrary()
}
</script>
<template>
  <EditorPage v-if="view === 'editor'" />
  <AppShell v-else :active-view="view === 'fabrication' ? 'projection' : 'library'"
    @navigate="navigate" @back-to-plaza="openLibrary">
    <div class="integration-content">
      <nav class="utility-nav"><button @click="openLibrary">作品与素材</button><button @click="openCreate">生成作品</button><button @click="openStatus">运行状态</button></nav>
      <LibraryPage v-if="view === 'library'" />
      <CreateAssetPage v-else-if="view === 'create'" />
      <FabricationPage v-else-if="view === 'fabrication'" />
      <StatusPage v-else />
    </div>
  </AppShell>
</template>
<style>
:root { color-scheme: light; --ink: #594738; --muted: #8b7355; --paper: #f8f0e2; --panel: #fffef8; --line: #d9b98a; --accent: #855637; --danger: #9b3f32; color: var(--ink); font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { overflow: hidden; }
button { appearance: none; border: 1px solid var(--line); background: var(--panel); color: var(--ink); padding: 8px 12px; font: inherit; cursor: pointer; border-radius: 10px; }
button:disabled { opacity: .5; cursor: not-allowed; }
button.primary { background: #f5e5a4; color: #7d261a; border: 2px solid #7d261a; }
button.linkish, button.ghost { background: transparent; }
button.active { border-color: var(--accent); }
.integration-content { position: absolute; z-index: 30; inset: 16% 19% 8% 8%; overflow: auto; background: #fffef8; border: 4px solid #8b5a32; border-radius: 20px; padding: 14px; display: flex; flex-direction: column; }
.utility-nav { display: flex; gap: 10px; margin-bottom: 8px; }
:focus-visible { outline: 3px solid #7d261a; outline-offset: 3px; }
</style>
