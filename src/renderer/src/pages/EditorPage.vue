<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import {
  EditorSessionService,
  FabricEditorAdapter,
  type EditorSelectionEvent,
  type EditorSelectionProjection,
  type EditorSessionState
} from '../editor'
import {
  createCatalogResolver,
  DEFAULT_USER_ID,
  isAssetUnlocked,
  resolveEditorCatalogForSnapshot,
  YWN_SNAPSHOT_CONTEXT
} from '../catalog/ywn-catalog'
import { assetsForEditor, pickSelectedAsset } from '../catalog/editor-selection'
import { getEditorLaunch, openLibrary } from '../app-nav'
import {
  AssetAccessStore,
  ProjectStore,
  getFeltCraftDatabase,
  saveDraftFromPreparedScene,
  saveNewProject,
  updateExistingProject
} from '../persistence'
import EditorTopbar from '../components/editor/EditorTopbar.vue'
import BottomActionDock from '../components/editor/BottomActionDock.vue'
import BackgroundDrawer from '../components/editor/BackgroundDrawer.vue'
import MaterialSheet from '../components/editor/MaterialSheet.vue'
import ReturnSaveModal from '../components/editor/ReturnSaveModal.vue'
import ObjectQuickTools from '../components/editor/ObjectQuickTools.vue'
import RemoveToast from '../components/editor/RemoveToast.vue'

const launch = getEditorLaunch()
if (!launch) openLibrary()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const logicalCanvasWidth = launch?.scene.canvas.width ?? 960
const logicalCanvasHeight = launch?.scene.canvas.height ?? 960
const session = shallowRef<EditorSessionService | null>(null)
const sessionState = ref<EditorSessionState | null>(null)
const accessByAssetId = ref<Record<string, AssetAccessState | undefined>>({})
const busy = ref(false)
const feedback = ref('')
const feedbackKind = ref<'success' | 'error' | 'info'>('info')
const returnModalOpen = ref(false)
const returnModalError = ref('')
const sheetOpen = ref(false)
const backgroundDrawerOpen = ref(false)
const sceneSnapshotMissing = ref(false)
const currentSelection = ref<EditorSelectionProjection | null>(null)
const oqtSelection = ref<EditorSelectionProjection | null>(null)
const oqtOpen = ref(false)
const oqtPosition = ref({ left: 0, top: 0, below: false })
const oqtElement = ref<{ $el: HTMLElement } | null>(null)
const removeToastOpen = ref(false)

let unsubscribe: (() => void) | undefined
let selectionUnsubscribe: (() => void) | undefined
let removeToastTimer: number | undefined
let draftId = launch?.draftId
let projectId = launch?.projectId

const editorCatalog = launch
  ? resolveEditorCatalogForSnapshot(launch.scene.assetSnapshotId)
  : { assets: [] as readonly AssetRecord[], snapshotMissing: false }
const sceneCatalogAssets = editorCatalog.assets
const sceneThemeId = launch?.scene.themeId
const stickers = computed(() => assetsForEditor(sceneCatalogAssets, 'sticker', sceneThemeId))
const backgrounds = computed(() => assetsForEditor(sceneCatalogAssets, 'background', sceneThemeId))
const selectedStickerId = ref('')
const selectedBackgroundId = ref(launch?.scene.backgroundAssetId ?? '')

const canEdit = computed(() => Boolean(sessionState.value?.canEdit))
const canFinish = computed(() => Boolean(sessionState.value?.canPrepareProject))

function normalizeSelections(): void {
  if (
    selectedStickerId.value
    && !stickers.value.some((asset) => asset.assetId === selectedStickerId.value)
  ) {
    selectedStickerId.value = ''
  }
  if (selectedBackgroundId.value && !backgrounds.value.some((asset) => asset.assetId === selectedBackgroundId.value)) {
    selectedBackgroundId.value = ''
  }
}

normalizeSelections()

