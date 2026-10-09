<script setup lang="ts">
import { getCurrentUserId } from '../services/plaza-session'
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
  isAssetUnlocked,
  resolveEditorCatalogForSnapshot,
  YWN_SNAPSHOT_CONTEXT
} from '../catalog/ywn-catalog'
import { assetsForEditor, pickSelectedAsset } from '../catalog/editor-selection'
import {
  isAcceptanceUnlockAllAssetsEnabled,
  seedAcceptanceUnlockedAccess
} from '../catalog/acceptance-access'
import { getEditorLaunch, openLibrary, openLearning, openSavedWork } from '../app-nav'
import { DEFAULT_SCENE_CANVAS } from '../catalog/scene-defaults'
import {
  AssetAccessStore,
  ProjectStore,
  getFeltCraftDatabase,
  saveDraftFromPreparedScene,
  saveNewProject,
  updateExistingProject
} from '../persistence'
import GuidedThemeTask from '../components/editor/GuidedThemeTask.vue'
import DrawingFrame from '../components/editor/DrawingFrame.vue'
import BackgroundDrawer from '../components/editor/BackgroundDrawer.vue'
import MaterialSheet from '../components/editor/MaterialSheet.vue'
import AssetQaSheet from '../components/editor/AssetQaSheet.vue'
import ReturnSaveModal from '../components/editor/ReturnSaveModal.vue'
import ObjectQuickTools from '../components/editor/ObjectQuickTools.vue'
import RemoveToast from '../components/editor/RemoveToast.vue'
import { audioService } from '../services/audio.service'
import ElementLayerEditor from '../components/projection/ElementLayerEditor.vue'
import type { SceneBinding, LayerColors } from '@shared/fabrication-colors'
import { persistCanvasRecolor, readCanvasRecolorLink, type CanvasRecolorLink } from '../fabrication/canvas-recolor'
import { recolorLayers } from '../fabrication/recolor'
import type { ScreenBox } from '../fabrication/panel-placement'
import CreationInputDialog from '../components/editor/CreationInputDialog.vue'
import { persistCanvasInput } from '../fabrication/canvas-intake'
import type { ForegroundMode } from '@shared/fabrication-desktop'

