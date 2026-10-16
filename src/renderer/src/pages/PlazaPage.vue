<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PlazaPostDetailModal from '../components/plaza/PlazaPostDetailModal.vue'
import { openLobby } from '../app-nav'
import { loadPlazaSession } from '../services/plaza-session'
import { listPlazaPosts, loadPlazaPreviewUrl } from '../services/plaza-api'
import { plazaV2Assets, plazaV2ContentSlotStyle, plazaV2FullLayerStyle, plazaV2HitBoxStyle } from '../ui/plaza-v2-assets'
const session = loadPlazaSession()
const posts = ref<PlazaPost[]>([])
const previews = ref<Record<string,string>>({})
const detail = ref<PlazaPost | null>(null)
const loading = ref(false)
const error = ref('')
const activeTab = ref<'public' | 'personal'>('public')
const publicTabHit = plazaV2HitBoxStyle('public-tab')
const personalTabHit = plazaV2HitBoxStyle('personal-tab')
const backHit = plazaV2HitBoxStyle('back-button')
const publicTabLayerClass = computed(() => activeTab.value === 'public' ? 'plaza-v2-tab-layer--active' : 'plaza-v2-tab-layer--idle')
const personalTabLayerClass = computed(() => activeTab.value === 'personal' ? 'plaza-v2-tab-layer--active' : 'plaza-v2-tab-layer--idle')
// The plaza contains published posts only. Private drafts remain in the account's works section.
const visiblePosts = computed(() => activeTab.value === 'public'
  ? posts.value : posts.value.filter(post => post.userId === session?.user.userId))
function selectTab(tab: 'public' | 'personal'): void { activeTab.value = tab; detail.value = null }
async function refresh(): Promise<void> {
  if (!session) return
  loading.value = true; error.value = ''
  try {
    posts.value = await listPlazaPosts(session.token)
    await Promise.all(posts.value.map(async post => {
      try { previews.value[post.postId] = await loadPlazaPreviewUrl(session.token, post.previewMediaPath) }
      catch { error.value = '部分作品图片未能加载，请重试。' }
    }))
  } catch (e) { error.value = (e as Error)?.message || '分享广场加载失败。' }
  finally { loading.value = false }
}
function updateStats(stats: { postId: string; likeCount: number; likedByMe: boolean; reviewCount: number }): void {
  const post = posts.value.find(post => post.postId === stats.postId)
  if (post) Object.assign(post, stats)
}
onMounted(refresh)
</script>
<template>
  <AuthArtboard>
    <img
      class="plaza-v2-layer plaza-v2-layer--z0"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.baseBackground"
      alt=""
      aria-hidden="true"
    />
    <img
      v-show="activeTab === 'public'"
      class="plaza-v2-layer plaza-v2-layer--z1"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.publicBackground"
      alt=""
      aria-hidden="true"
    />
    <img
      v-show="activeTab === 'personal'"
      class="plaza-v2-layer plaza-v2-layer--z2"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.personalBackground"
      alt=""
      aria-hidden="true"
    />
    <img
      class="plaza-v2-layer plaza-v2-layer--z3"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.showcaseFrame"
      alt=""
      aria-hidden="true"
    />
    <img
      :class="publicTabLayerClass"
      class="plaza-v2-layer plaza-v2-layer--z4"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.publicTab"
      alt=""
      aria-hidden="true"
    />
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
      aria-label="公共空间" data-tour-id="tour-plaza-public"
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

    <section
      class="plaza-v2-content-slot"
      :style="plazaV2ContentSlotStyle"
      :aria-label="activeTab === 'public' ? '公共空间作品' : '个人空间作品'"
    >
      <p v-if="loading" role="status">正在加载分享作品…</p>
      <p v-else-if="error" role="alert">{{ error }} <button class="hand-btn-secondary" @click="refresh">重试</button></p>
      <p v-else-if="!visiblePosts.length">{{ activeTab === 'public' ? '暂无分享。可在个人中心发布作品。' : '暂无分享。草稿和未发布作品在个人中心。' }}</p>
      <ul class="plaza-grid">
        <li v-for="post in visiblePosts" :key="post.postId">
          <button type="button" class="plaza-card text-box-surface" @click="detail = post">
            <div class="plaza-card__thumb"><img v-if="previews[post.postId]" :src="previews[post.postId]" :alt="post.title" /></div>
            <div class="plaza-card__body"><h3>{{ post.title }}</h3><p>{{ post.authorName }} · {{ post.likeCount }} 赞</p></div>
          </button>
        </li>
      </ul>
    </section>

    <img
      class="plaza-v2-layer plaza-v2-layer--z6"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.backButton"
      alt=""
      aria-hidden="true"
    />
    <button type="button" class="plaza-v2-hit plaza-v2-hit--back" :style="backHit" aria-label="返回游戏大厅" @click="openLobby" />
  </AuthArtboard>

  <PlazaPostDetailModal :post="detail" :open="Boolean(detail)" :preview-src="detail ? previews[detail.postId] || '' : ''"
    :role="session?.user.role ?? 'child'" @close="detail = null" @updated="updateStats" />
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
  mix-blend-mode: normal;
  opacity: 1;
}

.plaza-v2-tab-layer--idle {
  mix-blend-mode: normal;
  opacity: 1;
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
  padding: 10px 14px;
  background: transparent;
  font-size: 1.05rem;
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
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
  margin: 0;
  padding: 4px 2px 12px;
  list-style: none;
}

.plaza-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px;
  border: 0;
  text-align: left;
  cursor: pointer;
}

.plaza-card__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  margin-bottom: 12px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.5);
}

.plaza-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
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
