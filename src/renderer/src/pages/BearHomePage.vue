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
const foodMenuOpen = ref(false)

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

function foodImage(foodId: BearFood['foodId']): string {
  return rewardAssets[foodId]
}

function selectFood(food: BearFood): void {
  selectedFoodId.value = food.foodId
  payPanelOpen.value = true
  foodMenuOpen.value = false
}

function toggleFoodMenu(): void {
  if (busyKey.value || loading.value) return
  foodMenuOpen.value = !foodMenuOpen.value
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
      <div class="bear-food-picker">
        <button
          type="button"
          class="bear-food-trigger"
          aria-haspopup="listbox"
          :aria-expanded="foodMenuOpen"
          :disabled="Boolean(busyKey) || loading"
          @click="toggleFoodMenu"
        >
          <img v-if="selectedFood" class="bear-food-trigger-icon" :src="foodImage(selectedFood.foodId)" :alt="" />
          <span>{{ selectedFood?.name ?? '选择要购买的食物…' }}</span>
          <span class="bear-food-chevron" aria-hidden="true">{{ foodMenuOpen ? '▲' : '▼' }}</span>
        </button>
        <ul v-if="foodMenuOpen" class="bear-food-menu" role="listbox" aria-label="食物列表">
          <li v-for="food in foods" :key="food.foodId" role="option" :aria-selected="selectedFoodId === food.foodId">
            <button type="button" :disabled="Boolean(busyKey)" @click="selectFood(food)">
              <img :src="foodImage(food.foodId)" :alt="" />
              <span>{{ food.name }}</span>
            </button>
          </li>
        </ul>
      </div>
      <div v-if="payPanelOpen && selectedFood" class="bear-pay-panel">
        <span class="bear-pay-label">
          <img :src="foodImage(selectedFood.foodId)" :alt="" />
          {{ selectedFood.name }}
        </span>
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
.bear-food-picker {
  position: relative;
  width: 100%;
}
.bear-food-trigger {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-width: 420px;
  min-height: 68px;
  padding: 10px 20px;
  border: 4px solid #71351c;
  border-radius: 16px;
  background: rgba(255, 248, 213, .95);
  color: #71351c;
  font: inherit;
  font-size: 28px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.bear-food-trigger:disabled { opacity: .55; cursor: not-allowed; }
.bear-food-trigger-icon { width: 48px; height: 48px; object-fit: contain; flex: 0 0 48px; }
.bear-food-chevron { margin-left: auto; font-size: 22px; line-height: 1; }
.bear-food-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 2;
  width: 100%;
  min-width: 420px;
  margin: 0;
  padding: 8px;
  list-style: none;
  border: 4px solid #71351c;
  border-radius: 16px;
  background: rgba(255, 252, 238, .98);
  box-shadow: 0 8px 0 rgba(113, 53, 28, .12);
}
.bear-food-menu li { margin: 0; padding: 0; }
.bear-food-menu button {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 64px;
  padding: 8px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #71351c;
  font: inherit;
  font-size: 26px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.bear-food-menu button:hover { background: rgba(255, 244, 189, .9); }
.bear-food-menu img { width: 48px; height: 48px; object-fit: contain; flex: 0 0 48px; }
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
.bear-pay-label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.bear-pay-label img { width: 44px; height: 44px; object-fit: contain; }
.bear-pay-panel button img { width: 36px; height: 36px; object-fit: contain; }

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

</style>