const launch = getEditorLaunch()
if (!launch) openLibrary()
const guidedTheme = launch?.guidedTheme
let unlockDestination: string | undefined
function leaveEditor(): void {
  if (guidedTheme || unlockDestination) openLearning(guidedTheme?.themeId ?? unlockDestination)
  else openLibrary()
}
function requestThemeUnlock(themeId: string): void {
  unlockDestination = themeId
  requestBack()
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const logicalCanvasWidth = launch?.scene.canvas.width ?? DEFAULT_SCENE_CANVAS.width
const logicalCanvasHeight = launch?.scene.canvas.height ?? DEFAULT_SCENE_CANVAS.height
const session = shallowRef<EditorSessionService | null>(null)
const sessionState = ref<EditorSessionState | null>(null)
const accessByAssetId = ref<Record<string, AssetAccessState | undefined>>({})
const busy = ref(false)
const feedback = ref('')
const feedbackKind = ref<'success' | 'error' | 'info'>('info')
const returnModalOpen = ref(false)
const returnModalError = ref('')
const sheetOpen = ref(false)
const qaAsset = ref<AssetRecord | null>(null)
const backgroundDrawerOpen = ref(false)
const inputDialogOpen = ref(false)
const sceneSnapshotMissing = ref(false)
const currentSelection = ref<EditorSelectionProjection | null>(null)
const oqtSelection = ref<EditorSelectionProjection | null>(null)
const oqtOpen = ref(false)
const oqtPosition = ref({ left: 0, top: 0, below: false })
const oqtElement = ref<{ $el: HTMLElement } | null>(null)
const removeToastOpen = ref(false)
const layerEditor = shallowRef<{ input: Uint8Array; binding: SceneBinding | null; selection: EditorSelectionProjection; savedEdit?: CanvasRecolorLink; foregroundMode: ForegroundMode }>()
const layerAnchor = ref<ScreenBox>({ left: 0, top: 0, width: 0, height: 0 })

function updateLayerAnchor(): void {
  const rect = canvasEl.value?.getBoundingClientRect()
  const bounds = layerEditor.value?.selection.bounds
  if (!rect || !bounds) return
  layerAnchor.value = { left: rect.left + bounds.left * rect.width / logicalCanvasWidth,
    top: rect.top + bounds.top * rect.height / logicalCanvasHeight,
    width: bounds.width * rect.width / logicalCanvasWidth, height: bounds.height * rect.height / logicalCanvasHeight }
}

async function previewLayerColor(png: string): Promise<void> {
  const current = layerEditor.value
  if (!current || !session.value) return
  try { await session.value.previewElementImage(current.selection.objectId, png) }
  catch (e) { showFeedback(friendlyError(e), 'error') }
}

function closeLayerEditor(): void {
  session.value?.clearElementPreview()
  layerEditor.value = undefined
}

async function applyLayerColor(png: string, colors: LayerColors, jobId: string, sourceSha256: string): Promise<void> {
  const current = layerEditor.value, service = session.value
  if (!current || !service) throw new Error('元素编辑已关闭。')
  const { asset, version } = await persistCanvasRecolor(png, {
    binding: colors.binding, colors, jobId, sourceSha256, ownerUserId: launch!.scene.userId
  }, current.selection.kind === 'core_pattern' ? 'core_pattern' : 'element')
  await service.replaceElementImage(current.selection.objectId, asset, version)
}

async function addProcessedElement(): Promise<void> {
  const service = session.value, id = localStorage.getItem('felt-fabrication-job')
  if (!service || busy.value) return
  if (!id) { showFeedback('目前没有已完成分层的素材。可先在画布中选择元素编辑。', 'info'); return }
  busy.value = true
  const urls: string[] = []
  try {
    const job = await window.electronAPI.fabrication.resume(id)
    if (job.status !== 'complete' || !job.result) throw new Error('这份素材尚未完成分层。')
    const colors = await window.electronAPI.fabrication.colors(id)
    for (const step of job.result.steps) {
      const data = await window.electronAPI.fabrication.asset(id, step.asset)
      urls.push(URL.createObjectURL(new Blob([new Uint8Array(data.bytes).buffer], {type:data.mime})))
    }
    const painted = await recolorLayers(colors, urls, job.result.width, job.result.height)
    const {asset,version} = await persistCanvasRecolor(painted.composite, { jobId: id, sourceSha256: job.result.sourceSha256,
      binding: colors.binding, colors, ownerUserId: launch!.scene.userId }, 'element')
    await service.addPersonalElement(asset, version)
    showFeedback('已放入真实分层素材，双击它即可按层换色。', 'success')
  } catch (error) { showFeedback(friendlyError(error), 'error') }
  finally { urls.forEach(url=>URL.revokeObjectURL(url)); busy.value=false }
}

// Keep the original job binding while this element's actual input bytes remain unchanged.
// Scene export timestamps, dragging, or adding unrelated stickers must not restart decomposition.
const layerPreparations = new Map<string, { input: Uint8Array; binding: SceneBinding }>()

async function editElementLayers(): Promise<void> {
  const selection = oqtSelection.value || currentSelection.value
  if (!session.value || !selection || busy.value) return
  busy.value = true
  try {
    const prepared = await session.value.prepareProjectSave(selection.objectId)
    const personal = [...prepared.scene.personalElements, ...(prepared.scene.corePattern ? [prepared.scene.corePattern] : [])]
      .find(item => item.objectId === selection.objectId)
    const savedEdit = personal ? readCanvasRecolorLink(personal.versionId) : undefined
    const input = new Uint8Array(await prepared.previewPng.arrayBuffer())
    const cached = layerPreparations.get(selection.objectId)
    const preparation = cached && cached.input.length === input.length && input.every((byte, i) => byte === cached.input[i])
      ? cached : { input, binding: { scene: prepared.scene, objectId: selection.objectId } }
    if (!savedEdit) layerPreparations.set(selection.objectId, preparation)
    const foregroundMode = personal && localStorage.getItem(`felt-foreground-mode:${personal.versionId}`) === 'embedded-alpha' ? 'embedded-alpha' : 'birefnet-general'
    layerEditor.value = { input, binding: savedEdit ? savedEdit.binding : preparation.binding, selection, savedEdit, foregroundMode }
    updateLayerAnchor(); closeTransientContexts()
  } catch (e) { showFeedback(friendlyError(e), 'error') }
  finally { busy.value = false }
}

async function insertCreationImage(bytes: Uint8Array, name: string, source: 'uploaded'|'ai_generated', foregroundMode: ForegroundMode = 'birefnet-general'): Promise<void> {
  const service = session.value
  if (!service || busy.value) throw new Error('画布尚未就绪，请稍后重试。')
  busy.value = true
  try {
    const { asset, version } = await persistCanvasInput(bytes, name, launch!.scene.userId, source)
    localStorage.setItem(`felt-foreground-mode:${version.versionId}`, foregroundMode)
    const objectId = await service.addPersonalElement(asset, version)
    inputDialogOpen.value = false
    closeTransientContexts()
    busy.value = false
    await prepareConfirmedImage(objectId)
  } finally { busy.value = false }
}

async function prepareConfirmedImage(objectId: string): Promise<void> {
  closeTransientContexts()
  // Select through Fabric so preparation uses the actual element bounds and source.
  session.value!.selectObject(objectId)
  await nextTick()
  if (currentSelection.value?.objectId !== objectId) throw new Error('图片已加入画布，但未能选中以准备图层。请重新选择编辑。')
  await editElementLayers()
}

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
const acceptanceUnlockAllAssets = isAcceptanceUnlockAllAssetsEnabled(
  import.meta.env.VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS
)
const stickers = computed(() => assetsForEditor(sceneCatalogAssets, 'sticker', sceneThemeId))
const backgrounds = computed(() => assetsForEditor(sceneCatalogAssets, 'background', sceneThemeId))
const selectedStickerId = ref('')
const selectedBackgroundId = ref(launch?.scene.backgroundAssetId ?? '')

const canEdit = computed(() => Boolean(sessionState.value?.canEdit))
const canUndo = computed(() => Boolean(sessionState.value?.canUndo))
const canRedo = computed(() => Boolean(sessionState.value?.canRedo))
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
  if (/locked|unlock|解锁/i.test(text)) return '这个主题还没有解锁，请先前往主题引导任务。'
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
  if (guidedTheme) return
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
  closeBackgroundDrawer()
  oqtSelection.value = event.selection
  oqtOpen.value = true
  void nextTick(updateOqtPosition)
}

