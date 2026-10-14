<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { BearFood, Currency, RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import { openLobby, openPlaza } from '../app-nav'
import { showCenterToast } from '../composables/center-toast'
import { loadPlazaSession } from '../services/plaza-session'
import { feedBear, loadRewardDashboard, saveBearRoom } from '../services/reward-api'
import { authFullLayerStyle } from '../ui/auth-assets'
import { BEAR_ROOM_SOFA_FURNITURE, bearHomeAssets, bearHomeSofaHitBox } from '../ui/bear-home-assets'
import { profileAssets } from '../ui/profile-assets'
import { rewardAssets } from '../ui/reward-assets'

const session = loadPlazaSession()
const dashboard = ref<RewardDashboard | null>(null)
const loading = ref(true)
const busyKey = ref('')
const sofaScene = ref(false)
const roomRevision = ref(0)
const roomLoaded = ref(false)
const selectedFoodId = ref<BearFood['foodId'] | ''>('')
const payPanelOpen = ref(false)

const foods = computed(() => dashboard.value?.foods ?? [])
const selectedFood = computed(() => foods.value.find((food) => food.foodId === selectedFoodId.value) ?? null)

const sofaHitStyle = computed(() => ({
  left: `${bearHomeSofaHitBox.left}px`,
  top: `${bearHomeSofaHitBox.top}px`,
  width: `${bearHomeSofaHitBox.width}px`,
  height: `${bearHomeSofaHitBox.height}px`
}))

const roomLayerSrc = computed(() => (sofaScene.value ? bearHomeAssets.roomSofa : bearHomeAssets.roomDefault))

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '操作没有完成，请稍后再试。'
}

async function refreshDashboard(): Promise<void> {
  if (!session?.token) return
  dashboard.value = await loadRewardDashboard(session.token)
  if (!roomLoaded.value && dashboard.value.room) {
    sofaScene.value = dashboard.value.room.furniture === BEAR_ROOM_SOFA_FURNITURE
    roomRevision.value = dashboard.value.room.revision
    roomLoaded.value = true
  }
}

async function run(key: string, task: () => Promise<void>): Promise<void> {
  if (busyKey.value) return
  busyKey.value = key
  try {
    await task()
  } catch (error) {
    showCenterToast(errorMessage(error))
  } finally {
    busyKey.value = ''
  }
}

function onFoodChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as BearFood['foodId'] | ''
  selectedFoodId.value = value
  payPanelOpen.value = Boolean(value)
}

function toggleSofaScene(): void {
  sofaScene.value = !sofaScene.value
}

async function saveRoom(): Promise<void> {
  if (!session?.token || !roomLoaded.value) return
  await run('room', async () => {
    const saved = await saveBearRoom(session.token, {
      character: '小熊',
      furniture: sofaScene.value ? BEAR_ROOM_SOFA_FURNITURE : '原木色',
      revision: roomRevision.value
    })
    roomRevision.value = saved.revision
    showCenterToast('房间设置已保存')
  })
}

async function feed(currency: Currency): Promise<void> {
  const food = selectedFood.value
  if (!session?.token || !food) return
  await run(`feed:${food.foodId}:${currency}`, async () => {
    const result = await feedBear(session.token, food.foodId, currency)
    if (dashboard.value) {
      dashboard.value = { ...dashboard.value, wallet: result.wallet }
    }
    showCenterToast(`小熊吃到了${food.name}`)
    payPanelOpen.value = false
    selectedFoodId.value = ''
  })
}

onMounted(() => {
  void (async () => {
    if (!session?.token) {
      openPlaza()
      return
    }
    loading.value = true
    try {
      await refreshDashboard()
      if (dashboard.value?.user.role !== 'child') {
        showCenterToast('仅儿童账号可进入小熊的家')
        openLobby()
      }
    } catch (error) {
      showCenterToast(errorMessage(error))
      openLobby()
    } finally {
      loading.value = false
    }
  })()
})
</script>

