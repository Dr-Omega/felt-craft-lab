<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import { EditorSessionService, FabricEditorAdapter, type EditorSessionState } from '../editor'
import {
  CATALOG_ASSETS,
  createCatalogResolver,
  DEFAULT_USER_ID,
  isAssetUnlocked,
  YWN_SNAPSHOT_CONTEXT
} from '../catalog/ywn-catalog'
import {
  assetsForTheme,
  normalizeSelectedAssetId,
  pickSelectedAsset
} from '../catalog/editor-selection'
import { getEditorLaunch, openLibrary } from '../app-nav'
import {
  AssetAccessStore,
  ProjectStore,
  getFeltCraftDatabase,
  saveDraftFromPreparedScene,
  saveNewProject,
  updateExistingProject
} from '../persistence'
import { aiClient } from '../services/ai.client'
import { audioService } from '../services/audio.service'

const launch = getEditorLaunch()
if (!launch) {
  openLibrary()
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const sessionState = ref<EditorSessionState | null>(null)
const message = ref('')
const busy = ref(false)
const workName = ref(launch?.scene.workName ?? '我的新作品')
const question = ref('这是什么？')
const aiAnswer = ref('')
const aiBusy = ref(false)
const accessByAssetId = ref<Record<string, AssetAccessState | undefined>>({})

const sceneThemeId = launch?.scene.themeId
const initialStickers = assetsForTheme(CATALOG_ASSETS, 'sticker', sceneThemeId)
const initialBackgrounds = assetsForTheme(CATALOG_ASSETS, 'background', sceneThemeId)
const selectedAssetId = ref(initialStickers[0]?.assetId ?? '')
const selectedBackgroundId = ref(initialBackgrounds[0]?.assetId ?? '')

const session = shallowRef<EditorSessionService | null>(null)
let unsubscribe: (() => void) | undefined
let draftId = launch?.draftId
let projectId = launch?.projectId

const stickers = computed(() => assetsForTheme(CATALOG_ASSETS, 'sticker', launch?.scene.themeId))
const backgrounds = computed(() =>
  assetsForTheme(CATALOG_ASSETS, 'background', launch?.scene.themeId)
)

function normalizeSelections(): void {
  selectedAssetId.value = normalizeSelectedAssetId(selectedAssetId.value, stickers.value)
  selectedBackgroundId.value = normalizeSelectedAssetId(selectedBackgroundId.value, backgrounds.value)
}

normalizeSelections()

const canSave = computed(() => Boolean(sessionState.value?.canPrepareDraft && sessionState.value?.canPrepareProject))
const selectedUnlocked = computed(() => isAssetUnlocked(accessByAssetId.value[selectedAssetId.value]))
const selectedBackgroundUnlocked = computed(() =>
  isAssetUnlocked(accessByAssetId.value[selectedBackgroundId.value])
)

function selectedAsset(): AssetRecord | undefined {
  return pickSelectedAsset(selectedAssetId.value, stickers.value)
}

function selectedBackground(): AssetRecord | undefined {
  return pickSelectedAsset(selectedBackgroundId.value, backgrounds.value)
}

async function refreshAccess(): Promise<void> {
  const store = new AssetAccessStore(getFeltCraftDatabase())
  const rows = await store.listForUser(DEFAULT_USER_ID)
  const next: Record<string, AssetAccessState | undefined> = {}
  for (const row of rows) next[row.assetId] = row
  accessByAssetId.value = next
}

async function requireUnlockedAccess(assetId: string): Promise<AssetAccessState> {
  const store = new AssetAccessStore(getFeltCraftDatabase())
  const access = await store.get(DEFAULT_USER_ID, assetId)
  if (!isAssetUnlocked(access)) {
    throw new Error(
      import.meta.env.DEV
        ? '素材未解锁，不能加入画布。可在素材库使用「测试解锁」。'
        : '素材未解锁，不能加入画布。'
    )
  }
  return access!
}

async function boot(): Promise<void> {
  if (!launch || !canvasEl.value) return
  message.value = ''
  await refreshAccess()
  const service = new EditorSessionService({
    createAdapter: () =>
      new FabricEditorAdapter({
        allowTestAssets: false,
        snapshotContext: YWN_SNAPSHOT_CONTEXT
      })
  })
  session.value = service
  unsubscribe = service.subscribe((state) => {
    sessionState.value = state
  })
  await service.open(canvasEl.value, launch.scene, createCatalogResolver())
}

async function addSelectedSticker(): Promise<void> {
  if (!session.value) return
  const asset = selectedAsset()
  if (!asset || asset.type !== 'sticker') {
    message.value = '请选择贴纸素材。'
    return
  }
  busy.value = true
  try {
    const access = await requireUnlockedAccess(asset.assetId)
    await session.value.addSticker(asset, access)
    message.value = `已加入贴纸：${asset.nameZh}`
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function applyBackground(): Promise<void> {
  if (!session.value) return
  const background = selectedBackground()
  if (!background) {
    message.value = '当前主题没有背景素材。'
    return
  }
  busy.value = true
  try {
    const access = await requireUnlockedAccess(background.assetId)
    await session.value.setBackground(background, access)
    message.value = `已设置背景：${background.nameZh}`
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function saveDraft(): Promise<void> {
  if (!session.value) return
  busy.value = true
  message.value = ''
  try {
    const preparedScene = session.value.prepareDraftSave()
    const saved = await saveDraftFromPreparedScene(preparedScene, { draftId })
    draftId = saved.draftId
    message.value = `草稿已保存：${saved.draftId}`
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function saveProject(): Promise<void> {
  if (!session.value) return
  busy.value = true
  message.value = ''
  try {
    const prepared = await session.value.prepareProjectSave()

    if (projectId) {
      const existing = await new ProjectStore(getFeltCraftDatabase()).get(projectId)
      if (!existing) throw new Error('本地作品不存在，请改为另存新作品。')
      const saved = await updateExistingProject(existing, prepared)
      projectId = saved.projectId
      message.value = `作品已更新：${saved.projectId}`
    } else {
      const saved = await saveNewProject(prepared)
      projectId = saved.projectId
      message.value = `作品已保存：${saved.projectId}`
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function askMockQa(): Promise<void> {
  aiBusy.value = true
  aiAnswer.value = ''
  try {
    const asset = selectedAsset()
    if (!asset) {
      throw new Error('当前主题没有可选贴纸。')
    }
    const response = (await aiClient.qaAsk({
      question: question.value.trim() || '这是什么？',
      asset: {
        assetId: asset.assetId,
        nameZh: asset.nameZh,
        introZh: asset.introZh,
        themeId: asset.themeId
      },
      provider: 'mock'
    })) as { ok?: boolean; result?: { answer?: string }; error?: { message?: string } }

    if (!response?.ok || !response.result?.answer) {
      throw new Error(response?.error?.message || 'Mock QA 未返回答案')
    }
    aiAnswer.value = response.result.answer

    try {
      const tts = (await aiClient.ttsSynthesize({
        text: response.result.answer,
        voicePurpose: 'qa_answer',
        provider: 'mock'
      })) as { ok?: boolean; result?: { audioUrl?: string } }
      if (tts?.ok && tts.result?.audioUrl) {
        await audioService.play(tts.result.audioUrl, 'primary')
      }
    } catch {
      // TTS failure must not break text answer display
    }
  } catch (error) {
    aiAnswer.value = error instanceof Error ? error.message : String(error)
  } finally {
    aiBusy.value = false
  }
}

function goBack(): void {
  unsubscribe?.()
  session.value?.dispose()
  session.value = null
  openLibrary()
}

onMounted(async () => {
  await nextTick()
  try {
    await boot()
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  }
})

onUnmounted(() => {
  unsubscribe?.()
  session.value?.dispose()
  audioService.stop('primary')
})
</script>

<template>
  <section class="editor">
    <header class="toolbar">
      <button type="button" class="ghost" @click="goBack">返回素材库</button>
      <p class="work-name">作品名 <strong>{{ workName }}</strong></p>
      <span class="status" v-if="sessionState">
        {{ sessionState.status }} · pending {{ sessionState.pendingOperations }}
      </span>
    </header>

    <div class="workspace">
      <div class="canvas-wrap">
        <canvas ref="canvasEl" class="editor-canvas" width="960" height="640"></canvas>
      </div>

      <aside class="side">
        <section>
          <h3>素材操作</h3>
          <label>
            选择贴纸
            <select v-model="selectedAssetId">
              <option v-for="asset in stickers" :key="asset.assetId" :value="asset.assetId">
                {{ asset.nameZh }} · {{ isAssetUnlocked(accessByAssetId[asset.assetId]) ? '已解锁' : '锁定' }}
              </option>
            </select>
          </label>
          <label>
            选择背景
            <select v-model="selectedBackgroundId">
              <option v-for="asset in backgrounds" :key="asset.assetId" :value="asset.assetId">
                {{ asset.nameZh }} · {{ isAssetUnlocked(accessByAssetId[asset.assetId]) ? '已解锁' : '锁定' }}
              </option>
            </select>
          </label>
          <div class="row">
            <button
              type="button"
              class="primary"
              :disabled="busy || !sessionState?.canEdit || !selectedUnlocked"
              @click="addSelectedSticker"
            >
              加入贴纸
            </button>
            <button
              type="button"
              :disabled="busy || !sessionState?.canEdit || !selectedBackgroundUnlocked"
              @click="applyBackground"
            >
              设背景
            </button>
          </div>
          <p class="muted">未解锁素材可浏览，但不能 addSticker / setBackground。旧 Scene 恢复不受当前锁影响。</p>
          <div class="row">
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.undo()">撤销</button>
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.redo()">重做</button>
          </div>
          <div class="row">
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.deleteSelected()">删除</button>
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.bringSelectedForward()">上移</button>
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.sendSelectedBackward()">下移</button>
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.bringSelectedToFront()">置顶</button>
            <button type="button" :disabled="!sessionState?.canEdit" @click="session?.sendSelectedToBack()">置底</button>
          </div>
        </section>

        <section>
          <h3>保存</h3>
          <div class="row">
            <button type="button" class="primary" :disabled="busy || !canSave" @click="saveDraft">保存草稿</button>
            <button type="button" class="primary" :disabled="busy || !canSave" @click="saveProject">保存作品</button>
          </div>
          <p class="muted">prepare* 输出直接交给 Persistence；不改 workName / updatedAt。</p>
        </section>

        <section>
          <h3>AI Mock 问答</h3>
          <textarea v-model="question" rows="3" placeholder="问一句关于贴纸的问题"></textarea>
          <button type="button" :disabled="aiBusy" @click="askMockQa">
            {{ aiBusy ? '请求中…' : 'electronAPI.ai.qaAsk (mock)' }}
          </button>
          <p v-if="aiAnswer" class="answer">{{ aiAnswer }}</p>
          <p class="muted">经 Preload → Main；不直连 Flask。TTS 失败只保留文字。</p>
        </section>

        <p v-if="message" class="message">{{ message }}</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 16px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.work-name {
  margin: 0;
  color: var(--muted);
}

.work-name strong {
  color: var(--ink);
  font-weight: 600;
}

.status {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.9rem;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.canvas-wrap {
  overflow: auto;
  padding: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
}

.editor-canvas {
  display: block;
  max-width: 100%;
  background: #fff;
  border: 1px solid var(--line);
}

.side {
  display: grid;
  gap: 16px;
}

.side section {
  padding: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
}

.side h3 {
  margin: 0 0 10px;
  font-size: 1rem;
}

.side label {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 0.85rem;
}

.side select,
.side textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.muted {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.4;
}

.answer,
.message {
  margin: 10px 0 0;
  line-height: 1.5;
}

.message {
  color: var(--accent);
}

@media (max-width: 960px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
