<script setup lang="ts">
import '../../styles/plaza-v2-detail-dialog.css'
import { ref } from 'vue'
import { showCenterToast } from '../../composables/center-toast'
import { PLAZA_V2_PERSONAL_DEMO_CARDS, type PlazaV2DemoCard } from '../../ui/plaza-v2-demo-cards'

const busy = ref(false)
const previewCard = ref<PlazaV2DemoCard | null>(null)
const previewOpen = ref(false)

const items = PLAZA_V2_PERSONAL_DEMO_CARDS

function continueItem(): void {
  showCenterToast('功能开发中')
}

function openProjection(_item: PlazaV2DemoCard): void {
  showCenterToast('展示功能开发中')
}

function previewItem(item: PlazaV2DemoCard): void {
  previewCard.value = item
  previewOpen.value = true
}

function askDelete(_item: PlazaV2DemoCard): void {
  showCenterToast('示例作品无法删除')
}

function askUpload(_item: PlazaV2DemoCard): void {
  showCenterToast('示例作品无法上传')
}

function withdraw(_item: PlazaV2DemoCard): void {
  showCenterToast('示例作品无法撤回')
}

function refreshLists(): void {
  // UI branch: fixed catalog-composed samples only.
}

defineExpose({ refresh: refreshLists })
</script>

<template>
  <div class="personal-panel">
    <ul class="personal-grid">
      <li v-for="item in items" :key="item.id">
        <article class="plaza-card text-box-surface personal-card">
          <button type="button" class="plaza-card__thumb" :aria-label="`预览 ${item.title}`" @click="previewItem(item)">
            <img :src="item.thumbUrl" :alt="item.title" />
          </button>
          <div class="plaza-card__body">
            <h3 class="plaza-v2-card-title">{{ item.title }}</h3>
            <p class="plaza-v2-card-meta muted">{{ item.meta }}</p>
            <div class="personal-card__actions">
              <button type="button" class="primary personal-card__primary" :disabled="busy" @click="continueItem">
                继续创作
              </button>
              <div class="personal-card__grid">
                <button type="button" class="ghost plaza-v2-action" :disabled="busy" @click="openProjection(item)">展示</button>
                <button
                  v-if="item.sampleKind === 'project'"
                  type="button"
                  class="ghost plaza-v2-action"
                  :disabled="busy"
                  @click="previewItem(item)"
                >
                  预览
                </button>
                <button type="button" class="ghost plaza-v2-action" :disabled="busy" @click="askDelete(item)">删除</button>
                <button
                  v-if="item.sampleKind === 'project' && !item.sharedToPublic"
                  type="button"
                  class="ghost plaza-v2-action"
                  :disabled="busy"
                  @click="askUpload(item)"
                >
                  上传
                </button>
                <button
                  v-else-if="item.sampleKind === 'project' && item.sharedToPublic"
                  type="button"
                  class="ghost plaza-v2-action"
                  disabled
                >
                  已分享
                </button>
              </div>
            </div>
          </div>
        </article>
      </li>
    </ul>

    <div v-if="previewOpen && previewCard" class="plaza-v2-detail-backdrop" role="presentation" @click.self="previewOpen = false">
      <div class="plaza-v2-detail-dialog text-box-surface" role="dialog" aria-modal="true">
        <h3 class="plaza-v2-card-title">{{ previewCard.title }}</h3>
        <p class="plaza-v2-card-meta muted">{{ previewCard.meta }}</p>
        <img class="plaza-v2-detail-dialog__img" :src="previewCard.thumbUrl" :alt="previewCard.title" />
        <button type="button" class="primary" @click="previewOpen = false">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.personal-panel {
  height: 100%;
}

.personal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
  margin: 0;
  padding: 4px 2px 12px;
  list-style: none;
}

.personal-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}

.plaza-card__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  margin-bottom: 12px;
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

.personal-card__actions {
  display: grid;
  gap: 10px;
  margin-top: 6px;
}

.personal-card__primary {
  width: fit-content;
  min-height: 48px;
  padding: 10px 20px;
  font-size: 1.28rem;
}

.personal-card__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.plaza-v2-action {
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 1.22rem;
}
</style>

<style>
.plaza-v2-card-title {
  margin: 0 0 8px;
  font-size: 1.65rem;
  line-height: 1.25;
}

.plaza-v2-card-meta {
  margin: 0 0 8px;
  font-size: 1.15rem;
  line-height: 1.35;
}
</style>