function selectedSticker(): AssetRecord | undefined {
  return pickSelectedAsset(selectedStickerId.value, stickers.value)
}

function selectedBackground(): AssetRecord | null {
  return backgrounds.value.find((asset) => asset.assetId === selectedBackgroundId.value) ?? null
}

function accessFor(assetId: string): AssetAccessState | undefined {
  return accessByAssetId.value[assetId]
}

function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/snapshot|registry|assetSnapshot|ASSET_SNAPSHOT/i.test(text)) return '有些以前用过的素材暂时找不到啦，这件作品先不能继续保存。'
  if (/locked|unlock|解锁/i.test(text)) return '这个素材还没有解锁，先看看别的吧。'
  if (/save|draft|project|preview|PROJECT_SAVE|DRAFT_SAVE/i.test(text)) return '这次还没有收好作品，请稍后再试。'
  return text && text.length < 120 ? text : '刚刚遇到一点小问题，请稍后再试。'
}

function showFeedback(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  feedback.value = message
  feedbackKind.value = kind
  window.setTimeout(() => {
    if (feedback.value === message) feedback.value = ''
  }, kind === 'success' ? 2800 : 4200)
}

function hideRemoveToast(): void {
  removeToastOpen.value = false
  if (removeToastTimer !== undefined) {
    window.clearTimeout(removeToastTimer)
    removeToastTimer = undefined
  }
}

function showRemoveToast(): void {
  hideRemoveToast()
  removeToastOpen.value = true
  removeToastTimer = window.setTimeout(() => {
    removeToastOpen.value = false
    removeToastTimer = undefined
  }, 2800)
}

function closeOqt(): void {
  oqtOpen.value = false
  oqtSelection.value = null
}

function updateOqtPosition(): void {
  const canvas = canvasEl.value
  const selection = oqtSelection.value
  const element = oqtElement.value?.$el ?? null
  if (!canvas || !selection || !oqtOpen.value || !element) return

  const canvasRect = canvas.getBoundingClientRect()
  // Fabric's canvas.width/height become retina-scaled backing dimensions
  // (1440x1440 at DPR 1.5). Projection coordinates are SceneDocument logical
  // units, so use the stable logical canvas dimensions instead of backing size.
  const logicalWidth = logicalCanvasWidth || 1
  const logicalHeight = logicalCanvasHeight || 1
  const scaleX = canvasRect.width / logicalWidth
  const scaleY = canvasRect.height / logicalHeight
  const screenLeft = canvasRect.left + selection.bounds.left * scaleX
  const screenTop = canvasRect.top + selection.bounds.top * scaleY
  const screenWidth = selection.bounds.width * scaleX
  const screenHeight = selection.bounds.height * scaleY
  const quickToolsRect = element.getBoundingClientRect()
  const clearance = 52
  const gap = 12
  const horizontalPadding = 16
  let left = screenLeft + screenWidth / 2 - quickToolsRect.width / 2
  let top = screenTop - quickToolsRect.height - clearance - gap
  let below = false
  if (top < horizontalPadding) {
    top = screenTop + screenHeight + clearance + gap
    below = true
  }
  left = Math.max(horizontalPadding, Math.min(left, window.innerWidth - quickToolsRect.width - horizontalPadding))
  top = Math.max(horizontalPadding, Math.min(top, window.innerHeight - quickToolsRect.height - horizontalPadding))
  oqtPosition.value = { left, top, below }
}

function handleSelectionEvent(event: EditorSelectionEvent): void {
  if (event.type === 'cleared') {
    currentSelection.value = null
    closeOqt()
    return
  }

  currentSelection.value = event.selection
  if (event.type === 'selected') {
    if (oqtSelection.value && oqtSelection.value.objectId !== event.selection.objectId) closeOqt()
    return
  }
  if (event.type === 'geometry') {
    hideRemoveToast()
    if (oqtOpen.value && oqtSelection.value?.objectId === event.selection.objectId) {
      oqtSelection.value = event.selection
      void nextTick(updateOqtPosition)
    }
    return
  }

  closeMaterialSheet()
  backgroundDrawerOpen.value = false
  oqtSelection.value = event.selection
  oqtOpen.value = true
  void nextTick(updateOqtPosition)
}