async function refreshAccess(): Promise<void> {
  const store = new AssetAccessStore(getFeltCraftDatabase())
  const rows = await store.listForUser(getCurrentUserId())
  const next: Record<string, AssetAccessState | undefined> = {}
  for (const row of rows) next[row.assetId] = row
  accessByAssetId.value = next
}

async function boot(): Promise<void> {
  if (!launch || !canvasEl.value) return
  sceneSnapshotMissing.value = editorCatalog.snapshotMissing
  const accessStore = new AssetAccessStore(getFeltCraftDatabase())
  if (!guidedTheme) await seedAcceptanceUnlockedAccess(accessStore, sceneCatalogAssets, acceptanceUnlockAllAssets)
  await refreshAccess()
  if (launch.fromGeneration) {
    showFeedback('图片已确认，正在准备图层。等待时可以继续布置画布。', 'info')
  }
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
    if (launch.mode === 'draft' || launch.mode === 'project') service.markSaved()
    selectionUnsubscribe = service.subscribeSelection(handleSelectionEvent)
    if (launch.fromGeneration && launch.scene.corePattern) {
      await prepareConfirmedImage(launch.scene.corePattern.objectId)
    }
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
  audioService.stop('primary')
  sheetOpen.value = false
  selectedStickerId.value = ''
}

function closeBackgroundDrawer(): void {
  audioService.stop('primary')
  backgroundDrawerOpen.value = false
}

