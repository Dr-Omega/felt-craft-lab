<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PersonalSpacePanel from '../components/plaza/PersonalSpacePanel.vue'
import PlazaPostDetailModal from '../components/plaza/PlazaPostDetailModal.vue'
import { showCenterToast } from '../composables/center-toast'
import { listPlazaPosts, loadPlazaPreviewUrl } from '../services/plaza-api'
import { ensureDevPlazaSession } from '../services/plaza-dev-bootstrap'
import { loadPlazaSession } from '../services/plaza-session'
import { friendlyShortDate } from '../util/friendly-time'
import {
  plazaV2Assets,
  plazaV2ContentSlotStyle,
  plazaV2FullLayerStyle,
  plazaV2HitBoxStyle
} from '../ui/plaza-v2-assets'

type ShareTab = 'public' | 'personal'

const activeTab = ref<ShareTab>('public')
const posts = ref<PlazaPost[]>([])
const previewCache = ref<Record<string, string>>({})
const loading = ref(true)
const listLoadedOk = ref(false)
const detailPost = ref<PlazaPost | null>(null)
const detailOpen = ref(false)
const detailPreview = ref('')
const personalRef = ref<InstanceType<typeof PersonalSpacePanel> | null>(null)

const publicTabHit = plazaV2HitBoxStyle('public-tab')
const personalTabHit = plazaV2HitBoxStyle('personal-tab')
const backHit = plazaV2HitBoxStyle('back-button')

const publicTabLayerClass = computed(() =>
  activeTab.value === 'public' ? 'plaza-v2-tab-layer plaza-v2-tab-layer--active' : 'plaza-v2-tab-layer plaza-v2-tab-layer--idle'
)
const personalTabLayerClass = computed(() =>
  activeTab.value === 'personal' ? 'plaza-v2-tab-layer plaza-v2-tab-layer--active' : 'plaza-v2-tab-layer plaza-v2-tab-layer--idle'
)

function currentSession() {
  return loadPlazaSession()
}

async function refreshPosts(): Promise<void> {
  const session = currentSession()
  if (!session?.token) return
  loading.value = true
  listLoadedOk.value = false
  try {
    posts.value = await listPlazaPosts(session.token)
    listLoadedOk.value = true
    await preloadThumbnails(session.token, posts.value)
  } catch {
    posts.value = []
    listLoadedOk.value = false
  } finally {
    loading.value = false
  }
}

async function preloadThumbnails(token: string, items: PlazaPost[]): Promise<void> {
  const next: Record<string, string> = { ...previewCache.value }
  for (const post of items) {
    if (next[post.postId]) continue
    try {
      next[post.postId] = await loadPlazaPreviewUrl(token, post.previewMediaPath)
    } catch {
      // keep placeholder
    }
  }
  previewCache.value = next
}

async function openDetail(post: PlazaPost): Promise<void> {
  const session = currentSession()
  if (!session?.token) return
  detailPost.value = post
  detailOpen.value = true
  detailPreview.value = previewCache.value[post.postId] ?? ''
  if (!detailPreview.value) {
    try {
      detailPreview.value = await loadPlazaPreviewUrl(session.token, post.previewMediaPath)
      previewCache.value = { ...previewCache.value, [post.postId]: detailPreview.value }
    } catch {
      // ignore
    }
  }
}

function closeDetail(): void {
  detailOpen.value = false
  detailPost.value = null
  detailPreview.value = ''
}

function selectTab(tab: ShareTab): void {
  if (activeTab.value === tab) return
  activeTab.value = tab
  if (tab === 'personal') {
    void personalRef.value?.refresh?.()
  }
}

function onBack(): void {
  showCenterToast('功能开发中')
}

onMounted(async () => {
  await ensureDevPlazaSession()
  if (!currentSession()?.token) {
    showCenterToast('开发登录失败，请确认 backend 已启动（8788）')
    return
  }
  void refreshPosts()
})
</script>