<template>
  <AuthArtboard>
    <img class="bear-layer bear-layer--bg" :style="authFullLayerStyle" :src="bearHomeAssets.backgroundBase" alt="" aria-hidden="true" />
    <img class="bear-layer bear-layer--room" :style="authFullLayerStyle" :src="roomLayerSrc" alt="" aria-hidden="true" />
    <img class="bear-layer bear-layer--frame" :style="authFullLayerStyle" :src="bearHomeAssets.frameOverlay" alt="" aria-hidden="true" />

    <button
      type="button"
      class="bear-sofa-hit"
      :style="sofaHitStyle"
      aria-label="切换沙发场景"
      :disabled="Boolean(busyKey)"
      @click="toggleSofaScene"
    />

    <div class="bear-food-bar" aria-label="购买食物">
      <label class="bear-food-select">
        <span class="sr-only">选择食物</span>
        <select :value="selectedFoodId" :disabled="Boolean(busyKey) || loading" @change="onFoodChange">
          <option value="">选择要购买的食物…</option>
          <option v-for="food in foods" :key="food.foodId" :value="food.foodId">{{ food.name }}</option>
        </select>
      </label>
      <div v-if="payPanelOpen && selectedFood" class="bear-pay-panel">
        <span>{{ selectedFood.name }}</span>
        <button type="button" :disabled="Boolean(busyKey)" @click="feed('coins')">
          <img :src="rewardAssets.coin" alt="金币" />{{ selectedFood.coinPrice }}
        </button>
        <button type="button" :disabled="Boolean(busyKey)" @click="feed('diamonds')">
          <img :src="rewardAssets.diamond" alt="钻石" />{{ selectedFood.diamondPrice }}
        </button>
      </div>
    </div>

    <button type="button" class="bear-save" :disabled="Boolean(busyKey) || !roomLoaded" @click="saveRoom">保存</button>

    <button type="button" class="bear-back" aria-label="返回游戏大厅" @click="openLobby">
      <img :src="profileAssets.back" alt="" />
    </button>
  </AuthArtboard>
</template>

<style scoped>
.bear-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}
.bear-layer--bg { z-index: 1; }
.bear-layer--room { z-index: 2; }
.bear-layer--frame { z-index: 20; }

.bear-sofa-hit {
  position: absolute;
  z-index: 12;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.bear-sofa-hit:hover { filter: brightness(1.03); }

.bear-food-bar {
  position: absolute;
  right: 72px;
  top: 96px;
  z-index: 35;
  display: grid;
  gap: 14px;
  justify-items: end;
  min-width: 420px;
  max-width: 520px;
}
.bear-food-select select {
  min-width: 420px;
  min-height: 68px;
  padding: 12px 20px;
  border: 4px solid #71351c;
  border-radius: 16px;
  background: rgba(255, 248, 213, .95);
  color: #71351c;
  font: inherit;
  font-size: 28px;
  font-weight: 700;
}
.bear-pay-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 14px 18px;
  border: 4px solid #71351c;
  border-radius: 16px;
  background: rgba(255, 252, 238, .96);
  color: #563c2d;
  font-size: 24px;
  font-weight: 600;
}
.bear-pay-panel button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 16px;
  border: 3px solid #b88a55;
  border-radius: 12px;
  background: #fff5d8;
  color: #70431f;
  font: inherit;
  font-size: 22px;
}
.bear-pay-panel img { width: 36px; height: 36px; object-fit: contain; }

.bear-save {
  position: absolute;
  left: 72px;
  bottom: 64px;
  z-index: 35;
  min-width: 200px;
  min-height: 72px;
  border: 4px solid #71351c;
  border-radius: 18px;
  background: #fff4bd;
  color: #71351c;
  font-size: 30px;
  font-weight: 700;
}

.bear-back {
  position: absolute;
  left: 270px;
  top: 140px;
  z-index: 35;
  width: 180px;
  height: 81px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.bear-back img { display: block; width: 100%; height: 100%; object-fit: contain; }
.bear-back:hover { filter: brightness(1.06); }
.bear-back:active { transform: translateY(2px); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