function openMaterialSheet(): void {
  selectedStickerId.value = ''
  closeBackgroundDrawer()
  closeOqt()
  sheetOpen.value = true
}

function closeTransientContexts(): void {
  closeMaterialSheet()
  closeBackgroundDrawer()
  closeOqt()
}

function toggleSheet(): void {
  if (sheetOpen.value) closeMaterialSheet()
  else openMaterialSheet()
}

function toggleBackgroundDrawer(): void {
  if (backgroundDrawerOpen.value) {
    closeBackgroundDrawer()
  } else {
    backgroundDrawerOpen.value = true
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
    closeBackgroundDrawer()
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

async function finish(next?: 'story-card' | 'work-display'): Promise<void> {
  if (!session.value || busy.value) return
  closeOqt()
  busy.value = true
  try {
    const prepared = await session.value.prepareProjectSave()
    if (projectId) {
      const existing = await new ProjectStore(getFeltCraftDatabase()).get(projectId)
      if (!existing) throw new Error('这件作品暂时找不到啦。')
      await updateExistingProject(existing, prepared)
    } else {
      const saved = await saveNewProject(prepared, { draftId })
      projectId = saved.projectId
      draftId = undefined
    }
    session.value.markSaved()
    showFeedback('作品收好啦！', 'success')
    if (next && projectId) await openSavedWork(projectId, next, 'editor')
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

async function quickBringToFront(): Promise<void> {
  const selection = oqtSelection.value
  if (!selection || !session.value) return
  hideRemoveToast()
  try {
    session.value.bringToFront(selection.objectId)
    void nextTick(updateOqtPosition)
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

async function quickSendToBack(): Promise<void> {
  const selection = oqtSelection.value
  if (!selection || !session.value) return
  hideRemoveToast()
  try {
    session.value.sendToBack(selection.objectId)
    void nextTick(updateOqtPosition)
  } catch (error) {
    showFeedback(friendlyError(error), 'error')
  }
}

async function quickRemove(): Promise<void> {
  const selection = oqtSelection.value
  if (!selection || !session.value) return
  if (selection.kind === 'core_pattern') return
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
  if (busy.value) return
  if (guidedTheme) { leaveEditor(); return }
  closeTransientContexts()
  returnModalError.value = ''
  if (sessionState.value?.isDirty === false) {
    leaveEditor()
    return
  }
  returnModalOpen.value = true
}

async function saveProgressAndBack(): Promise<void> {
  if (!session.value || busy.value) return
  busy.value = true
  returnModalError.value = ''
  try {
    if (projectId) {
      const existing = await new ProjectStore(getFeltCraftDatabase()).get(projectId)
      if (!existing) throw new Error('这件作品暂时找不到啦。')
      await updateExistingProject(existing, await session.value.prepareProjectSave())
    } else {
      const preparedScene = session.value.prepareDraftSave()
      const saved = await saveDraftFromPreparedScene(preparedScene, { draftId })
      draftId = saved.draftId
    }
    session.value.markSaved()
    audioService.stop('primary')
    returnModalOpen.value = false
    leaveEditor()
  } catch (error) {
    returnModalError.value = friendlyError(error)
  } finally {
    busy.value = false
  }
}

function discardAndBack(): void {
  if (busy.value) return
  audioService.stop('primary')
  returnModalOpen.value = false
  leaveEditor()
}

function continueEditing(): void {
  unlockDestination = undefined
  returnModalOpen.value = false
  returnModalError.value = ''
}

onMounted(async () => {
  document.body.classList.add('editor-lock-scroll')
  window.addEventListener('resize', updateOqtPosition)
  window.addEventListener('resize', updateLayerAnchor)
  try { await boot() } catch (error) { showFeedback(friendlyError(error), 'error') }
})

onUnmounted(() => {
  document.body.classList.remove('editor-lock-scroll')
  unsubscribe?.()
  selectionUnsubscribe?.()
  hideRemoveToast()
  window.removeEventListener('resize', updateOqtPosition)
  window.removeEventListener('resize', updateLayerAnchor)
  session.value?.dispose()
  audioService.stop('primary')
})

watch([oqtOpen, oqtSelection], () => { void nextTick(updateOqtPosition) })
</script>

<template>
  <section class="editor-stage">
    <DrawingFrame :task-mode="!!guidedTheme" :busy="busy" :can-undo="canUndo" :can-redo="canRedo" :can-save="canFinish && !guidedTheme"
      @back="requestBack" @undo="undo" @redo="redo" @save="finish()">
      <div class="editor-frame-inner" @click.self="closeTransientContexts">
        <div class="canvas-area" :inert="busy || undefined">
          <div class="canvas-stage">
            <div class="canvas-wrap" :style="{ '--canvas-ratio': logicalCanvasWidth / logicalCanvasHeight }">
              <canvas
                ref="canvasEl"
                class="editor-canvas"
                :width="logicalCanvasWidth"
                :height="logicalCanvasHeight"
              ></canvas>
              <GuidedThemeTask v-if="guidedTheme && session && sessionState?.status === 'ready'" :service="session" :session-id="guidedTheme.sessionId" :theme-id="guidedTheme.themeId" />
            </div>
          </div>
        </div>

        <div v-if="!guidedTheme" class="editor-side">
          <BackgroundDrawer
            :assets="backgrounds"
            :access-by-asset-id="accessByAssetId"
            :selected-asset-id="selectedBackgroundId"
            :open="backgroundDrawerOpen"
            :busy="busy"
            @select="(assetId) => (selectedBackgroundId = assetId)"
            @apply="applyBackground"
            @unlock="requestThemeUnlock"
            @close="closeBackgroundDrawer"
          />
        </div>

      </div>
      <template v-if="!guidedTheme" #tools>
        <button :disabled="busy || !canFinish || Boolean(layerEditor)" @click="finish('story-card')">保存并讲故事</button>
        <button :disabled="busy || !canFinish || Boolean(layerEditor)" @click="finish('work-display')">保存并展示</button>
        <button :disabled="busy || !canEdit || !!layerEditor" @click="inputDialogOpen = true">添加图片</button>
        <button aria-label="打开素材盒" :disabled="busy || !canEdit" @click="toggleSheet">素材</button>
        <button aria-label="打开背景选择" :aria-expanded="backgroundDrawerOpen" @click="toggleBackgroundDrawer">背景</button>
        <button :disabled="busy || !currentSelection || !canFinish" @click="editElementLayers">编辑选中元素</button>
        <button :disabled="busy || !canEdit" @click="addProcessedElement">加入已分层素材</button>
      </template>
    </DrawingFrame>

    <p v-if="sessionState?.status === 'recovery' || sceneSnapshotMissing" class="editor-state-banner">
      有些以前用过的素材暂时找不到啦，这件作品先不能继续保存或完成。
    </p>
    <p v-if="feedback" class="editor-feedback" :class="`is-${feedbackKind}`" role="status">{{ feedback }}</p>

    <MaterialSheet v-if="!guidedTheme"
      :assets="stickers"
      :access-by-asset-id="accessByAssetId"
      :selected-asset-id="selectedStickerId"
      :open="sheetOpen"
      :busy="busy"
      @select="selectSticker"
      @add="addSticker"
      @unlock="requestThemeUnlock"
      @ask="asset => { qaAsset = asset; closeMaterialSheet() }"
      @close="closeMaterialSheet"
    />

    <ObjectQuickTools
      v-if="oqtOpen"
      ref="oqtElement"
      :left="oqtPosition.left"
      :top="oqtPosition.top"
      :below="oqtPosition.below"
      :can-change-layer="oqtSelection?.canChangeLayer !== false"
      :can-remove="oqtSelection?.kind !== 'core_pattern'"
      :can-edit-layers="!busy && canFinish"
      @edit="editElementLayers"
      @forward="quickBringForward"
      @backward="quickSendBackward"
      @bring-to-front="quickBringToFront"
      @send-to-back="quickSendToBack"
      @remove="quickRemove"
    />

    <RemoveToast :open="removeToastOpen" @undo="undoRemoval" />
    <AssetQaSheet :asset="qaAsset" :open="!!qaAsset" @close="qaAsset = null" />

    <ElementLayerEditor v-if="layerEditor" :key="layerEditor.selection.objectId" :input="layerEditor.input" :binding="layerEditor.binding" :foreground-mode="layerEditor.foregroundMode"
      :anchor="layerAnchor" :saved-edit="layerEditor.savedEdit" :apply="applyLayerColor" @preview="previewLayerColor" @close="closeLayerEditor" />
    <CreationInputDialog v-if="inputDialogOpen" :insert="insertCreationImage" @close="inputDialogOpen = false" />

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

body { margin: 0; }

.editor-stage {
  position: absolute;
  inset: 0;
  z-index: 30;
  overflow: visible;
  color: var(--color-text);
  background: transparent;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  pointer-events: none;
}

.editor-canvas-overlay {
  object-fit: fill;
  user-select: none;
}

.editor-stage :deep(.psd-frame-stage__content),
.editor-save-psd,
.editor-projection-link,
.editor-state-banner,
.editor-feedback,
.editor-frame-inner,
.canvas-area,
.canvas-wrap {
  pointer-events: auto;
}

.editor-stage :deep(.psd-frame-stage__content) {
  overflow: visible;
}

.editor-frame-inner {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: visible;
}

.canvas-area {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
}

.editor-stage :deep(.editor-topbar) {
  padding: 0 8px;
}

.editor-side {
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.editor-side .background-trigger,
.editor-side .background-drawer {
  pointer-events: auto;
}

/* DrawingFrame has no legacy side dock: keep the chooser inside the visible canvas. */
.editor-side .background-drawer {
  left: auto;
  right: 8px;
  margin-left: 0;
}

.bottom-action-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  padding-bottom: 2px;
  pointer-events: auto;
}

.canvas-stage {
  container-type: size;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-lg);
  background: var(--bg-app);
  overflow: hidden;
}

.editor-save-psd {
  position: fixed;
  z-index: 90;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}

.editor-save-psd img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.editor-save-psd:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.editor-projection-link {
  position: fixed;
  z-index: 90;
  right: 27%;
  bottom: 8%;
  padding: 8px 14px;
  font-size: 0.9rem;
}

.element-recolor-link { right: calc(27% + 180px); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.canvas-wrap .canvas-container {
  width: 100% !important;
  height: 100% !important;
  border-radius: var(--radius-lg);
  overflow: visible;
  background: var(--bg-app);
}

.canvas-wrap { position: relative; width: min(100cqw, calc(100cqh * var(--canvas-ratio))); height: min(100cqh, calc(100cqw / var(--canvas-ratio))); }
.editor-canvas { display: block; width: 100%; height: 100%; border-radius: var(--radius-lg); touch-action: none; }
.canvas-wrap .canvas-container .lower-canvas { width: 100% !important; height: 100% !important; border-radius: var(--radius-lg); }
.canvas-wrap .canvas-container .upper-canvas { width: 100% !important; height: 100% !important; border-radius: var(--radius-lg); background: transparent !important; }

.background-trigger {
  position: relative;
  z-index: 30;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.background-trigger.is-open {
  filter: drop-shadow(0 0 8px rgba(232, 165, 114, 0.55));
}

.editor-state-banner { position: absolute; top: 74px; left: 50%; z-index: 40; margin: 0; padding: 8px 16px; border-radius: var(--radius-pill); background: rgba(244, 213, 192, 0.92); color: var(--wood-deeper); font-size: 13px; transform: translateX(-50%); }
.editor-feedback { position: fixed; bottom: 18px; left: 50%; z-index: 95; margin: 0; padding: 10px 18px; border-radius: var(--radius-pill); background: #fffef8; color: var(--color-text); box-shadow: var(--shadow-lift); font-size: 13px; transform: translateX(-50%); pointer-events: none; }
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

@media (max-width: 1439px) { .material-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (min-width: 1920px) { .material-grid { grid-template-columns: repeat(8, minmax(0, 1fr)); } }
</style>