<template>
  <AuthArtboard>
    <!-- z0 大背景 -->
    <img
      class="plaza-v2-layer plaza-v2-layer--z0"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.baseBackground"
      alt=""
      aria-hidden="true"
    />
    <!-- z1 公共空间背景 -->
    <img
      v-show="activeTab === 'public'"
      class="plaza-v2-layer plaza-v2-layer--z1"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.publicBackground"
      alt=""
      aria-hidden="true"
    />
    <!-- z2 个人空间背景 -->
    <img
      v-show="activeTab === 'personal'"
      class="plaza-v2-layer plaza-v2-layer--z2"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.personalBackground"
      alt=""
      aria-hidden="true"
    />
    <!-- z3 展示框 -->
    <img
      class="plaza-v2-layer plaza-v2-layer--z3"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.showcaseFrame"
      alt=""
      aria-hidden="true"
    />
    <!-- z4 公共 tab 装饰层 -->
    <img
      :class="publicTabLayerClass"
      class="plaza-v2-layer plaza-v2-layer--z4"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.publicTab"
      alt=""
      aria-hidden="true"
    />
    <!-- z5 个人 tab 装饰层 -->
    <img
      :class="personalTabLayerClass"
      class="plaza-v2-layer plaza-v2-layer--z5"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.personalTab"
      alt=""
      aria-hidden="true"
    />

    <button
      type="button"
      class="plaza-v2-hit plaza-v2-hit--public-tab"
      :style="publicTabHit"
      :aria-pressed="activeTab === 'public'"
      aria-label="公共空间"
      @click="selectTab('public')"
    />
    <button
      type="button"
      class="plaza-v2-hit plaza-v2-hit--personal-tab"
      :style="personalTabHit"
      :aria-pressed="activeTab === 'personal'"
      aria-label="个人空间"
      @click="selectTab('personal')"
    />

    <section class="plaza-v2-content-slot" :style="plazaV2ContentSlotStyle" :aria-label="activeTab === 'public' ? '公共空间作品' : '个人空间作品'">
      <template v-if="activeTab === 'public'">
        <p v-if="loading" class="plaza-grid-empty">加载中…</p>
        <p v-else-if="listLoadedOk && posts.length === 0" class="plaza-grid-empty">还没有人分享作品，来做第一个吧。</p>
        <ul v-else class="plaza-grid">
          <li v-for="post in posts" :key="post.postId">
            <button type="button" class="plaza-card text-box-surface" @click="openDetail(post)">
              <div class="plaza-card__thumb">
                <img v-if="previewCache[post.postId]" :src="previewCache[post.postId]" :alt="post.title" />
                <span v-else class="muted">预览</span>
              </div>
              <div class="plaza-card__body">
                <h3>{{ post.title }}</h3>
                <p class="muted">{{ post.authorName }} · {{ friendlyShortDate(post.createdAt) }}</p>
              </div>
            </button>
          </li>
        </ul>
      </template>
      <PersonalSpacePanel v-else ref="personalRef" />
    </section>

    <!-- 最顶层：返回键装饰 + 热区 -->
    <img
      class="plaza-v2-layer plaza-v2-layer--z6"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.backButton"
      alt=""
      aria-hidden="true"
    />
    <button type="button" class="plaza-v2-hit plaza-v2-hit--back" :style="backHit" aria-label="返回" @click="onBack" />
  </AuthArtboard>

  <PlazaPostDetailModal
    :open="detailOpen"
    :post="detailPost"
    :preview-src="detailPreview"
    @close="closeDetail"
  />
</template>

<style scoped>
.plaza-v2-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}

.plaza-v2-layer--z0 {
  z-index: 0;
}

.plaza-v2-layer--z1,
.plaza-v2-layer--z2 {
  z-index: 1;
}

.plaza-v2-layer--z3 {
  z-index: 3;
}

.plaza-v2-layer--z4 {
  z-index: 4;
}

.plaza-v2-layer--z5 {
  z-index: 5;
}

.plaza-v2-layer--z6 {
  z-index: 7;
}

.plaza-v2-tab-layer--active {
  opacity: 1;
}

.plaza-v2-tab-layer--idle {
  opacity: 0.48;
  filter: brightness(0.92);
}

.plaza-v2-hit {
  position: absolute;
  z-index: 8;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.plaza-v2-hit--back {
  z-index: 9;
}

.plaza-v2-content-slot {
  position: absolute;
  z-index: 6;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px 12px;
  background: transparent;
  scrollbar-width: thin;
  scrollbar-color: rgba(89, 71, 56, 0.35) transparent;
}

.plaza-v2-content-slot::-webkit-scrollbar {
  width: 10px;
}

.plaza-v2-content-slot::-webkit-scrollbar-thumb {
  background: rgba(89, 71, 56, 0.28);
  border-radius: 999px;
}

.plaza-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 4px 2px 12px;
  list-style: none;
}

.plaza-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 10px;
  border: 0;
  text-align: left;
  cursor: pointer;
}

.plaza-card__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  margin-bottom: 10px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.5);
}

.plaza-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.plaza-card__body h3 {
  margin: 0 0 6px;
  font-size: 20px;
}

.plaza-grid-empty {
  margin: 24px;
  text-align: center;
  color: var(--muted);
}
</style>
