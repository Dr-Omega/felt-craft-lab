<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import type { RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PlazaPostDetailModal from '../components/plaza/PlazaPostDetailModal.vue'
import { enterCreationStudio, openLobby, openLogin, openPersonalCenter, openRewards } from '../app-nav'
import { listPlazaPosts, loadPlazaPreviewUrl } from '../services/plaza-api'
import { loadPlazaSession } from '../services/plaza-session'
import { friendlyShortDate } from '../util/friendly-time'
import { authFullLayerStyle } from '../ui/auth-assets'
import { plazaAssets, plazaAvatarForRole } from '../ui/plaza-assets'
import { rewardAssets } from '../ui/reward-assets'
import { loadRewardDashboard } from '../services/reward-api'

const posts = ref<PlazaPost[]>([])
const previewCache = ref<Record<string, string>>({})
const loading = ref(true)
const listLoadedOk = ref(false)
const message = ref('')
const detailPost = ref<PlazaPost | null>(null)
const detailOpen = ref(false)
const detailPreview = ref('')
const rewardDashboard = ref<RewardDashboard | null>(null)

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
    rewardDashboard.value = await loadRewardDashboard(session.token)
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

function updatePostStats(stats: { postId: string; likeCount: number; likedByMe: boolean; reviewCount: number }): void {
  posts.value = posts.value.map((post) => (post.postId === stats.postId ? { ...post, ...stats } : post))
  if (detailPost.value?.postId === stats.postId) detailPost.value = { ...detailPost.value, ...stats }
  const session = currentSession()
  if (session?.token) void loadRewardDashboard(session.token).then((next) => (rewardDashboard.value = next))
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
      class="plaza-layer plaza-layer--public-space"
      :style="authFullLayerStyle"
      :src="plazaAssets.publicSpace"
      alt=""
      aria-hidden="true"
    />
    <img
      class="plaza-layer plaza-layer--avatar"
      :style="authFullLayerStyle"
      :src="plazaAvatarForRole(rewardDashboard?.user.role ?? currentSession()?.user.role ?? 'child')"
      alt=""
      aria-hidden="true"
    />
    <img class="plaza-layer plaza-layer--frame" :style="authFullLayerStyle" :src="plazaAssets.showcaseFrame" alt="" aria-hidden="true" />
    <img class="plaza-layer plaza-layer--personal-button" :style="authFullLayerStyle" :src="plazaAssets.personalButton" alt="" aria-hidden="true" />
    <img class="plaza-layer plaza-layer--public-button" :style="authFullLayerStyle" :src="plazaAssets.publicButton" alt="" aria-hidden="true" />
    <img class="plaza-layer plaza-layer--back-button" :style="authFullLayerStyle" :src="plazaAssets.backButton" alt="" aria-hidden="true" />
    <button type="button" class="plaza-back-hitbox" aria-label="返回游戏大厅" @click="openLobby"></button>
    <button type="button" class="plaza-personal-hitbox" aria-label="打开个人中心" @click="openPersonalCenter"></button>
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
              <p class="plaza-card__stats">{{ post.likeCount }} 赞 · {{ post.reviewCount }} 条点评</p>
            </div>
          </button>
        </li>
      </ul>
      <p v-if="message" class="plaza-message error">{{ message }}</p>
    </section>

    <div class="plaza-account">
      <span v-if="rewardDashboard?.user.role !== 'parent' && rewardDashboard?.user.role !== 'admin'">
        <img :src="rewardAssets.diamond" alt="钻石" />{{ rewardDashboard?.wallet.diamonds ?? 0 }}
      </span>
      <span v-if="rewardDashboard?.user.role !== 'parent' && rewardDashboard?.user.role !== 'admin'">
        <img :src="rewardAssets.coin" alt="金币" />{{ rewardDashboard?.wallet.coins ?? 0 }}
      </span>
      <button type="button" class="primary" @click="openRewards">成长中心</button>
    </div>

    <div class="plaza-actions">
      <button type="button" class="primary plaza-start-create" @click="enterCreationStudio">开始创作</button>
    </div>
  </AuthArtboard>

  <PlazaPostDetailModal
    :open="detailOpen"
    :post="detailPost"
    :preview-src="detailPreview"
    :role="rewardDashboard?.user.role ?? currentSession()?.user.role ?? 'child'"
    @close="closeDetail"
    @updated="updatePostStats"
  />
</template>

<style scoped>
.plaza-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}

.plaza-layer--public-space {
  z-index: 1;
}

.plaza-layer--avatar {
  z-index: 2;
}

.plaza-layer--frame {
  z-index: 3;
}

.plaza-layer--back-button {
  z-index: 5;
}

.plaza-layer--personal-button {
  z-index: 5;
}

.plaza-layer--public-button {
  z-index: 5;
}

.plaza-back-hitbox {
  position: absolute;
  left: 39px;
  top: 35px;
  z-index: 6;
  width: 207px;
  height: 112px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.plaza-personal-hitbox {
  position: absolute;
  left: 285px;
  top: 178px;
  z-index: 6;
  width: 260px;
  height: 190px;
  border: 0;
  background: transparent;
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

.plaza-card__stats {
  margin: 8px 0 0;
  color: #9a4138;
  font-size: 15px;
}

.plaza-account {
  position: absolute;
  right: 270px;
  top: 42px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 16px;
}

.plaza-account span {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 250px;
  min-height: 75px;
  padding: 12px 18px;
  border: 2px solid rgba(105, 69, 40, 0.28);
  border-radius: 12px;
  background: rgba(255, 252, 238, 0.92);
  color: #71351c;
  font-size: 30px;
}

.plaza-account img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.plaza-account .primary {
  min-width: 132px;
  min-height: 58px;
  padding: 10px 16px;
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
