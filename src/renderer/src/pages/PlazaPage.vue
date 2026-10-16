<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import type { RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PlazaPostDetailModal from '../components/plaza/PlazaPostDetailModal.vue'
import { enterCreationStudio, openLobby, openPersonalCenter, openRewards } from '../app-nav'
import { loadPlazaSession } from '../services/plaza-session'
import { listPlazaPosts, loadPlazaPreviewUrl } from '../services/plaza-api'
import { loadRewardDashboard } from '../services/reward-api'
import { plazaAvatarForRole } from '../ui/plaza-assets'
import { rewardAssets } from '../ui/reward-assets'
import { plazaV2Assets, plazaV2ContentSlotStyle, plazaV2FullLayerStyle, plazaV2HitBoxStyle } from '../ui/plaza-v2-assets'

const session = loadPlazaSession()
const posts = ref<PlazaPost[]>([])
const previews = ref<Record<string, string>>({})
const detail = ref<PlazaPost | null>(null)
const loading = ref(false)
const error = ref('')
const dashboard = ref<RewardDashboard | null>(null)
const backHit = plazaV2HitBoxStyle('back-button')
const startCreateHit = plazaV2HitBoxStyle('start-create')
const wallet = computed(() => dashboard.value?.wallet ?? { coins: 0, diamonds: 0 })
const showWallet = computed(() => {
  const role = dashboard.value?.user.role ?? session?.user.role
  return Boolean(dashboard.value) && role !== 'parent' && role !== 'admin'
})
const avatarSrc = computed(() => plazaAvatarForRole(dashboard.value?.user.role ?? session?.user.role ?? 'child'))

async function refresh(): Promise<void> {
  if (!session) return
  loading.value = true
  error.value = ''
  try {
    posts.value = await listPlazaPosts(session.token)
    await Promise.all(posts.value.map(async (post) => {
      try {
        previews.value[post.postId] = await loadPlazaPreviewUrl(session.token, post.previewMediaPath)
      } catch {
        error.value = '部分作品图片未能加载，请重试。'
      }
    }))
  } catch (e) {
    error.value = (e as Error)?.message || '分享广场加载失败。'
  } finally {
    loading.value = false
  }
}

function updateStats(stats: { postId: string; likeCount: number; likedByMe: boolean; reviewCount: number }): void {
  const post = posts.value.find((item) => item.postId === stats.postId)
  if (post) Object.assign(post, stats)
}

onMounted(() => {
  void refresh()
  if (session?.token) {
    void loadRewardDashboard(session.token).then((next) => {
      dashboard.value = next
    }).catch(() => undefined)
  }
})
</script>

<template>
  <AuthArtboard>
    <img class="plaza-v2-layer plaza-v2-layer--z0" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.baseBackground" alt="" aria-hidden="true" />
    <img class="plaza-v2-layer plaza-v2-layer--z1" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.publicBackground" alt="" aria-hidden="true" />
    <img class="plaza-v2-layer plaza-v2-layer--frame" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.showcaseFrame" alt="" aria-hidden="true" />
    <img class="plaza-v2-layer plaza-v2-layer--title" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.titleBanner" alt="童创空间" />

    <section class="plaza-v2-content-slot" :style="plazaV2ContentSlotStyle" aria-label="童创空间作品">
      <p v-if="loading" role="status">正在加载分享作品…</p>
      <p v-else-if="error" role="alert">{{ error }} <button class="hand-btn-secondary" @click="refresh">重试</button></p>
      <p v-else-if="!posts.length">还没有人分享作品，来做第一个吧。</p>
      <ul v-else class="plaza-grid">
        <li v-for="post in posts" :key="post.postId">
          <button type="button" class="plaza-card text-box-surface" @click="detail = post">
            <div class="plaza-card__thumb">
              <img v-if="previews[post.postId]" :src="previews[post.postId]" :alt="post.title" />
            </div>
            <div class="plaza-card__body">
              <h3>{{ post.title }}</h3>
              <p>{{ post.authorName }} · {{ post.likeCount }} 赞</p>
            </div>
          </button>
        </li>
      </ul>
    </section>

    <img class="plaza-v2-layer plaza-v2-layer--back" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.backButton" alt="" aria-hidden="true" />
    <button type="button" class="plaza-v2-hit plaza-v2-hit--back" :style="backHit" aria-label="返回游戏大厅" @click="openLobby" />
    <button type="button" class="plaza-start-create" :style="startCreateHit" @click="enterCreationStudio">开始创作</button>

    <div class="plaza-chrome">
      <div v-if="showWallet" class="plaza-account" aria-label="账户余额">
        <span><img :src="rewardAssets.diamond" alt="钻石" /><strong>{{ wallet.diamonds }}</strong></span>
        <span><img :src="rewardAssets.coin" alt="金币" /><strong>{{ wallet.coins }}</strong></span>
      </div>
      <button type="button" class="plaza-rewards" @click="openRewards">成长中心</button>
    </div>
    <img class="plaza-v2-layer plaza-v2-layer--avatar" :style="plazaV2FullLayerStyle" :src="avatarSrc" alt="" aria-hidden="true" />
    <button type="button" class="plaza-v2-hit plaza-v2-hit--avatar" aria-label="进入个人中心" @click="openPersonalCenter" />
  </AuthArtboard>

  <PlazaPostDetailModal
    :post="detail"
    :open="Boolean(detail)"
    :preview-src="detail ? previews[detail.postId] || '' : ''"
    :role="session?.user.role ?? 'child'"
    @close="detail = null"
    @updated="updateStats"
  />
</template>

<style scoped>
.plaza-v2-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}

