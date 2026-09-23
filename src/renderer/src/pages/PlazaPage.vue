<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PlazaPostDetailModal from '../components/plaza/PlazaPostDetailModal.vue'
import { enterCreationStudio, openLogin } from '../app-nav'
import { listPlazaPosts, loadPlazaPreviewUrl } from '../services/plaza-api'
import { clearPlazaSession, loadPlazaSession } from '../services/plaza-session'
import { friendlyShortDate } from '../util/friendly-time'
import { authFullLayerStyle } from '../ui/auth-assets'
import { plazaAssets } from '../ui/plaza-assets'

const posts = ref<PlazaPost[]>([])
const previewCache = ref<Record<string, string>>({})
const loading = ref(true)
const listLoadedOk = ref(false)
const message = ref('')
const detailPost = ref<PlazaPost | null>(null)
const detailOpen = ref(false)
const detailPreview = ref('')

function currentSession() {
  return loadPlazaSession()
}

async function refreshPosts(): Promise<void> {
  const session = currentSession()
  if (!session?.token) {
    openLogin()
    return
  }
  loading.value = true
  message.value = ''
  listLoadedOk.value = false
  try {
    posts.value = await listPlazaPosts(session.token)
    listLoadedOk.value = true
    await preloadThumbnails(session.token, posts.value)
  } catch {
    posts.value = []
    listLoadedOk.value = false
    message.value = ''
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
      // keep card placeholder
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
      message.value = ''
    }
  }
}

function closeDetail(): void {
  detailOpen.value = false
  detailPost.value = null
  detailPreview.value = ''
}

function logout(): void {
  clearPlazaSession()
  openLogin()
}

onMounted(() => {
  if (!currentSession()) {
    openLogin()
    return
  }
  void refreshPosts()
})
</script>

<template>
  <AuthArtboard>
    <img class="plaza-layer" :style="authFullLayerStyle" :src="plazaAssets.background" alt="" aria-hidden="true" />
    <img
      class="plaza-layer plaza-layer--under-showcase"
      :style="authFullLayerStyle"
      :src="plazaAssets.screenBorderDecor"
      alt=""
      aria-hidden="true"
    />
    <img class="plaza-layer plaza-layer--title" :style="authFullLayerStyle" :src="plazaAssets.titleBanner" alt="" aria-hidden="true" />
    <img class="plaza-layer plaza-layer--frame" :style="authFullLayerStyle" :src="plazaAssets.showcaseFrame" alt="" aria-hidden="true" />

    <section class="plaza-grid-slot" aria-label="作品列表">
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
      <p v-if="message" class="plaza-message error">{{ message }}</p>
    </section>

    <div class="plaza-actions">
      <button type="button" class="primary plaza-logout" @click="logout">退出登录</button>
      <button type="button" class="primary plaza-start-create" @click="enterCreationStudio">开始创作</button>
    </div>
  </AuthArtboard>

  <PlazaPostDetailModal
    :open="detailOpen"
    :post="detailPost"
    :preview-src="detailPreview"
    @close="closeDetail"
  />
</template>

<style scoped>
.plaza-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}

.plaza-layer--under-showcase {
  z-index: 1;
}

.plaza-layer--title {
  z-index: 2;
}

.plaza-layer--frame {
  z-index: 3;
}

.plaza-grid-slot {
  position: absolute;
  left: 168px;
  top: 424px;
  z-index: 4;
  width: 1584px;
  height: 488px;
  padding: 8px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  background: transparent;
  scrollbar-width: thin;
  scrollbar-color: rgba(89, 71, 56, 0.35) transparent;
}

.plaza-grid-slot::-webkit-scrollbar {
  width: 10px;
}

.plaza-grid-slot::-webkit-scrollbar-thumb {
  background: rgba(89, 71, 56, 0.28);
  border-radius: 999px;
}

.plaza-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 8px 4px 0;
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

.plaza-actions {
  position: absolute;
  right: 120px;
  bottom: 56px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 16px;
}

.plaza-start-create {
  min-width: 200px;
  min-height: 64px;
  font-size: 26px;
}

.plaza-logout {
  min-width: 200px;
  min-height: 64px;
  font-size: 26px;
}

.plaza-message {
  margin-top: 12px;
}
</style>
