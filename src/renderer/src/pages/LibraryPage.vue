<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DraftRecord, ProjectRecord } from '@shared/contracts'
import {
  ALL_THEMES_ID,
  CATALOG_ASSETS,
  createUnlockedAccess,
  DEFAULT_USER_ID,
  isAssetUnlocked,
  listCatalogThemes
} from '../catalog/ywn-catalog'
import { prepareNewWorkScene } from '../catalog/library-new-work'
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
import PsdFrameStage from '../components/shell/PsdFrameStage.vue'
import { friendlyRelativeTime } from '../util/friendly-time'
import { friendlyUserError, withDbRetry } from '../util/friendly-user-error'

const bookSpread = ref(0)

const drafts = ref<DraftRecord[]>([])
const projects = ref<ProjectRecord[]>([])
const favorites = ref<string[]>([])
const unlockedIds = ref<Set<string>>(new Set())
const message = ref('')
const busy = ref(false)
const themeFilter = ref<string>(ALL_THEMES_ID)
const newWorkName = ref('我的新作品')
const confirmDelete = ref<
  | { kind: 'draft'; record: DraftRecord }
  | { kind: 'project'; record: ProjectRecord }
  | null
>(null)
const previewProject = ref<ProjectRecord | null>(null)
const previewOpen = ref(false)

const themes = listCatalogThemes()
const visibleAssets = computed(() => {
  if (themeFilter.value === ALL_THEMES_ID) return CATALOG_ASSETS
  return CATALOG_ASSETS.filter((asset) => asset.themeId === themeFilter.value)
})

const leftAssets = computed(() => {
  const half = Math.ceil(visibleAssets.value.length / 2)
  return visibleAssets.value.slice(0, half)
})

const rightAssets = computed(() => {
  const half = Math.ceil(visibleAssets.value.length / 2)
  return visibleAssets.value.slice(half)
})

function prevBookSpread(): void {
  bookSpread.value = 0
}

function nextBookSpread(): void {
  bookSpread.value = 1
}

async function refreshLists(): Promise<void> {
  try {
    await withDbRetry(async () => {
      const db = getFeltCraftDatabase()
      drafts.value = await new DraftStore(db).list()
      projects.value = await new ProjectStore(db).list()
      favorites.value = (await new FavoriteStore(db).listForUser(DEFAULT_USER_ID)).map((row) => row.assetId)
      const accessRows = await new AssetAccessStore(db).listForUser(DEFAULT_USER_ID)
      unlockedIds.value = new Set(accessRows.filter((row) => isAssetUnlocked(row)).map((row) => row.assetId))
    })
  } catch (error) {
    message.value = friendlyUserError(error)
  }
}

async function startNewWork(): Promise<void> {
  message.value = ''
  const prepared = prepareNewWorkScene(newWorkName.value, themeFilter.value)
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
    message.value = friendlyUserError(error)
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
    message.value = friendlyUserError(error)
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
  return draft.scene.workName?.trim() || '我的新作品'
}

function projectLabel(project: ProjectRecord): string {
  return project.projectName?.trim() || '我的作品'
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
    message.value = friendlyUserError(error)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refreshLists()
})

onUnmounted(() => {
  /* no background polling — reduces UI jank */
})
</script>

<template>
  <section class="library">
    <PsdFrameStage frame="book" :clip-overflow="false">
      <div class="book-spread">
        <template v-if="bookSpread === 0">
          <div class="book-page book-page--left">
            <header class="book-page-head">
              <h2>继续制作</h2>
              <span class="book-page-count">{{ drafts.length }} 件</span>
            </header>

            <div class="book-toolbar">
              <label class="book-field">
                新作品名
                <input v-model="newWorkName" class="text-box-field" type="text" maxlength="40" />
              </label>
              <label class="book-field">
                主题
                <select v-model="themeFilter" class="text-box-field">
                  <option value="all">全部</option>
                  <option v-for="theme in themes" :key="theme" :value="theme">{{ theme }}</option>
                </select>
              </label>
              <button type="button" class="primary" :disabled="busy" @click="startNewWork">新建作品</button>
            </div>

            <p v-if="drafts.length === 0" class="book-empty">还没有草稿，新建一件作品开始吧。</p>
            <ul v-else class="book-list">
              <li v-for="draft in drafts" :key="draft.draftId" class="book-item text-box-surface">
                <div>
                  <h4>{{ draftLabel(draft) }}</h4>
                  <p class="muted">{{ friendlyRelativeTime(draft.updatedAt) }} · 草稿</p>
                </div>
                <div class="book-item-actions">
                  <button type="button" class="primary" :disabled="busy" @click="openDraft(draft)">继续</button>
                  <button type="button" class="ghost" :disabled="busy" @click="askRemoveDraft(draft)">删除</button>
                </div>
              </li>
            </ul>
          </div>

          <div class="book-page book-page--right">
            <header class="book-page-head">
              <h2>我的作品</h2>
              <span class="book-page-count">{{ projects.length }} 件</span>
            </header>

            <p v-if="projects.length === 0" class="book-empty">还没有作品，完成第一件吧。</p>
            <ul v-else class="book-list">
              <li v-for="project in projects" :key="project.projectId" class="book-item book-item-project text-box-surface">
                <button
                  v-if="project.previewUrl"
                  type="button"
                  class="book-item-thumb"
                  :aria-label="`预览 ${projectLabel(project)}`"
                  @click="showProjectPreview(project)"
                >
                  <img :src="project.previewUrl" :alt="projectLabel(project)" />
                </button>
                <div v-else class="book-item-thumb book-item-thumb-empty" aria-hidden="true">—</div>
                <div class="book-item-body">
                  <h4>{{ projectLabel(project) }}</h4>
                  <p class="muted">{{ friendlyRelativeTime(project.updatedAt) }} · 作品</p>
                  <div class="book-item-actions">
                    <button type="button" class="primary" :disabled="busy" @click="continueProject(project)">打开</button>
                    <button type="button" class="ghost" :disabled="busy" @click="showProjectPreview(project)">预览</button>
                    <button type="button" class="ghost" :disabled="busy" @click="askRemoveProject(project)">删除</button>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </template>

        <template v-else>
          <div class="book-page book-page--left">
            <header class="book-page-head">
              <h2>素材库</h2>
              <p class="muted">左页</p>
            </header>
            <div class="book-asset-grid">
              <article v-for="asset in leftAssets" :key="asset.assetId" class="asset-card">
                <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.nameZh" width="72" height="72" />
                <div>
                  <h3>{{ asset.nameZh }}</h3>
                  <p>{{ unlockedIds.has(asset.assetId) ? '已解锁' : '锁定' }}</p>
                  <div class="actions">
                    <button type="button" class="ghost" @click="toggleFavorite(asset.assetId)">
                      {{ favorites.includes(asset.assetId) ? '取消收藏' : '收藏' }}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <div class="book-page book-page--right">
            <header class="book-page-head">
              <h2>素材库</h2>
              <p class="muted">右页</p>
            </header>
            <div class="book-asset-grid">
              <article v-for="asset in rightAssets" :key="asset.assetId" class="asset-card">
                <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.nameZh" width="72" height="72" />
                <div>
                  <h3>{{ asset.nameZh }}</h3>
                  <p>{{ unlockedIds.has(asset.assetId) ? '已解锁' : '锁定' }}</p>
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
          </div>
        </template>
      </div>

      <template #footer>
        <nav class="book-pager" aria-label="书本翻页">
          <button type="button" class="ghost" :disabled="bookSpread === 0" @click="prevBookSpread">上一页</button>
          <span class="book-pager-indicator">{{ bookSpread === 0 ? '我的创作' : '素材库' }}</span>
          <button type="button" class="ghost" :disabled="bookSpread === 1" @click="nextBookSpread">下一页</button>
        </nav>
        <p v-if="message" class="book-message error">{{ message }}</p>
      </template>
    </PsdFrameStage>

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
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

