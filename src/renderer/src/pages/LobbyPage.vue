<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import { enterCreationStudio, openLearning, openPersonalCenter, openPlaza, openRewards } from '../app-nav'
import { syncState } from '../persistence/workspace-sync'
import { loadPlazaSession } from '../services/plaza-session'
import { loadRewardDashboard } from '../services/reward-api'
import { authFullLayerStyle } from '../ui/auth-assets'
import { lobbyAssets } from '../ui/lobby-assets'
import { plazaAvatarForRole } from '../ui/plaza-assets'
import { rewardAssets } from '../ui/reward-assets'

const hoveredZone = ref<'share' | 'learning' | 'create' | 'bear' | null>(null)
const session = computed(() => loadPlazaSession())
const dashboard = ref<RewardDashboard | null>(null)
const wallet = computed(() => dashboard.value?.wallet ?? { coins: 0, diamonds: 0 })
const showWallet = computed(() => {
  const role = dashboard.value?.user.role ?? session.value?.user.role
  return Boolean(dashboard.value) && role !== 'parent' && role !== 'admin'
})

onMounted(() => {
  const token = session.value?.token
  if (token) void loadRewardDashboard(token).then((next) => (dashboard.value = next)).catch(() => undefined)
})

function openCreate(): void {
  enterCreationStudio()
}
</script>

<template>
  <AuthArtboard>
    <img class="lobby-layer" :style="authFullLayerStyle" :src="lobbyAssets.backgroundOne" alt="" aria-hidden="true" />
    <img class="lobby-layer" :style="authFullLayerStyle" :src="lobbyAssets.backgroundTwo" alt="" aria-hidden="true" />
    <img class="lobby-layer lobby-layer--share" :style="authFullLayerStyle" :src="lobbyAssets.shareBoard" alt="" aria-hidden="true" />
    <img class="lobby-layer lobby-layer--tree" :style="authFullLayerStyle" :src="lobbyAssets.learningTree" alt="" aria-hidden="true" />
    <img class="lobby-layer lobby-layer--mushroom" :style="authFullLayerStyle" :src="lobbyAssets.createMushroom" alt="" aria-hidden="true" />
    <img class="lobby-layer lobby-layer--frame" :style="authFullLayerStyle" :src="lobbyAssets.frame" alt="" aria-hidden="true" />
    <img
      class="lobby-layer lobby-layer--avatar"
      :style="authFullLayerStyle"
      :src="plazaAvatarForRole(dashboard?.user.role ?? session?.user.role ?? 'child')"
      alt=""
      aria-hidden="true"
    />

    <button class="lobby-zone lobby-zone--share" type="button" aria-label="打开分享社区动态" @mouseenter="hoveredZone = 'share'" @mouseleave="hoveredZone = null" @click="openPlaza"></button>
    <button class="lobby-zone lobby-zone--learning" type="button" aria-label="进入学习区" @mouseenter="hoveredZone = 'learning'" @mouseleave="hoveredZone = null" @click="openLearning()"></button>
    <button class="lobby-zone lobby-zone--create" type="button" aria-label="进入创作区" @mouseenter="hoveredZone = 'create'" @mouseleave="hoveredZone = null" @click="openCreate"></button>
    <button
      v-if="(dashboard?.user.role ?? session?.user.role) === 'child'"
      class="lobby-zone lobby-zone--bear"
      type="button"
      aria-label="进入小熊的家"
      title="小熊的家"
      @mouseenter="hoveredZone = 'bear'"
      @mouseleave="hoveredZone = null"
      @click="openRewards('bear')"
    ></button>
    <button class="lobby-avatar-hitbox" type="button" aria-label="进入个人空间" @click="openPersonalCenter"></button>

    <img v-if="hoveredZone === 'share'" class="lobby-tip lobby-tip--share" :style="authFullLayerStyle" :src="lobbyAssets.shareTip" alt="分享社区" />
    <img v-if="hoveredZone === 'learning'" class="lobby-tip lobby-tip--learning" :style="authFullLayerStyle" :src="lobbyAssets.learningTip" alt="学习区" />
    <img v-if="hoveredZone === 'create'" class="lobby-tip lobby-tip--create" :style="authFullLayerStyle" :src="lobbyAssets.createTip" alt="创作区" />
    <img v-if="hoveredZone === 'bear'" class="lobby-tip lobby-tip--bear" :style="authFullLayerStyle" :src="lobbyAssets.bearHomeTip" alt="小熊的家" />

    <div v-if="showWallet" class="lobby-account" aria-label="账户余额">
      <span><img :src="rewardAssets.diamond" alt="钻石" /><strong>{{ wallet.diamonds }}</strong></span>
      <span><img :src="rewardAssets.coin" alt="金币" /><strong>{{ wallet.coins }}</strong></span>
    </div>
    <div class="lobby-user" aria-label="当前用户" :title="session?.user.username ?? '用户'">{{ session?.user.username ?? '用户' }}<span v-if="syncState.conflict" class="sync-attention" role="status"> · 同步待处理</span></div>
    <div class="lobby-actions"><button type="button" class="lobby-action" @click="enterCreationStudio">开始创作</button></div>
  </AuthArtboard>