.plaza-v2-layer--z0 { z-index: 0; }
.plaza-v2-layer--z1 { z-index: 1; }
.plaza-v2-layer--frame { z-index: 3; }
.plaza-v2-layer--title {
  z-index: 4;
  transform: scale(1.18);
  transform-origin: 960px 40px;
}
.plaza-v2-layer--avatar {
  z-index: 5;
  transform: scale(0.68);
  transform-origin: 1694px 40px;
}
.plaza-v2-layer--back { z-index: 7; }

.plaza-v2-hit {
  position: absolute;
  z-index: 8;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.plaza-v2-hit--back { z-index: 9; }

.plaza-v2-content-slot {
  position: absolute;
  z-index: 6;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 18px 22px 12px;
  background: transparent;
  font-size: 1.05rem;
  text-align: center;
  scrollbar-width: thin;
  scrollbar-color: rgba(89, 71, 56, 0.35) transparent;
}

.plaza-v2-content-slot::-webkit-scrollbar { width: 10px; }
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
  text-align: left;
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

.plaza-start-create {
  position: absolute;
  z-index: 9;
  margin: 0;
  border: 3px solid #71351c;
  border-radius: 14px;
  background: #fff4bd;
  color: #71351c;
  font-size: 22px;
  cursor: pointer;
}

.plaza-chrome {
  position: absolute;
  left: 1252px;
  top: 42px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 8px;
}

.plaza-account {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plaza-account span {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 102px;
  min-height: 44px;
  padding: 4px 12px;
  border: 3px solid rgba(105, 69, 40, .28);
  border-radius: 14px;
  background: rgba(255, 252, 238, .94);
  color: #71351c;
  font-size: 22px;
}

.plaza-account img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.plaza-rewards {
  min-height: 44px;
  padding: 4px 14px;
  border: 3px solid #c4a574;
  border-radius: 14px;
  background: #fff6d8;
  color: #71351c;
  font-size: 20px;
  cursor: pointer;
}

.plaza-v2-hit--avatar {
  left: 1597px;
  top: 37px;
  z-index: 16;
  width: 193px;
  height: 191px;
}
</style>
