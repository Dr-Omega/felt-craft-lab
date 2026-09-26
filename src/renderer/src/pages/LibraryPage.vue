<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DraftRecord, ProjectRecord } from '@shared/contracts'
import {
  CATALOG_ASSETS,
  createUnlockedAccess,
  DEFAULT_USER_ID,
  isAssetUnlocked,
  listCatalogThemes
} from '../catalog/ywn-catalog'
import {
  isAcceptanceAllThemesInEditorEnabled,
  prepareNewWorkScene
} from '../catalog/library-new-work'
import { openEditor } from '../app-nav'
import {
  AssetAccessStore,
  DraftStore,
  deleteExistingProject,
  FavoriteStore,
  getFeltCraftDatabase,
  ProjectStore
} from '../persistence'
import ProjectPreviewModal from '../components/library/ProjectPreviewModal.vue'
import { friendlyRelativeTime } from '../util/friendly-time'

const drafts = ref<DraftRecord[]>([])
const projects = ref<ProjectRecord[]>([])
const favorites = ref<string[]>([])
const unlockedIds = ref<Set<string>>(new Set())
const message = ref('')
const busy = ref(false)
const themeFilter = ref<string>('all')
const newWorkName = ref('我的新作品')
const acceptanceAllThemesInEditor = isAcceptanceAllThemesInEditorEnabled(
  import.meta.env.VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR
)
const confirmDelete = ref<
  | { kind: 'draft'; record: DraftRecord }
  | { kind: 'project'; record: ProjectRecord }
  | null
>(null)
const previewProject = ref<ProjectRecord | null>(null)
const previewOpen = ref(false)

const themes = listCatalogThemes()
const visibleAssets = computed(() => {
  if (themeFilter.value === 'all') return CATALOG_ASSETS
  return CATALOG_ASSETS.filter((asset) => asset.themeId === themeFilter.value)
})

async function refreshLists(): Promise<void> {
  const db = getFeltCraftDatabase()
  drafts.value = await new DraftStore(db).list()
  projects.value = await new ProjectStore(db).list()
  favorites.value = (await new FavoriteStore(db).listForUser(DEFAULT_USER_ID)).map((row) => row.assetId)
  const accessRows = await new AssetAccessStore(db).listForUser(DEFAULT_USER_ID)
  unlockedIds.value = new Set(accessRows.filter((row) => isAssetUnlocked(row)).map((row) => row.assetId))
}

