<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getAppView, getEditorLaunch, getStoryCardContext, openEditor, openCreate, openLibrary, openStatus, openFabrication, returnFromSavedWork, subscribeAppNav, type AppView, type MainAppView } from './app-nav'
import { prepareNewWorkScene } from './catalog/library-new-work'
import { listCatalogThemes } from './catalog/ywn-catalog'
import AppShell from './components/shell/AppShell.vue'
import FabricationPage from './pages/FabricationPage.vue'
import LibraryPage from './pages/LibraryPage.vue'
import EditorPage from './pages/EditorPage.vue'
import StatusPage from './pages/StatusPage.vue'
import CreateAssetPage from './pages/CreateAssetPage.vue'
import StoryCardPage from './pages/StoryCardPage.vue'
import WorkDisplayPage from './pages/WorkDisplayPage.vue'
import FabricationTaskTray from './components/projection/FabricationTaskTray.vue'
import LearningZonePage from './pages/LearningZonePage.vue'
import { openLearning } from './app-nav'
import './styles/hand-drawn-ui.css'
import './styles/text-box.css'
import SplashPage from './pages/SplashPage.vue'
import LoginPage from './pages/LoginPage.vue'
import LobbyPage from './pages/LobbyPage.vue'
import PersonalCenterPage from './pages/PersonalCenterPage.vue'
import PlazaPage from './pages/PlazaPage.vue'
import RewardCenterPage from './pages/RewardCenterPage.vue'
import CenterToastOverlay from './components/shell/CenterToastOverlay.vue'
import WorkspaceSyncStatus from './components/shell/WorkspaceSyncStatus.vue'
import { openLobby } from './app-nav'
const view = ref<AppView>(getAppView())
const navigationError = ref('')
const chooseDisplayWork = ref(false)
const unsubscribe = subscribeAppNav(() => { view.value = getAppView(); chooseDisplayWork.value = false })
onMounted(() => { view.value = getAppView() })
onUnmounted(unsubscribe)
function navigate(target: MainAppView): void {
  if (target === 'projection') { openLibrary(); chooseDisplayWork.value = true; return }
  if (target === 'library') { openLibrary(); return }
  const launch = getEditorLaunch()
  if (launch) { openEditor(launch); return }
  const prepared = prepareNewWorkScene('我的新作品', listCatalogThemes()[0] || 'all')
  if (prepared.scene) openEditor({ mode: 'new', scene: prepared.scene })
  else openLibrary()
}
async function returnFromStory(): Promise<void> {
  try { await returnFromSavedWork() }
  catch (error) { navigationError.value = error instanceof Error ? error.message : String(error) }
}
</script>
<template>
  <CenterToastOverlay />
  <WorkspaceSyncStatus v-if="['lobby','profile','library'].includes(view)" />
  <FabricationTaskTray v-if="!['splash', 'login'].includes(view) && !(view === 'editor' && getEditorLaunch()?.guidedTheme)" />
  <SplashPage v-if="view === 'splash'" />
  <LoginPage v-else-if="view === 'login'" />
  <LobbyPage v-else-if="view === 'lobby'" />
  <PersonalCenterPage v-else-if="view === 'profile'" />
  <PlazaPage v-else-if="view === 'plaza'" />
  <RewardCenterPage v-else-if="view === 'rewards'" />
  <EditorPage v-else-if="view === 'editor'" />
  <LearningZonePage v-else-if="view === 'learning'" />
  <StoryCardPage v-else-if="view === 'story-card'" :work-context="getStoryCardContext()" @back="returnFromStory" />
  <WorkDisplayPage v-else-if="view === 'work-display'" />
  <AppShell v-else :active-view="chooseDisplayWork ? 'projection' : 'library'"
    @navigate="navigate" @back-to-plaza="openLobby">
    <div class="integration-content">
      <nav class="utility-nav"><button @click="openLearning()">学习区</button><button @click="openLibrary">作品与素材</button><button @click="openCreate">生成作品</button><button @click="openFabrication()">拆分工具</button><button @click="openStatus">运行状态</button></nav>
      <LibraryPage v-if="view === 'library'" :display-picker="chooseDisplayWork" />
      <CreateAssetPage v-else-if="view === 'create'" />
      <FabricationPage v-else-if="view === 'fabrication'" />
      <StatusPage v-else />
    </div>
  </AppShell>
  <div v-if="navigationError" role="alert" class="navigation-error">{{ navigationError }} <button @click="navigationError = ''; openLibrary()">返回作品列表</button></div>
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
.navigation-error { position: fixed; bottom: 15px; left: 15px; z-index: 2000; padding: 15px; background: #fff3e6; border: 2px solid #9b3f32; }
</style>
