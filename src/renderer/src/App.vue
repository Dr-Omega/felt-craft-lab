<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getAppView, getEditorLaunch, getRewardEntry, getStoryCardContext, openLibrary, returnFromSavedWork, subscribeAppNav, type AppView } from './app-nav'
import FabricationPage from './pages/FabricationPage.vue'
import EditorPage from './pages/EditorPage.vue'
import StatusPage from './pages/StatusPage.vue'
import StoryCardPage from './pages/StoryCardPage.vue'
import WorkDisplayPage from './pages/WorkDisplayPage.vue'
import FabricationTaskTray from './components/projection/FabricationTaskTray.vue'
import LearningZonePage from './pages/LearningZonePage.vue'
import './styles/hand-drawn-ui.css'
import './styles/text-box.css'
import SplashPage from './pages/SplashPage.vue'
import LoginPage from './pages/LoginPage.vue'
import LobbyPage from './pages/LobbyPage.vue'
import PersonalCenterPage from './pages/PersonalCenterPage.vue'
import PlazaPage from './pages/PlazaPage.vue'
import RewardCenterPage from './pages/RewardCenterPage.vue'
import BearHomePage from './pages/BearHomePage.vue'
import CenterToastOverlay from './components/shell/CenterToastOverlay.vue'
import OnboardingOverlay from './components/onboarding/OnboardingOverlay.vue'
import WorkspaceSyncStatus from './components/shell/WorkspaceSyncStatus.vue'
import { openLobby } from './app-nav'
const view = ref<AppView>(getAppView())
const navigationError = ref('')
const unsubscribe = subscribeAppNav(() => { view.value = getAppView() })
onMounted(() => { view.value = getAppView() })
onUnmounted(unsubscribe)
async function returnFromStory(): Promise<void> {
  try { await returnFromSavedWork() }
  catch (error) { navigationError.value = error instanceof Error ? error.message : String(error) }
}
</script>
<template>
  <CenterToastOverlay />
  <OnboardingOverlay />
  <WorkspaceSyncStatus v-if="['lobby','profile','library'].includes(view)" background-only />
  <FabricationTaskTray v-if="['editor','fabrication'].includes(view) && !getEditorLaunch()?.guidedTheme" :scene-id="view === 'editor' ? getEditorLaunch()?.scene.sceneId : undefined" />
  <SplashPage v-if="view === 'splash'" />
  <LoginPage v-else-if="view === 'login'" />
  <LobbyPage v-else-if="view === 'lobby'" />
  <PersonalCenterPage v-else-if="view === 'profile'" />
  <PlazaPage v-else-if="view === 'plaza'" />
  <BearHomePage v-else-if="view === 'rewards' && getRewardEntry() === 'bear'" />
  <RewardCenterPage v-else-if="view === 'rewards'" :initial-tab="getRewardEntry()" />
  <EditorPage v-else-if="view === 'editor'" />
  <LearningZonePage v-else-if="view === 'learning'" />
  <StoryCardPage v-else-if="view === 'story-card'" :work-context="getStoryCardContext()" @back="returnFromStory" />
  <WorkDisplayPage v-else-if="view === 'work-display'" />
  <!-- Diagnostic pages remain callable for maintenance, never in child navigation. -->
  <section v-else-if="view === 'fabrication' || view === 'status'" class="maintenance-content" aria-label="维护工具">
    <button @click="openLobby">返回大厅</button>
    <FabricationPage v-if="view === 'fabrication'" />
    <StatusPage v-else />
  </section>
  <PersonalCenterPage v-else />
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
.maintenance-content { height: 100%; overflow: auto; padding: 20px; }
:focus-visible { outline: 3px solid #7d261a; outline-offset: 3px; }
.navigation-error { position: fixed; bottom: 15px; left: 15px; z-index: 2000; padding: 15px; background: #fff3e6; border: 2px solid #9b3f32; }
</style>