async function startNewWork(): Promise<void> {
  message.value = ''
  const prepared = prepareNewWorkScene(newWorkName.value, themeFilter.value, {
    allowAllThemes: acceptanceAllThemesInEditor
  })
  if (!prepared.scene) {
    message.value = prepared.message
    return
  }

  busy.value = true
  try {
    openEditor({
      mode: 'new',
      scene: prepared.scene
    })
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

function openDraft(draft: DraftRecord): void {
  openEditor({ mode: 'draft', scene: draft.scene, draftId: draft.draftId })
}

function openProject(project: ProjectRecord): void {
  openEditor({ mode: 'project', scene: project.scene, projectId: project.projectId })
}

function continueProject(project: ProjectRecord): void {
  openEditor({ mode: 'project', scene: project.scene, projectId: project.projectId })
}

function askRemoveDraft(draft: DraftRecord): void {
  confirmDelete.value = { kind: 'draft', record: draft }
}

function askRemoveProject(project: ProjectRecord): void {
  confirmDelete.value = { kind: 'project', record: project }
}

function cancelRemove(): void {
  confirmDelete.value = null
}

async function confirmRemoveNow(): Promise<void> {
  const target = confirmDelete.value
  if (!target) return
  busy.value = true
  message.value = ''
  try {
    if (target.kind === 'draft') {
      await new DraftStore(getFeltCraftDatabase()).delete(target.record.draftId)
      message.value = '已删除草稿'
    } else {
      await deleteExistingProject(target.record.projectId)
      message.value = '已删除作品'
    }
    confirmDelete.value = null
    await refreshLists()
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

function showProjectPreview(project: ProjectRecord): void {
  previewProject.value = project
  previewOpen.value = true
}

function closeProjectPreview(): void {
  previewOpen.value = false
  previewProject.value = null
}

function openProjectFromPreview(project: ProjectRecord): void {
  previewOpen.value = false
  previewProject.value = null
  openEditor({ mode: 'project', scene: project.scene, projectId: project.projectId })
}

function draftLabel(draft: DraftRecord): string {
  return draft.scene.workName?.trim() || '未命名草稿'
}

function projectLabel(project: ProjectRecord): string {
  return project.projectName?.trim() || '未命名作品'
}

async function toggleFavorite(assetId: string): Promise<void> {
  const store = new FavoriteStore(getFeltCraftDatabase())
  if (favorites.value.includes(assetId)) {
    await store.delete(DEFAULT_USER_ID, assetId)
  } else {
    await store.save({
      userId: DEFAULT_USER_ID,
      assetId,
      createdAt: new Date().toISOString()
    })
  }
  await refreshLists()
}

const allowTestUnlock = import.meta.env.DEV

async function unlockForTest(assetId: string): Promise<void> {
  if (!allowTestUnlock) return
  busy.value = true
  message.value = ''
  try {
    await new AssetAccessStore(getFeltCraftDatabase()).save(createUnlockedAccess(assetId))
    message.value = `已测试解锁：${assetId}`
    await refreshLists()
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refreshLists()
})

const stopRefresh = window.setInterval(() => {
  void refreshLists()
}, 4000)

onUnmounted(() => {
  window.clearInterval(stopRefresh)
})
</script>

<template>
  <section class="library">
    <div class="library-scroll">
      <header class="section-head">
        <div>
          <h2>我的创作</h2>
          <p class="muted">继续做以前的草稿，看看自己已经完成的作品。</p>
        </div>
      </header>

      <section class="creation-cluster" aria-label="我的创作">
        <div class="creation-cluster-toolbar">
          <label class="creation-cluster-name">
            新作品名
            <input v-model="newWorkName" type="text" maxlength="40" />
          </label>
          <label class="creation-cluster-theme">
            主题
            <select v-model="themeFilter">
              <option value="all">全部</option>
              <option v-for="theme in themes" :key="theme" :value="theme">{{ theme }}</option>
            </select>
          </label>
          <button type="button" class="primary new-work-button" :disabled="busy" @click="startNewWork">
            新建作品
          </button>
        </div>

        <div class="creation-row">
          <section class="creation-card-list" aria-label="继续制作">
            <header class="creation-card-list-head">
              <h3>继续制作</h3>
              <span class="creation-card-list-count">{{ drafts.length }} 件</span>
            </header>
            <p v-if="drafts.length === 0" class="creation-empty">还没有草稿，新建一件作品开始吧。</p>
            <ul v-else class="creation-cards">
              <li v-for="draft in drafts" :key="draft.draftId" class="creation-card">
                <div class="creation-card-body">
                  <h4 class="creation-card-title">{{ draftLabel(draft) }}</h4>
                  <p class="creation-card-meta">{{ friendlyRelativeTime(draft.updatedAt) }} · 草稿</p>
                </div>
                <div class="creation-card-actions">
                  <button type="button" class="primary" :disabled="busy" @click="openDraft(draft)">继续制作</button>
                  <button type="button" class="ghost" :disabled="busy" @click="askRemoveDraft(draft)">删除</button>
                </div>
              </li>
            </ul>
          </section>

          <section class="creation-card-list" aria-label="我的作品">
            <header class="creation-card-list-head">
              <h3>我的作品</h3>
              <span class="creation-card-list-count">{{ projects.length }} 件</span>
            </header>
            <p v-if="projects.length === 0" class="creation-empty">还没有作品，完成第一件吧。</p>
            <ul v-else class="creation-cards creation-cards-projects">
              <li v-for="project in projects" :key="project.projectId" class="creation-card creation-card-project">
                <button
                  v-if="project.previewUrl"
                  type="button"
                  class="creation-card-thumb"
                  :aria-label="`预览 ${projectLabel(project)}`"
                  @click="showProjectPreview(project)"
                >
                  <img :src="project.previewUrl" :alt="projectLabel(project)" />
                </button>
                <div v-else class="creation-card-thumb creation-card-thumb-empty" aria-hidden="true">—</div>
                <div class="creation-card-body">
                  <h4 class="creation-card-title">{{ projectLabel(project) }}</h4>
                  <p class="creation-card-meta">{{ friendlyRelativeTime(project.updatedAt) }} · 作品</p>
                  <div class="creation-card-actions">
                    <button type="button" class="primary" :disabled="busy" @click="continueProject(project)">打开作品</button>
                    <button type="button" class="ghost" :disabled="busy" @click="showProjectPreview(project)">预览</button>
                    <button type="button" class="ghost" :disabled="busy" @click="askRemoveProject(project)">删除</button>
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </section>

      <p v-if="message" class="error">{{ message }}</p>

      <section class="material-library" aria-label="素材库">
        <header class="section-head section-head-secondary">
          <div>
            <h2>素材库</h2>
            <p class="muted">挑一个喜欢的素材，等开始做作品时再放进画布。</p>
          </div>
        </header>

        <div class="asset-grid">
          <article v-for="asset in visibleAssets" :key="asset.assetId" class="asset-card">
            <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.nameZh" width="96" height="96" />
            <div>
              <h3>{{ asset.nameZh }}</h3>
              <p>
                {{ unlockedIds.has(asset.assetId) ? '已解锁' : '锁定' }}
              </p>
              <div class="actions">
                <button type="button" class="ghost" @click="toggleFavorite(asset.assetId)">
                  {{ favorites.includes(asset.assetId) ? '取消收藏' : '收藏' }}
                </button>
                <button
                  v-if="allowTestUnlock && !unlockedIds.has(asset.assetId)"
                  type="button"
                  class="ghost"
                  :disabled="busy"
                  @click="unlockForTest(asset.assetId)"
                >
                  测试解锁
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-if="confirmDelete" class="confirm-backdrop" role="presentation" @click.self="cancelRemove">
      <div class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="confirmDelete.kind === 'draft' ? '删除草稿' : '删除作品'">
        <h3>
          {{ confirmDelete.kind === 'draft' ? '确定要删掉这个草稿吗？' : '确定要删掉这件作品吗？' }}
        </h3>
        <p class="muted">
          {{ confirmDelete.kind === 'draft' ? draftLabel(confirmDelete.record) : projectLabel(confirmDelete.record) }}
        </p>
        <p class="muted">删掉之后就不能再找回来了。</p>
        <div class="confirm-actions">
          <button type="button" class="ghost" :disabled="busy" @click="cancelRemove">再想想</button>
          <button type="button" class="danger" :disabled="busy" @click="confirmRemoveNow">确定删除</button>
        </div>
      </div>
    </div>

    <ProjectPreviewModal
      :project="previewProject"
      :open="previewOpen"
      @close="closeProjectPreview"
      @open="openProjectFromPreview"
    />
  </section>
</template>

<style scoped>
.library {
  display: block;
}

.library-scroll {
  display: grid;
  gap: 32px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  padding: 4px 8px 32px;
  scrollbar-gutter: stable;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.section-head h2 {
  margin: 0 0 6px;
  font-size: 1.6rem;
}

.section-head p,
.muted {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.section-head-secondary h2 {
  font-size: 1.3rem;
}

.creation-cluster {
  display: grid;
  gap: 18px;
  padding: 20px;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #c5d5d0);
  border-radius: 24px;
  box-shadow: 0 2px 12px rgba(22, 48, 43, 0.06);
}

.creation-cluster-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(160px, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.creation-cluster-name,
.creation-cluster-theme {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 0.85rem;
}

.creation-cluster-name input,
.creation-cluster-theme select {
  padding: 8px 10px;
  border: 1px solid var(--line, #c5d5d0);
  background: #fff;
  border-radius: 12px;
  font: inherit;
}

.new-work-button {
  height: 40px;
  padding: 0 18px;
  border-radius: 12px;
}

.creation-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.creation-card-list {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: var(--paper, #eef4f2);
  border: 1px solid var(--line, #c5d5d0);
  border-radius: 20px;
  min-height: 180px;
}

.creation-card-list-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.creation-card-list-head h3 {
  margin: 0;
  font-size: 1.05rem;
}

.creation-card-list-count {
  font-size: 0.85rem;
  color: var(--muted);
}

.creation-empty {
  margin: auto;
  color: var(--muted);
  font-size: 0.95rem;
  text-align: center;
  padding: 24px 8px;
}

.creation-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.creation-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--line, #c5d5d0);
  border-radius: 16px;
}

.creation-card-title {
  margin: 0 0 2px;
  font-size: 1rem;
  font-weight: 600;
}

.creation-card-meta {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.creation-card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.creation-card-actions button {
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 0.9rem;
}

.creation-cards-projects .creation-card {
  grid-template-columns: 72px 1fr;
  align-items: stretch;
}

.creation-card-thumb {
  width: 72px;
  height: 72px;
  border: 1px solid var(--line, #c5d5d0);
  background: #fff;
  border-radius: 14px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  appearance: none;
}

.creation-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.creation-card-thumb-empty {
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 1.4rem;
  background: var(--paper, #eef4f2);
  cursor: default;
}

.creation-card-project .creation-card-body {
  display: grid;
  gap: 6px;
  align-content: start;
}

.creation-card-project .creation-card-actions {
  justify-content: flex-start;
}

.material-library {
  display: grid;
  gap: 16px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.asset-card {
  display: flex;
  gap: 14px;
  padding: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
}

.asset-card img {
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
}

.asset-card h3 {
  margin: 0 0 4px;
  font-size: 1rem;
}

.asset-card p {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.error {
  margin: 0;
  color: var(--danger, #9b2c2c);
}

.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(89, 71, 56, 0.45);
  display: grid;
  place-items: center;
  z-index: 50;
}

.confirm-dialog {
  background: #fff;
  border: 1px solid var(--line, #c5d5d0);
  border-radius: 20px;
  padding: 24px;
  width: min(90vw, 420px);
  display: grid;
  gap: 12px;
  box-shadow: 0 12px 32px rgba(89, 71, 56, 0.22);
}

.confirm-dialog h3 {
  margin: 0;
  font-size: 1.1rem;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button.danger {
  background: var(--danger, #9b2c2c);
  border-color: var(--danger, #9b2c2c);
  color: #fff;
}

button.danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .creation-row {
    grid-template-columns: 1fr;
  }
  .creation-cluster-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
