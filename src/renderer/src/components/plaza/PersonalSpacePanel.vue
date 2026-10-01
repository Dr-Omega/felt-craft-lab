<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DraftRecord, ProjectRecord } from '@shared/contracts'
import { openProjectionWithScene } from '../../app-nav'
import { showCenterToast } from '../../composables/center-toast'
import ProjectPreviewModal from '../library/ProjectPreviewModal.vue'
import PlazaUploadDialog from './PlazaUploadDialog.vue'
import { DraftStore, deleteExistingProject, getFeltCraftDatabase, ProjectStore } from '../../persistence'
import { listMySharedProjectIds, publishPlazaPost, withdrawPlazaPost } from '../../services/plaza-api'
import { loadPlazaSession } from '../../services/plaza-session'
import { friendlyRelativeTime } from '../../util/friendly-time'
import { friendlyUserError, withDbRetry } from '../../util/friendly-user-error'

type PersonalDraft = { kind: 'draft'; record: DraftRecord }
type PersonalProject = { kind: 'project'; record: ProjectRecord }
type PersonalItem = PersonalDraft | PersonalProject

const drafts = ref<DraftRecord[]>([])
const projects = ref<ProjectRecord[]>([])
const sharedProjectIds = ref<Set<string>>(new Set())
const busy = ref(false)
const loading = ref(true)
const confirmDelete = ref<PersonalItem | null>(null)
const previewProject = ref<ProjectRecord | null>(null)
const previewOpen = ref(false)
const uploadTarget = ref<ProjectRecord | null>(null)
const uploadOpen = ref(false)

const items = computed<PersonalItem[]>(() => {
  const merged: PersonalItem[] = [
    ...drafts.value.map((record) => ({ kind: 'draft' as const, record })),
    ...projects.value.map((record) => ({ kind: 'project' as const, record }))
  ]
  return merged.sort((a, b) => {
    const at = a.kind === 'draft' ? a.record.updatedAt : a.record.updatedAt
    const bt = b.kind === 'draft' ? b.record.updatedAt : b.record.updatedAt
    return bt.localeCompare(at)
  })
})

function label(item: PersonalItem): string {
  if (item.kind === 'draft') return item.record.scene.workName?.trim() || '草稿'
  return item.record.projectName?.trim() || '我的作品'
}

function meta(item: PersonalItem): string {
  const time = item.kind === 'draft' ? item.record.updatedAt : item.record.updatedAt
  const suffix = item.kind === 'draft' ? '草稿' : '作品'
  return `${friendlyRelativeTime(time)} · ${suffix}`
}

function thumbUrl(item: PersonalItem): string | undefined {
  if (item.kind === 'project') return item.record.previewUrl
  return undefined
}

function isShared(project: ProjectRecord): boolean {
  return sharedProjectIds.value.has(project.projectId)
}

async function refreshSharedProjectIds(): Promise<void> {
  const session = loadPlazaSession()
  if (!session?.token) {
    sharedProjectIds.value = new Set()
    return
  }
  try {
    sharedProjectIds.value = new Set(await listMySharedProjectIds(session.token))
  } catch {
    sharedProjectIds.value = new Set()
  }
}

async function refreshLists(): Promise<void> {
  loading.value = true
  try {
    await withDbRetry(async () => {
      const db = getFeltCraftDatabase()
      drafts.value = await new DraftStore(db).list()
      projects.value = await new ProjectStore(db).list()
    })
    await refreshSharedProjectIds()
  } catch (error) {
    showCenterToast(friendlyUserError(error))
  } finally {
    loading.value = false
  }
}

function continueItem(): void {
  showCenterToast('功能开发中')
}

function openProjection(item: PersonalItem): void {
  const scene = item.kind === 'draft' ? item.record.scene : item.record.scene
  openProjectionWithScene({
    scene,
    sourceLabel: item.kind === 'draft' ? `草稿 · ${label(item)}` : `作品 · ${label(item)}`
  })
}

function previewItem(item: PersonalItem): void {
  if (item.kind !== 'project') return
  previewProject.value = item.record
  previewOpen.value = true
}

function askDelete(item: PersonalItem): void {
  confirmDelete.value = item
}

function cancelDelete(): void {
  confirmDelete.value = null
}

async function confirmDeleteNow(): Promise<void> {
  const target = confirmDelete.value
  if (!target) return
  busy.value = true
  try {
    if (target.kind === 'draft') {
      await new DraftStore(getFeltCraftDatabase()).delete(target.record.draftId)
      showCenterToast('已删除草稿')
    } else {
      await deleteExistingProject(target.record.projectId)
      showCenterToast('已删除作品')
    }
    confirmDelete.value = null
    await refreshLists()
  } catch (error) {
    showCenterToast(friendlyUserError(error))
  } finally {
    busy.value = false
  }
}

function askUpload(project: ProjectRecord): void {
  if (!project.previewUrl) {
    showCenterToast('请先保存带预览图的作品后再上传。')
    return
  }
  if (isShared(project)) return
  uploadTarget.value = project
  uploadOpen.value = true
}

function cancelUpload(): void {
  uploadOpen.value = false
  uploadTarget.value = null
}