async function refreshAccess(): Promise<void> {
  const store = new AssetAccessStore(getFeltCraftDatabase())
  const rows = await store.listForUser(DEFAULT_USER_ID)
  const next: Record<string, AssetAccessState | undefined> = {}
  for (const row of rows) next[row.assetId] = row
  accessByAssetId.value = next
}

async function boot(): Promise<void> {
  if (!launch || !canvasEl.value) return
  sceneSnapshotMissing.value = editorCatalog.snapshotMissing
  await refreshAccess()
  const service = new EditorSessionService({
    createAdapter: () => new FabricEditorAdapter({ allowTestAssets: false, snapshotContext: YWN_SNAPSHOT_CONTEXT })
  })
  session.value = service
  unsubscribe = service.subscribe((state) => {
    sessionState.value = state
    if (state.status === 'recovery' || editorCatalog.snapshotMissing) {
      showFeedback('有些以前用过的素材暂时找不到啦，这件作品先不能继续保存。', 'error')
    }
  })
  try {
    await service.open(canvasEl.value, launch.scene, createCatalogResolver())
    selectionUnsubscribe = service.subscribeSelection(handleSelectionEvent)
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

async function requireUnlocked(asset: AssetRecord): Promise<AssetAccessState> {
  const access = accessFor(asset.assetId)
  if (!isAssetUnlocked(access)) throw new Error('这个素材还没有解锁，先看看别的吧。')
  return access!
}

function closeMaterialSheet(): void {
  sheetOpen.value = false
  selectedStickerId.value = ''
}

function openMaterialSheet(): void {
  selectedStickerId.value = ''
  backgroundDrawerOpen.value = false
  closeOqt()
  sheetOpen.value = true
}

function closeTransientContexts(): void {
  closeMaterialSheet()
  backgroundDrawerOpen.value = false
  closeOqt()
}

function toggleSheet(): void {
  if (sheetOpen.value) closeMaterialSheet()
  else openMaterialSheet()
}

function toggleBackgroundDrawer(): void {
  backgroundDrawerOpen.value = !backgroundDrawerOpen.value
  if (backgroundDrawerOpen.value) {
    closeMaterialSheet()
    closeOqt()
  }
}

function selectSticker(assetId: string): void {
  selectedStickerId.value = assetId
}

async function addSticker(asset: AssetRecord): Promise<void> {
  if (!session.value) return
  hideRemoveToast()
  busy.value = true
  try {
    const access = await requireUnlocked(asset)
    await session.value.addSticker(asset, access)
    closeTransientContexts()
    showFeedback('放进作品啦', 'success')
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  } finally {
    busy.value = false
  }
}

async function applyBackground(asset: AssetRecord | null): Promise<void> {
  if (!session.value) return
  hideRemoveToast()
  busy.value = true
  try {
    if (asset) await session.value.setBackground(asset, await requireUnlocked(asset))
    else await session.value.setBackground(null)
    selectedBackgroundId.value = asset?.assetId ?? ''
    backgroundDrawerOpen.value = false
    showFeedback(asset ? '背景换好啦' : '换成空白纸啦', 'success')
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  } finally {
    busy.value = false
  }
}

async function undo(): Promise<void> {
  if (!session.value) return
  hideRemoveToast()
  try { await session.value.undo() } catch (error) { showFeedback(friendlyError(error), 'error') }
}

async function redo(): Promise<void> {
  if (!session.value) return
  hideRemoveToast()
  try { await session.value.redo() } catch (error) { showFeedback(friendlyError(error), 'error') }
}

async function finish(): Promise<void> {
  if (!session.value) return
  closeOqt()
  busy.value = true
  try {
    const prepared = await session.value.prepareProjectSave()
    if (projectId) {
      const existing = await new ProjectStore(getFeltCraftDatabase()).get(projectId)
      if (!existing) throw new Error('这件作品暂时找不到啦。')
      await updateExistingProject(existing, prepared)
    } else {
      const saved = await saveNewProject(prepared)
      projectId = saved.projectId
    }
    showFeedback('作品收好啦！', 'success')
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  } finally {
    busy.value = false
  }
}

async function quickBringForward(): Promise<void> {
  const selection = oqtSelection.value
  if (!selection || !session.value) return
  hideRemoveToast()
  try {
    session.value.bringForward(selection.objectId)
    void nextTick(updateOqtPosition)
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

async function quickSendBackward(): Promise<void> {
  const selection = oqtSelection.value
  if (!selection || !session.value) return
  hideRemoveToast()
  try {
    session.value.sendBackward(selection.objectId)
    void nextTick(updateOqtPosition)
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

async function quickRemove(): Promise<void> {
  const selection = oqtSelection.value
  if (!selection || !session.value) return
  try {
    session.value.deleteObject(selection.objectId)
    closeOqt()
    showRemoveToast()
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

async function undoRemoval(): Promise<void> {
  hideRemoveToast()
  if (!session.value) return
  try {
    await session.value.undo()
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

function requestBack(): void {
  closeTransientContexts()
  returnModalError.value = ''
  returnModalOpen.value = true
}

async function saveProgressAndBack(): Promise<void> {
  if (!session.value) return
  busy.value = true
  returnModalError.value = ''
  try {
    const preparedScene = session.value.prepareDraftSave()
    const saved = await saveDraftFromPreparedScene(preparedScene, { draftId })
    draftId = saved.draftId
    returnModalOpen.value = false
    openLibrary()
  } catch (error) {
    returnModalError.value = friendlyError(error)
  } finally {
    busy.value = false
  }
}

function discardAndBack(): void {
  returnModalOpen.value = false
  openLibrary()
}

function continueEditing(): void {
  returnModalOpen.value = false
  returnModalError.value = ''
}

onMounted(async () => {
  window.addEventListener('resize', updateOqtPosition)
  try { await boot() } catch (error) { showFeedback(friendlyError(error), 'error') }
})

onUnmounted(() => {
  unsubscribe?.()
  selectionUnsubscribe?.()
  hideRemoveToast()
  window.removeEventListener('resize', updateOqtPosition)
  session.value?.dispose()
})

watch([oqtOpen, oqtSelection], () => { void nextTick(updateOqtPosition) })
</script>

<template>
  <section class="editor-stage">
    <EditorTopbar
      :work-name="launch?.scene.workName ?? '我的新作品'"
      :busy="busy"
      :can-finish="canFinish"
      @back="requestBack"
      @finish="finish"
    />

    <main class="editor-workspace">
      <div class="creation-workspace" @click.self="closeTransientContexts">
        <button
          class="background-trigger"
          type="button"
          aria-label="打开背景选择"
          :class="{ 'is-open': backgroundDrawerOpen }"
          @click.stop="toggleBackgroundDrawer"
        >
          <span class="background-trigger-pad" aria-hidden="true">▧</span>
        </button>

        <BackgroundDrawer
          :assets="backgrounds"
          :access-by-asset-id="accessByAssetId"
          :selected-asset-id="selectedBackgroundId"
          :open="backgroundDrawerOpen"
          :busy="busy"
          @select="(assetId) => (selectedBackgroundId = assetId)"
          @apply="applyBackground"
          @close="backgroundDrawerOpen = false"
        />

        <div class="canvas-frame">
          <div class="canvas-wrap">
            <canvas
              ref="canvasEl"
              class="editor-canvas"
              :width="logicalCanvasWidth"
              :height="logicalCanvasHeight"
            ></canvas>
          </div>
        </div>

        <BottomActionDock
          :busy="busy"
          :can-edit="canEdit"
          :sheet-open="sheetOpen"
          @undo="undo"
          @redo="redo"
          @toggle-sheet="toggleSheet"
        />
      </div>
    </main>

    <p v-if="sessionState?.status === 'recovery' || sceneSnapshotMissing" class="editor-state-banner">
      有些以前用过的素材暂时找不到啦，这件作品先不能继续保存或完成。
    </p>
    <p v-if="feedback" class="editor-feedback" :class="`is-${feedbackKind}`" role="status">{{ feedback }}</p>

    <MaterialSheet
      :assets="stickers"
      :access-by-asset-id="accessByAssetId"
      :selected-asset-id="selectedStickerId"
      :open="sheetOpen"
      :busy="busy"
      @select="selectSticker"
      @add="addSticker"
      @close="closeMaterialSheet"
    />

    <ObjectQuickTools
      v-if="oqtOpen"
      ref="oqtElement"
      :left="oqtPosition.left"
      :top="oqtPosition.top"
      :below="oqtPosition.below"
      @forward="quickBringForward"
      @backward="quickSendBackward"
      @remove="quickRemove"
    />

    <RemoveToast :open="removeToastOpen" @undo="undoRemoval" />

    <ReturnSaveModal
      :open="returnModalOpen"
      :busy="busy"
      :error-message="returnModalError"
      @save="saveProgressAndBack"
      @discard="discardAndBack"
      @cancel="continueEditing"
    />
  </section>
</template>

<style>
:root {
  --bg-app: #f8f0e2;
  --wood-light: #f0e2c5;
  --wood-surface: #efe2c9;
  --wood-mid: #d9b98a;
  --wood-deep: #a88b6c;
  --wood-deeper: #7e6244;
  --color-primary: #e8a572;
  --color-primary-soft: #f4c9a4;
  --color-confirm: #9caf88;
  --color-text: #594738;
  --color-text-soft: #8b7355;
  --color-text-faint: #b8a48a;
  --color-on-primary: #fff;
  --radius-xs: 14px;
  --radius-sm: 16px;
  --radius-md: 20px;
  --radius-lg: 24px;
  --radius-xl: 32px;
  --radius-pill: 999px;
  --shadow-soft: 0 2px 8px rgba(89, 71, 56, 0.08);
  --shadow-card: 0 4px 16px rgba(89, 71, 56, 0.1);
  --shadow-canvas: 0 8px 28px rgba(89, 71, 56, 0.18);
  --shadow-lift: 0 10px 24px rgba(89, 71, 56, 0.22);
}

body { margin: 0; overflow: hidden; }

.editor-stage {
  position: fixed;
  inset: 0;
  height: 100vh;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 960px;
  min-height: 640px;
  overflow: visible;
  color: var(--color-text);
  background-color: var(--wood-light);
  background-image: repeating-linear-gradient(2deg, rgba(126, 98, 68, 0.06) 0 1px, transparent 1px 9px), repeating-linear-gradient(178deg, rgba(255, 255, 255, 0.18) 0 1px, transparent 1px 18px);
  background-size: 600px 40px;
  background-repeat: repeat;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.editor-topbar {
  flex: 0 0 64px;
  height: 64px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid rgba(89, 71, 56, 0.18);
  background: rgba(240, 226, 197, 0.72);
}

.topbar-back,
.topbar-finish {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.topbar-back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  background: var(--wood-deeper);
  color: var(--color-on-primary);
  font-size: 14px;
  font-weight: 600;
}

.topbar-back span:first-child { font-size: 22px; line-height: 1; }
.topbar-title { margin: 0; font-size: 18px; font-weight: 650; text-align: center; }

.topbar-finish {
  justify-self: end;
  min-height: 42px;
  padding: 0 22px;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: 15px;
  font-weight: 700;
  box-shadow: var(--shadow-soft);
}

.topbar-finish:disabled { cursor: not-allowed; opacity: 0.48; }
.topbar-back:hover, .topbar-finish:hover:not(:disabled) { filter: brightness(1.04); }

.editor-workspace { position: relative; flex: 0 0 auto; width: 100%; height: calc(100vh - 64px); min-height: 0; padding: 16px 20px 84px; }
.creation-workspace { position: relative; width: 100%; height: 100%; min-height: 0; }

.canvas-frame {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(66vw, calc(100vh - 180px), 760px);
  height: min(66vw, calc(100vh - 180px), 760px);
  transform: translate(-50%, -50%);
  border-radius: var(--radius-xl);
  background: var(--bg-app);
  box-shadow: var(--shadow-canvas);
  overflow: visible;
}

.canvas-wrap,
.canvas-wrap .canvas-container {
  width: 100% !important;
  height: 100% !important;
  border-radius: var(--radius-xl);
  overflow: visible;
  background: var(--bg-app);
}

.canvas-wrap { position: relative; }
.editor-canvas { display: block; width: 100%; height: 100%; border-radius: var(--radius-xl); background: var(--bg-app); touch-action: none; }
.canvas-wrap .canvas-container .lower-canvas, .canvas-wrap .canvas-container .upper-canvas { width: 100% !important; height: 100% !important; border-radius: var(--radius-xl); }

.background-trigger {
  position: absolute;
  left: calc(50% - min(66vw, calc(100vh - 180px), 760px) / 2 - 90px);
  top: 50%;
  z-index: 30;
  width: 64px;
  height: 64px;
  padding: 0;
  border: 0;
  transform: translateY(-50%);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.background-trigger-pad { display: grid; place-items: center; width: 48px; height: 48px; margin: 8px; border-radius: var(--radius-xs); background: rgba(248, 240, 226, 0.86); box-shadow: var(--shadow-soft); font-size: 28px; }
.background-trigger.is-open .background-trigger-pad { background: var(--color-primary); color: var(--color-on-primary); }

.background-drawer {
  position: absolute;
  left: calc(50% - min(66vw, calc(100vh - 180px), 760px) / 2 - 90px - 200px);
  top: 50%;
  z-index: 29;
  display: flex;
  flex-direction: column;
  width: 188px;
  max-height: min(420px, calc(100% - 24px));
  gap: 12px;
  padding: 18px 14px 14px;
  border-radius: var(--radius-md);
  background: #f4e9d3;
  box-shadow: var(--shadow-card);
  opacity: 0;
  pointer-events: none;
  transform: translate(-12px, -50%) scale(0.96);
  transform-origin: top right;
  transition: opacity 220ms ease, transform 220ms ease;
}

.background-drawer.is-open { opacity: 1; pointer-events: auto; transform: translate(0, -50%) scale(1); }
.drawer-title { color: var(--color-text-soft); font-size: 13px; letter-spacing: 1px; text-align: center; }
.background-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; overflow-y: auto; }
.background-card { position: relative; aspect-ratio: 1; min-width: 0; overflow: hidden; padding: 0; border: 2px solid transparent; border-radius: var(--radius-xs); background: #fffef8; cursor: pointer; }
.background-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.background-card.is-selected { border-color: var(--color-primary); box-shadow: 0 4px 14px rgba(232, 165, 114, 0.3); }
.background-card.is-locked { opacity: 0.55; }
.background-card .card-name { position: absolute; inset: auto 4px 4px; overflow: hidden; color: var(--color-text); font-size: 10px; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
.blank-card { display: grid; place-items: center; gap: 2px; color: var(--color-text-soft); font-size: 11px; }
.blank-card-mark { font-size: 24px; }
.card-lock { position: absolute; top: 4px; right: 4px; z-index: 1; font-size: 12px; }
.drawer-apply { min-height: 42px; border: 0; border-radius: var(--radius-pill); background: var(--color-primary); color: var(--color-on-primary); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.drawer-apply:disabled { cursor: not-allowed; opacity: 0.45; }

.bottom-action-dock { position: absolute; left: 50%; top: calc(50% + min(66vw, calc(100vh - 180px), 760px) / 2 + 16px); z-index: 31; display: flex; align-items: center; gap: 22px; transform: translateX(-50%); }
.dock-tool, .dock-material { display: grid; place-items: center; padding: 0; border: 1px solid rgba(89, 71, 56, 0.15); border-radius: var(--radius-sm); background: rgba(248, 240, 226, 0.88); color: var(--color-text); box-shadow: var(--shadow-soft); cursor: pointer; }
.dock-tool { width: 36px; height: 36px; font-size: 26px; line-height: 1; }
.dock-material { width: 44px; height: 44px; border-color: rgba(89, 71, 56, 0.2); border-radius: var(--radius-md); font-size: 27px; }
.dock-material.is-open { background: var(--color-primary); color: var(--color-on-primary); }
.dock-tool:disabled, .dock-material:disabled { cursor: not-allowed; opacity: 0.42; }
.dock-tool:hover:not(:disabled), .dock-material:hover:not(:disabled) { transform: translateY(-1px); }

.sheet-backdrop { position: fixed; inset: 0; z-index: 90; border: 0; background: rgba(89, 71, 56, 0.28); opacity: 0; pointer-events: none; transition: opacity 220ms ease; }
.sheet-backdrop.is-open { opacity: 1; pointer-events: auto; }
.material-sheet { position: fixed; left: 50%; bottom: 20px; z-index: 91; display: flex; flex-direction: column; width: calc(100% - 80px); max-width: 1280px; max-height: 60vh; overflow: hidden; border-radius: var(--radius-xl); background: var(--bg-app); box-shadow: var(--shadow-lift); transform: translate(-50%, calc(100% + 24px)); transition: transform 280ms cubic-bezier(0.4, 0, 0.2, 1); }
.material-sheet.is-open { transform: translate(-50%, 0); }
.sheet-handle { width: 48px; height: 5px; margin: 10px auto 4px; padding: 0; border: 0; border-radius: var(--radius-pill); background: var(--wood-mid); cursor: pointer; opacity: 0.75; }
.sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px 10px; border-bottom: 1px solid rgba(89, 71, 56, 0.08); }
.sheet-header h2 { margin: 0; font-size: 16px; font-weight: 700; }
.sheet-close { width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--color-text-soft); font-size: 26px; cursor: pointer; }
.sheet-category { display: flex; gap: 8px; padding: 10px 30px 4px; }
.category-chip { min-height: 30px; padding: 0 14px; border: 1px solid var(--wood-mid); border-radius: var(--radius-pill); background: transparent; color: var(--color-text-soft); font: inherit; font-size: 12px; }
.category-chip.is-selected { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-on-primary); }
.material-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 14px; max-width: 1210px; width: 100%; margin: 0 auto; padding: 4px 30px 12px; overflow-y: auto; }
.material-card { position: relative; aspect-ratio: 1; overflow: hidden; padding: 0; border: 2px solid transparent; border-radius: var(--radius-xs); background: #fffef8; cursor: pointer; box-shadow: var(--shadow-soft); }
.material-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.material-card:hover:not(.is-locked) { transform: translateY(-2px); }
.material-card.is-selected { border-color: var(--color-primary); box-shadow: 0 4px 14px rgba(232, 165, 114, 0.3); }
.material-card.is-locked { opacity: 0.55; }
.material-card-name { position: absolute; right: 6px; bottom: 5px; left: 6px; overflow: hidden; color: var(--color-text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.sheet-footer { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 10px 30px 16px; }
.sheet-selection { color: var(--color-text-soft); font-size: 13px; }
.sheet-add { min-height: 40px; padding: 0 22px; border: 0; border-radius: var(--radius-pill); background: var(--color-primary); color: var(--color-on-primary); font: inherit; font-weight: 700; cursor: pointer; }
.sheet-add:disabled { cursor: not-allowed; opacity: 0.46; }

.editor-state-banner { position: absolute; top: 74px; left: 50%; z-index: 40; margin: 0; padding: 8px 16px; border-radius: var(--radius-pill); background: rgba(244, 213, 192, 0.92); color: var(--wood-deeper); font-size: 13px; transform: translateX(-50%); }
.editor-feedback { position: absolute; bottom: 18px; left: 50%; z-index: 120; margin: 0; padding: 10px 18px; border-radius: var(--radius-pill); background: #fffef8; color: var(--color-text); box-shadow: var(--shadow-lift); font-size: 13px; transform: translateX(-50%); }
.editor-feedback.is-success { background: var(--color-confirm); color: #fff; }
.editor-feedback.is-error { background: #f4d5c0; color: var(--wood-deeper); }

.object-quick-tools {
  position: fixed;
  z-index: 150;
  display: inline-flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(89, 71, 56, 0.16);
  border-radius: var(--radius-pill);
  background: rgba(255, 254, 248, 0.96);
  box-shadow: var(--shadow-lift);
  transform: translateZ(0);
}
.object-quick-tools::after { content: ""; position: absolute; left: 50%; bottom: -7px; width: 12px; height: 12px; border-right: 1px solid rgba(89, 71, 56, 0.16); border-bottom: 1px solid rgba(89, 71, 56, 0.16); background: rgba(255, 254, 248, 0.96); transform: translateX(-50%) rotate(45deg); }
.object-quick-tools.is-below::after { top: -7px; bottom: auto; transform: translateX(-50%) rotate(225deg); }
.object-quick-tools button { min-height: 32px; padding: 0 12px; border: 0; border-radius: var(--radius-pill); background: var(--wood-surface); color: var(--color-text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.object-quick-tools button:hover { background: var(--color-primary-soft); }
.object-quick-tools button:last-child { background: var(--color-primary); color: var(--color-on-primary); }
.remove-toast { position: fixed; left: 50%; bottom: 72px; z-index: 160; display: inline-flex; align-items: center; gap: 14px; min-height: 42px; padding: 0 8px 0 18px; border-radius: var(--radius-pill); background: rgba(89, 71, 56, 0.94); color: #fff; box-shadow: var(--shadow-lift); font-size: 13px; transform: translateX(-50%); }
.remove-toast button { min-height: 32px; padding: 0 14px; border: 0; border-radius: var(--radius-pill); background: var(--color-primary-soft); color: var(--wood-deeper); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }

.return-modal-layer { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; }
.return-modal-backdrop { position: absolute; inset: 0; border: 0; background: rgba(89, 71, 56, 0.32); }
.return-modal { position: relative; width: min(430px, calc(100vw - 48px)); padding: 28px; border-radius: var(--radius-lg); background: #fffef8; box-shadow: var(--shadow-lift); text-align: center; }
.return-modal-icon { display: grid; place-items: center; width: 54px; height: 54px; margin: 0 auto 12px; border-radius: 50%; background: var(--color-primary-soft); color: var(--wood-deeper); font-size: 28px; }
.return-modal h2 { margin: 0; font-size: 20px; }
.return-modal p { margin: 10px 0 0; color: var(--color-text-soft); font-size: 14px; }
.return-modal-error { color: var(--wood-deeper) !important; }
.return-modal-actions { display: grid; gap: 9px; margin-top: 22px; }
.return-modal-actions button { min-height: 42px; border-radius: var(--radius-pill); font: inherit; font-weight: 700; cursor: pointer; }
.return-save { border: 0; background: var(--color-primary); color: #fff; }
.return-discard { border: 1px solid var(--wood-mid); background: transparent; color: var(--wood-deeper); }
.return-cancel { border: 0; background: var(--wood-surface); color: var(--color-text); }
.return-modal-actions button:disabled { cursor: not-allowed; opacity: 0.5; }

@media (max-width: 1439px) { .material-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (min-width: 1920px) { .material-grid { grid-template-columns: repeat(8, minmax(0, 1fr)); } }
</style>
