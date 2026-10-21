<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import type { RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PlazaFeed from '../components/plaza/PlazaFeed.vue'
import { openLobby } from '../app-nav'
import { loadPlazaSession } from '../services/plaza-session'
import { getPlazaPost, listPlazaPosts, loadPlazaPreviewUrl, withdrawPlazaPost } from '../services/plaza-api'
import { action, loadRewardDashboard, submitTeacherReview } from '../services/reward-api'
import { showCenterToast } from '../composables/center-toast'
import { rewardAssets } from '../ui/reward-assets'
import { plazaV2Assets, plazaV2FullLayerStyle, plazaV2HitBoxStyle } from '../ui/plaza-v2-assets'

const session = loadPlazaSession()
const modalOpen = ref(false)
const posts = ref<PlazaPost[]>([])
const previews = ref<Record<string, string>>({})
const busyPostId = ref(''), detailLoading = ref(false), detailError = ref('')
let active = true, detailRequest = 0, feedRequest = 0
const loading = ref(false)
const error = ref('')
const dashboard = ref<RewardDashboard | null>(null)
const backHit = plazaV2HitBoxStyle('back-button')
const wallet = computed(() => dashboard.value?.wallet ?? { coins: 0, diamonds: 0 })
const showWallet = computed(() => {
  const role = dashboard.value?.user.role ?? session?.user.role
  return Boolean(dashboard.value) && role !== 'parent' && role !== 'admin'
})

async function refresh(): Promise<void> {
  if (!session) { error.value='请先登录后查看分享作品。'; return }
  const request = ++feedRequest
  loading.value = true
  error.value = ''
  try {
    const next = await listPlazaPosts(session.token)
    if (!active || request !== feedRequest) return
    posts.value = next
    await Promise.all(next.map(async (post) => {
      try {
        if (previews.value[post.postId]) return
        const url = await loadPlazaPreviewUrl(session.token, post.previewMediaPath)
        if (!active || request !== feedRequest) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return }
        previews.value[post.postId] = url
      } catch {
        if(active && request===feedRequest) error.value = '部分作品图片未能加载，请重试。'
      }
    }))
  } catch (e) {
    if(active && request===feedRequest) error.value = (e as Error)?.message || '分享广场加载失败。'
  } finally {
    if(active && request===feedRequest) loading.value = false
  }
}

async function inspect(post: PlazaPost): Promise<void> {
  if (!session) return
  const request=++detailRequest
  detailLoading.value=true;detailError.value=''
  try {
    const loaded=await getPlazaPost(session.token,post.postId)
    if (!active || request!==detailRequest) return
    const current=posts.value.find(item=>item.postId===post.postId)
    if(current) Object.assign(current,{reviews:loaded.reviews??[],storyTitle:loaded.storyTitle,storyText:loaded.storyText})
  } catch(error) {if(active&&request===detailRequest)detailError.value=(error as Error)?.message||'评论加载失败，请重试。'}
  finally {if(active&&request===detailRequest)detailLoading.value=false}
}
async function like(post: PlazaPost): Promise<void> {
  if(!session || busyPostId.value) return
  busyPostId.value=post.postId
  try {
    const stats=await action<{likeCount:number;likedByMe:boolean;reviewCount:number}>(session.token,post.likedByMe?'unlike':'like',{postId:post.postId})
    if(active)Object.assign(post,stats)
  } catch(error) {showCenterToast((error as Error)?.message||'点赞没有完成，请重试。')}
  finally {busyPostId.value=''}
}
async function review(post: PlazaPost, score:number, comment:string): Promise<void> {
  if(!session || busyPostId.value) return
  busyPostId.value=post.postId
  try {
    const result=await submitTeacherReview(session.token,{postId:post.postId,score,comment})
    if(active){post.reviewCount++;await inspect(post);await refreshWallet();showCenterToast(`点评已提交，获得 ${result.teacherRewardCoins} 金币`)}
  } catch(error) {showCenterToast((error as Error)?.message||'点评没有完成，请重试。')}
  finally {busyPostId.value=''}
}
async function withdraw(post: PlazaPost): Promise<void> {
  if(!session || busyPostId.value || post.userId!==session.user.userId) return
  busyPostId.value=post.postId
  try {
    await withdrawPlazaPost(session.token,post.projectId)
    if(active){posts.value=posts.value.filter(item=>item.postId!==post.postId);showCenterToast('已移除分享，本机作品保留')}
  } catch(error) {showCenterToast((error as Error)?.message||'操作没有完成，请重试。')}
  finally {busyPostId.value=''}
}

async function refreshWallet(): Promise<void> {
  if (!session?.token) return
  try {
    dashboard.value = await loadRewardDashboard(session.token)
  } catch {
    // Keep the last known balance if the reward service is temporarily unavailable.
  }
}

onMounted(() => {
  void refresh()
  void refreshWallet()
})
onUnmounted(()=>{active=false;feedRequest++;detailRequest++;Object.values(previews.value).forEach(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url)})})
</script>

<template>
  <AuthArtboard>
    <img class="plaza-v2-layer plaza-v2-layer--z0" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.baseBackground" alt="" aria-hidden="true" />
    <img class="plaza-v2-layer plaza-v2-layer--z1" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.publicBackground" alt="" aria-hidden="true" />
    <img class="plaza-v2-layer plaza-v2-layer--frame" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.showcaseFrame" alt="" aria-hidden="true" />
    <img class="plaza-v2-layer plaza-v2-layer--title" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.titleBanner" alt="童创空间" />

    <PlazaFeed :posts="posts" :previews="previews" :viewer="session?.user" :loading="loading" :error="error"
      :busy-post-id="busyPostId" :detail-loading="detailLoading" :detail-error="detailError"
      @retry="refresh" @inspect="inspect" @like="like" @review="review" @withdraw="withdraw" @modal-change="modalOpen=$event" />

    <img class="plaza-v2-layer plaza-v2-layer--back" :style="plazaV2FullLayerStyle" :src="plazaV2Assets.backButton" alt="" aria-hidden="true" />
    <button type="button" class="plaza-v2-hit plaza-v2-hit--back" :style="backHit" :disabled="modalOpen" aria-label="返回游戏大厅" @click="openLobby" />

    <div v-if="showWallet" class="plaza-account" aria-label="账户余额">
      <span><img :src="rewardAssets.diamond" alt="钻石" /><strong>{{ wallet.diamonds }}</strong></span>
      <span><img :src="rewardAssets.coin" alt="金币" /><strong>{{ wallet.coins }}</strong></span>
    </div>
  </AuthArtboard>

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

.plaza-account {
  position: absolute;
  right: 72px;
  top: 36px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 16px;
}

.plaza-account span {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 168px;
  min-height: 78px;
  padding: 12px 22px;
  border: 4px solid rgba(105, 69, 40, .32);
  border-radius: 18px;
  background: rgba(255, 252, 238, .95);
  color: #71351c;
  font-size: 32px;
}

.plaza-account img {
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  object-fit: contain;
}
</style>