async function confirmUpload(title: string): Promise<void> {
  const project = uploadTarget.value
  const session = loadPlazaSession()
  if (!project?.previewUrl || !session?.token) {
    showCenterToast('请先登录后再上传。')
    return
  }
  busy.value = true
  try {
    await publishPlazaPost({
      token: session.token,
      projectId: project.projectId,
      title,
      previewRef: project.previewUrl
    })
    showCenterToast('已上传到公共空间')
    uploadOpen.value = false
    uploadTarget.value = null
    await refreshSharedProjectIds()
  } catch (error) {
    showCenterToast(friendlyUserError(error))
  } finally {
    busy.value = false
  }
}

async function withdrawProject(project: ProjectRecord): Promise<void> {
  const session = loadPlazaSession()
  if (!session?.token) {
    showCenterToast('请先登录后再操作。')
    return
  }
  busy.value = true
  try {
    await withdrawPlazaPost(session.token, project.projectId)
    showCenterToast('已从公共空间撤回')
    await refreshSharedProjectIds()
  } catch (error) {
    showCenterToast(friendlyUserError(error))
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refreshLists()
})

defineExpose({ refresh: refreshLists })
</script>

<template>
  <div class="personal-panel">
    <p v-if="loading" class="personal-empty">加载中…</p>
    <p v-else-if="items.length === 0" class="personal-empty">还没有草稿或作品，等功能开放后从这里继续创作吧。</p>
    <ul v-else class="personal-grid">
      <li v-for="item in items" :key="item.kind === 'draft' ? item.record.draftId : item.record.projectId">
        <article class="plaza-card text-box-surface personal-card">
          <button
            v-if="item.kind === 'project' && item.record.previewUrl"
            type="button"
            class="plaza-card__thumb"
            :aria-label="`预览 ${label(item)}`"
            @click="previewItem(item)"
          >
            <img :src="item.record.previewUrl" :alt="label(item)" />
          </button>
          <div v-else class="plaza-card__thumb plaza-card__thumb--empty" aria-hidden="true">
            <span class="muted">{{ item.kind === 'draft' ? '草稿' : '—' }}</span>
          </div>
          <div class="plaza-card__body">
            <h3>{{ label(item) }}</h3>
            <p class="muted">{{ meta(item) }}</p>
            <div class="personal-card__actions">
              <button type="button" class="primary personal-card__primary" :disabled="busy" @click="continueItem">
                继续创作
              </button>
              <div class="personal-card__grid">
                <button type="button" class="ghost" :disabled="busy" @click="openProjection(item)">展示</button>
                <button
                  v-if="item.kind === 'project'"
                  type="button"
                  class="ghost"
                  :disabled="busy"
                  @click="previewItem(item)"
                >
                  预览
                </button>
                <button type="button" class="ghost" :disabled="busy" @click="askDelete(item)">删除</button>
                <button
                  v-if="item.kind === 'project' && !isShared(item.record)"
                  type="button"
                  class="ghost"
                  :disabled="busy || !item.record.previewUrl"
                  @click="askUpload(item.record)"
                >
                  上传
                </button>
                <button
                  v-else-if="item.kind === 'project' && isShared(item.record)"
                  type="button"
                  class="ghost"
                  :disabled="busy"
                  @click="withdrawProject(item.record)"
                >
                  撤回
                </button>
              </div>
            </div>
          </div>
        </article>
      </li>
    </ul>

    <div v-if="confirmDelete" class="personal-confirm-backdrop" role="presentation" @click.self="cancelDelete">
      <div class="personal-confirm text-box-surface" role="dialog" aria-modal="true">
        <h3>确定要删除吗？</h3>
        <p class="muted">{{ label(confirmDelete) }}</p>
        <div class="personal-confirm__actions">
          <button type="button" class="ghost" :disabled="busy" @click="cancelDelete">取消</button>
          <button type="button" class="primary" :disabled="busy" @click="confirmDeleteNow">删除</button>
        </div>
      </div>
    </div>

    <ProjectPreviewModal
      :open="previewOpen"
      :project="previewProject"
      @close="previewOpen = false"
      @open="continueItem"
    />

    <PlazaUploadDialog
      :open="uploadOpen"
      :default-title="uploadTarget ? uploadTarget.projectName?.trim() || '我的作品' : ''"
      :busy="busy"
      @close="cancelUpload"
      @confirm="confirmUpload"
    />
  </div>
</template>

<style scoped>
.personal-panel {
  height: 100%;
}

.personal-empty {
  margin: 24px;
  text-align: center;
  color: var(--muted);
}

.personal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 4px 2px 12px;
  list-style: none;
}

.personal-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px;
}

.plaza-card__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  margin-bottom: 10px;
  padding: 0;
  border: 3px solid var(--text-box-border, #d4a843);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.5);
  cursor: pointer;
}

.plaza-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.plaza-card__thumb--empty {
  cursor: default;
}

.plaza-card__body h3 {
  margin: 0 0 6px;
  font-size: 18px;
}

.personal-card__actions {
  display: grid;
  gap: 8px;
  margin-top: 4px;
}

.personal-card__primary {
  width: fit-content;
  padding: 6px 12px;
  font-size: 0.9rem;
}

.personal-card__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.personal-card__grid button {
  padding: 6px 8px;
  border-radius: 10px;
  font-size: 0.82rem;
}

.personal-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  background: rgba(89, 71, 56, 0.35);
}

.personal-confirm {
  width: min(420px, 92vw);
  padding: 20px;
}

.personal-confirm h3 {
  margin: 0 0 8px;
}

.personal-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