.library :deep(.psd-frame-stage__content),
.library :deep(.psd-frame-stage__footer),
.library .confirm-backdrop,
.library :deep(.project-preview-backdrop) {
  pointer-events: auto;
}

.library :deep(.psd-frame-stage__content) {
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.library :deep(.psd-frame-stage__footer) {
  overflow: visible;
}

.book-spread {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ui-library-page-gap, 40px);
  padding: var(--ui-library-page-inset, 0);
  box-sizing: border-box;
  overflow: visible;
}

.book-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: visible;
}

.book-page--left {
  transform: translate(
    var(--ui-library-page-left-offset-x, 0),
    var(--ui-library-page-left-offset-y, 0)
  );
}

.book-page--right {
  transform: translate(
    var(--ui-library-page-right-offset-x, 0),
    var(--ui-library-page-right-offset-y, 0)
  );
}

.book-page-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}

.book-page-head h2 {
  margin: 0;
  font-size: clamp(1rem, 1.6vw, 1.35rem);
}

.book-page-count {
  font-size: 0.85rem;
  color: var(--muted);
}

.muted {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.book-toolbar {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  align-items: stretch;
  flex-shrink: 0;
}

.book-toolbar .primary {
  width: 100%;
  justify-content: center;
}

.book-field {
  display: grid;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--muted);
}

.book-field .text-box-field {
  width: 100%;
}

.book-list,
.book-asset-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.book-list::-webkit-scrollbar,
.book-asset-grid::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.book-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
}

.book-item-project {
  grid-template-columns: 56px 1fr;
  align-items: stretch;
}

.book-item h4 {
  margin: 0 0 2px;
  font-size: 0.95rem;
}

.book-item-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.book-item-project .book-item-actions {
  justify-content: flex-start;
}

.book-item-actions button {
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 0.85rem;
}

.book-item-thumb {
  width: 56px;
  height: 56px;
  padding: 0;
  border: 3px solid var(--text-box-border, #d4a843);
  border-radius: 12px;
  overflow: hidden;
  background: var(--text-box-fill, #f5ecd8);
  cursor: pointer;
  appearance: none;
}

.book-item-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.book-item-thumb-empty {
  display: grid;
  place-items: center;
  color: var(--muted);
  cursor: default;
}

.book-item-body {
  display: grid;
  gap: 4px;
  align-content: start;
}

.book-empty {
  margin: auto;
  text-align: center;
  color: var(--muted);
  font-size: 0.9rem;
  padding: 16px 8px;
}

.asset-card {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
}

.asset-card img {
  flex-shrink: 0;
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
}

.asset-card h3 {
  margin: 0 0 4px;
  font-size: 0.95rem;
}

.asset-card p {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.book-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-shrink: 0;
  margin-top: var(--ui-library-pager-offset-y, 0);
}

.book-pager button {
  padding: 4px 10px;
  font-size: 0.8rem;
}

.book-pager-indicator {
  font-size: 0.85rem;
  color: var(--muted);
}

.book-message {
  margin: 0;
  text-align: center;
  flex-shrink: 0;
}

.error {
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
  padding: 24px 20px 20px;
  width: min(90vw, 420px);
  display: grid;
  gap: 12px;
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
  .book-spread {
    grid-template-columns: 1fr;
  }
}
</style>