</template>

<style scoped>
.lobby-layer, .lobby-tip { position: absolute; display: block; pointer-events: none; user-select: none; }
.lobby-layer--share, .lobby-layer--tree, .lobby-layer--mushroom { z-index: 2; }
.lobby-layer--frame { z-index: 3; }
.lobby-layer--avatar { z-index: 4; transform: translate(40px, -28px) scale(.58); transform-origin: 1710px 190px; }
.lobby-zone { position: absolute; z-index: 8; margin: 0; padding: 0; border: 0; background: transparent; }
.lobby-zone--share { left: 0; top: 137px; width: 940px; height: 900px; }
.lobby-zone--learning { left: 1480px; top: 330px; width: 425px; height: 580px; }
.lobby-zone--create { left: 810px; top: 450px; width: 720px; height: 600px; }
.lobby-zone--bear { left: 570px; top: 390px; width: 320px; height: 380px; z-index: 10; }
.lobby-avatar-hitbox { position: absolute; left: 1645px; top: 55px; z-index: 9; width: 210px; height: 220px; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
.lobby-avatar-hitbox:hover { filter: brightness(1.06); }
.lobby-avatar-hitbox:active { transform: translateY(2px); }
.lobby-tip { z-index: 12; }
.lobby-account { position: absolute; left: 50%; top: 24px; z-index: 15; display: flex; align-items: center; gap: 18px; transform: translateX(-50%); }
.lobby-account span { display: flex; align-items: center; gap: 12px; min-width: 162px; min-height: 82px; padding: 12px 20px; border: 4px solid rgba(105, 69, 40, .32); border-radius: 15px; background: rgba(255, 252, 238, .95); color: #71351c; font-size: 32px; }
.lobby-account img { width: 54px; height: 54px; flex: 0 0 54px; object-fit: contain; }
.lobby-account strong { line-height: 1; }
.lobby-user { position: absolute; right: 275px; top: 120px; z-index: 15; display: block; width: max-content; max-width: 330px; min-height: 42px; padding: 4px 9px; overflow: hidden; border: 3px solid #71351c; border-radius: 9px; background: rgba(255, 248, 213, .94); color: #71351c; box-shadow: 0 3px 0 rgba(113, 53, 28, .14); font-size: 34px; font-weight: 700; line-height: 1; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.sync-attention { font-size: 18px; }
.lobby-actions { position: absolute; right: 58px; bottom: 48px; z-index: 15; display: flex; gap: 12px; }
.lobby-action { min-width: 170px; min-height: 54px; border: 3px solid #71351c; border-radius: 14px; background: #fff4bd; color: #71351c; font-size: 22px; }
</style>
