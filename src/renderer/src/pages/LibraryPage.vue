<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DraftRecord, ProjectRecord } from '@shared/contracts'
import {
  CATALOG_ASSETS,
  createUnlockedAccess,
  DEFAULT_USER_ID,
  isAssetUnlocked,
  listCatalogThemes,
  YWN_SNAPSHOT_ID
} from '../catalog/ywn-catalog'
import {
  isAcceptanceAllThemesInEditorEnabled,
  prepareNewWorkScene
} from '../catalog/library-new-work'
import { openEditor } from '../app-nav'
import {
  AssetAccessStore,
  DraftStore,
  FavoriteStore,
  deleteExistingProject,
  getFeltCraftDatabase,
  ProjectStore
} from '../persistence'

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

async function removeProject(project: ProjectRecord): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    await deleteExistingProject(project.projectId)
    message.value = `已删除作品：${project.projectId}`
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
    <header class="section-head">
      <div>
        <h2>素材库</h2>
        <p>
          正式 Manifest：{{ CATALOG_ASSETS.length }} 条 ready · snapshot
          <code>{{ YWN_SNAPSHOT_ID }}</code>
        </p>
        <p class="muted">
          默认锁定。可浏览/收藏；加入画布需要已解锁的 AssetAccess。
          <template v-if="allowTestUnlock">开发模式可使用「测试解锁」。</template>
        </p>
      </div>
      <div class="new-work">
        <label>
          新作品名
          <input v-model="newWorkName" type="text" maxlength="40" />
        </label>
        <button type="button" class="primary" :disabled="busy" @click="startNewWork">新建作品</button>
      </div>
    </header>

    <label class="filter">
      主题
      <select v-model="themeFilter">
        <option value="all">全部</option>
        <option v-for="theme in themes" :key="theme" :value="theme">{{ theme }}</option>
      </select>
    </label>

    <p v-if="message" class="error">{{ message }}</p>

    <div class="asset-grid">
      <article v-for="asset in visibleAssets" :key="asset.assetId" class="asset-card">
        <img :src="asset.thumbnailUrl || asset.imageUrl" :alt="asset.nameZh" width="96" height="96" />
        <div>
          <h3>{{ asset.nameZh }}</h3>
          <p>
            {{ asset.type }} · {{ asset.themeId }} ·
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

    <div class="lists">
      <section>
        <h3>本地草稿</h3>
        <p v-if="drafts.length === 0" class="muted">暂无草稿</p>
        <ul>
          <li v-for="draft in drafts" :key="draft.draftId">
            <button type="button" class="linkish" @click="openDraft(draft)">
              {{ draft.scene.workName }} · {{ draft.updatedAt }}
            </button>
          </li>
        </ul>
      </section>
      <section>
        <h3>本地作品</h3>
        <p v-if="projects.length === 0" class="muted">暂无作品</p>
        <ul>
          <li v-for="project in projects" :key="project.projectId" class="project-row">
            <button type="button" class="linkish" @click="openProject(project)">
              {{ project.projectName }} · {{ project.syncStatus }}
            </button>
            <img
              v-if="project.previewUrl"
              class="preview"
              :src="project.previewUrl"
              :alt="project.projectName"
              width="48"
              height="48"
            />
            <button type="button" class="ghost" :disabled="busy" @click="removeProject(project)">删除</button>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.library {
  display: grid;
  gap: 28px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.section-head h2 {
  margin: 0 0 6px;
}

.section-head p,
.muted {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.new-work {
  display: grid;
  gap: 8px;
  justify-items: end;
}

.new-work label {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 0.85rem;
}

.new-work input {
  min-width: 180px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: #fff;
}

.filter {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--muted);
}

.filter select {
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: #fff;
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
}

.asset-card img,
.preview {
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--line);
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

.lists {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.lists ul {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.lists li + li {
  margin-top: 8px;
}

.project-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.error {
  color: var(--danger);
}

code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.85em;
}

@media (max-width: 720px) {
  .section-head,
  .lists {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .new-work {
    justify-items: stretch;
  }
}
</style>
