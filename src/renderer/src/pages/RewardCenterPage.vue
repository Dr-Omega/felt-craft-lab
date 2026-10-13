<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PaymentDialog from '../components/plaza/PaymentDialog.vue'
import type {
  Currency,
  InboxMessage,
  RewardConfig,
  RewardDashboard,
  StoreProduct,
  BearFood,
  UserRole
} from '@shared/contracts/rewards'
import type { SharedError } from '@shared/contracts'
import { openPlaza, openPersonalCenter, openLobby } from '../app-nav'
import { showCenterToast } from '../composables/center-toast'
import { loadPlazaSession } from '../services/plaza-session'
import {
  saveBearRoom,
  claimInboxReward,
  convertDiamonds,
  feedBear,
  loadRewardConfig,
  loadRewardDashboard,
  loadRewardInbox,
  redeemProduct,
  saveRewardConfig
} from '../services/reward-api'
import { rewardAssets } from '../ui/reward-assets'
import { profileAssets } from '../ui/profile-assets'

type TabId = 'account' | 'inbox' | 'teacher' | 'store' | 'bear' | 'admin'
const props = withDefaults(defineProps<{ initialTab?: TabId; embedded?: boolean }>(), { initialTab: 'account', embedded: false })
const emit = defineEmits<{ account: [] }>()

const session = loadPlazaSession()
const dashboard = ref<RewardDashboard | null>(null)
const inbox = ref<InboxMessage[]>([])
const config = ref<RewardConfig | null>(null)
const activeTab = ref<TabId>(props.initialTab)
const loading = ref(true)
const busyKey = ref('')
const convertAmount = ref(1)
const rechargeOpen = ref(false)
const blindBoxReveal = ref<(typeof rewardAssets.blindBox)[number] | null>(null)
const selectedIp = ref('小熊')
const selectedFurniture = ref('原木色')
const roomRevision = ref(0)
const roomLoaded = ref(false)
const ipActionMessage = ref('')
const furnitureColors = ['原木色', '薄荷绿', '樱花粉']
const ipVariants = [
  { name: '小熊', action: '挥挥手' },
  { name: '小兔', action: '跳一跳' },
  { name: '小猫', action: '眨眨眼' }
]
const bearRoomStyle = computed(() => ({
  filter: selectedFurniture.value === '薄荷绿' ? 'hue-rotate(42deg) saturate(.9)' : selectedFurniture.value === '樱花粉' ? 'hue-rotate(315deg) saturate(1.05)' : 'none'
}))

const role = computed<UserRole>(() => dashboard.value?.user.role ?? session?.user.role ?? 'child')
const wallet = computed(() => dashboard.value?.wallet ?? { coins: 0, diamonds: 0, updatedAt: '' })
const tabs = computed<Array<{ id: TabId; label: string }>>(() => {
  if (role.value === 'admin') return [{ id: 'admin', label: '规则后台' }]
  if (role.value === 'parent') return [{ id: 'account', label: '家长中心' }]
  const items: Array<{ id: TabId; label: string }> = [{ id: 'account', label: '账户与流水' }]
  if (role.value === 'child') items.push({ id: 'inbox', label: `反馈邮箱${dashboard.value?.inboxPendingCount ? ` (${dashboard.value.inboxPendingCount})` : ''}` })
  if (role.value === 'art_teacher' || role.value === 'chinese_teacher') items.push({ id: 'teacher', label: '教师等级' })
  items.push({ id: 'store', label: '兑换商城' })
  if (role.value === 'child' && props.initialTab === 'bear') items.push({ id: 'bear', label: '小熊的家' })
  return items
})

function errorMessage(error: unknown): string {
  const shared = error as SharedError
  return typeof shared?.message === 'string' && shared.message.trim() ? shared.message : '操作没有完成，请稍后再试。'
}

function applyWallet(next: { coins: number; diamonds: number; updatedAt: string }): void {
  if (!dashboard.value) return
  dashboard.value = { ...dashboard.value, wallet: next }
}

async function refreshDashboard(): Promise<void> {
  if (!session?.token) return
  dashboard.value = await loadRewardDashboard(session.token)
  if (!roomLoaded.value && dashboard.value.room) {
    selectedIp.value = dashboard.value.room.character
    selectedFurniture.value = dashboard.value.room.furniture
    roomRevision.value = dashboard.value.room.revision
    roomLoaded.value = true
  }
}

async function refreshInbox(): Promise<void> {
  if (!session?.token || role.value !== 'child') return
  inbox.value = await loadRewardInbox(session.token)
}

async function loadPage(): Promise<void> {
  if (!session?.token) {
    openPlaza()
    return
  }
  loading.value = true
  try {
    await refreshDashboard()
    if (!tabs.value.some(tab => tab.id === activeTab.value)) activeTab.value = tabs.value[0].id
    if (role.value === 'child') await refreshInbox()
    if (role.value === 'admin') {
      config.value = await loadRewardConfig(session.token)
      activeTab.value = 'admin'
    }
  } catch (error) {
    showCenterToast(errorMessage(error))
  } finally {
    loading.value = false
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

async function convert(): Promise<void> {
  if (!session?.token) return
  await run('convert', async () => {
    const amount = Math.max(1, Math.floor(convertAmount.value || 1))
    const result = await convertDiamonds(session.token, amount)
    applyWallet(result.wallet)
    await refreshDashboard()
    showCenterToast(`${amount} 钻石已转换为 ${result.receivedCoins} 金币`)
  })
}


function runIpAction(): void {
  const ip = ipVariants.find((item) => item.name === selectedIp.value)
  ipActionMessage.value = ip ? `${ip.name}正在${ip.action}` : ''
}

async function saveRoom(): Promise<void> {
  if (!session?.token || !roomLoaded.value) return
  await run('room', async () => {
    const saved = await saveBearRoom(session.token, {
      character: selectedIp.value, furniture: selectedFurniture.value, revision: roomRevision.value
    })
    roomRevision.value = saved.revision
    showCenterToast('房间设置已保存')
  })
}

async function reloadRoom(): Promise<void> {
  await run('room', async () => {
    roomLoaded.value = false
    await refreshDashboard()
    showCenterToast('房间设置已载入')
  })
}

async function claim(message: InboxMessage): Promise<void> {
  if (!session?.token) return
  await run(`claim:${message.messageId}`, async () => {
    const result = await claimInboxReward(session.token, message.messageId)
    applyWallet(result.wallet)
    await Promise.all([refreshInbox(), refreshDashboard()])
    showCenterToast(`${message.rewardCoins} 金币已到账`)
  })
}

async function redeem(product: StoreProduct, currency: Currency): Promise<void> {
  if (!session?.token) return
  await run(`redeem:${product.productId}:${currency}`, async () => {
    const result = await redeemProduct(session.token, product.productId, currency)
    applyWallet(result.wallet)
    await refreshDashboard()
    if (product.productId === 'ip_blind_box') {
      const index = Math.floor(Math.random() * rewardAssets.blindBox.length)
      blindBoxReveal.value = rewardAssets.blindBox[index] ?? rewardAssets.blindBox[0]
    }
    showCenterToast(`已兑换：${productLabel(product)}`)
  })
}

async function feed(food: BearFood, currency: Currency): Promise<void> {
  if (!session?.token) return
  await run(`feed:${food.foodId}:${currency}`, async () => {
    const result = await feedBear(session.token, food.foodId, currency)
    applyWallet(result.wallet)
    await refreshDashboard()
    showCenterToast(`小熊吃到了${food.name}`)
  })
}

async function saveConfig(): Promise<void> {
  if (!session?.token || !config.value) return
  await run('config', async () => {
    config.value = await saveRewardConfig(session.token, config.value as RewardConfig)
    showCenterToast('奖励规则已保存，新行为将按新规则执行')
  })
}

function foodImage(foodId: BearFood['foodId']): string {
  return rewardAssets[foodId]
}

function productLabel(product: StoreProduct): string {
  return product.productId === 'ip_blind_box' ? 'IP 盲盒' : product.name
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    daily_login: '每日登录',
    diamond_to_coin: '钻石转金币',
    like_reward: '点赞奖励',
    review_reward: '点评奖励',
    teacher_review: '教师点评',
    recharge: '钻石充值',
    store_redemption: '商城兑换',
    bear_feeding: '小熊喂养'
  }
  return labels[reason] ?? reason
}

function teacherLevelLabel(level: string): string {
  return { ordinary: '普通', intermediate: '中级', advanced: '高级', expert: '专家' }[level] ?? level
}

function teacherLevelAsset(level: string): string {
  return rewardAssets.teacherLevels[level as keyof typeof rewardAssets.teacherLevels] ?? rewardAssets.teacherLevels.ordinary
}

onMounted(() => void loadPage())
</script>

<template>
  <main
    class="reward-center"
    :class="{ 'reward-center--embedded': embedded }"
    :style="{
      '--reward-panel-image': `url(${rewardAssets.growthCenter.basePanelNineSlice})`,
      '--reward-card-image': `url(${rewardAssets.growthCenter.cardNineSlice})`
    }"
  >
    <img class="reward-skin reward-skin--background" :src="rewardAssets.growthCenter.background" alt="" aria-hidden="true" />
    <div class="reward-panel">
      <div class="reward-scroll">
    <header class="reward-header">
      <div v-if="!embedded" class="reward-title">
        <h1>{{ activeTab === 'bear' ? '小熊的家' : activeTab === 'inbox' ? '反馈邮箱' : activeTab === 'store' ? '商城' : '账户与流水' }}</h1>
      </div>
      <div v-if="role !== 'parent' && role !== 'admin'" class="wallet-strip" aria-label="账户余额">
        <span class="wallet-chip">
          <img :src="rewardAssets.diamond" alt="钻石" />
          <strong>{{ wallet.diamonds }}</strong>
          <button type="button" class="wallet-plus" aria-label="充值钻石" @click="rechargeOpen = true">+</button>
        </span>
        <span class="wallet-chip">
          <img :src="rewardAssets.coin" alt="金币" />
          <strong>{{ wallet.coins }}</strong>
          <button v-if="initialTab !== 'bear'" type="button" class="wallet-plus" aria-label="钻石转换金币" @click="embedded ? emit('account') : (activeTab = 'account')">+</button>
        </span>
      </div>
    </header>

    <nav v-if="!embedded && initialTab !== 'bear'" class="reward-tabs" aria-label="成长中心导航">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <p v-if="loading" class="reward-loading">正在载入…</p>

    <section v-else-if="activeTab === 'account'" class="reward-content account-view">
      <template v-if="role === 'parent'">
        <div class="parent-band">
          <h2>家长中心</h2>
          <details><summary>账号规则</summary><p>家长可点赞，不参与金币、钻石奖励，也不能查看儿童邮箱。</p></details>
          <button type="button" class="primary" @click="openPlaza">去分享广场</button>
        </div>
      </template>
      <template v-else>
        <div class="account-band">
          <div>
            <span class="section-kicker">单向转换</span>
            <h2>钻石转换为金币</h2>
            <p>1 钻石 = 10 金币</p>
          </div>
          <div class="convert-control">
            <input v-model.number="convertAmount" type="number" min="1" :max="wallet.diamonds" aria-label="转换钻石数量" />
            <button type="button" class="primary" :disabled="busyKey === 'convert' || wallet.diamonds < 1" @click="convert">
              转换
            </button>
          </div>
        </div>

        <div class="ledger-section">
          <h2>账户流水</h2>
          <p v-if="!dashboard?.ledger.length" class="empty-state">暂无流水</p>
          <table v-else>
            <thead>
              <tr><th>时间</th><th>事项</th><th>币种</th><th>变化</th><th>余额</th></tr>
            </thead>
            <tbody>
              <tr v-for="entry in dashboard.ledger" :key="entry.ledgerId">
                <td>{{ new Date(entry.createdAt).toLocaleString('zh-CN') }}</td>
                <td>{{ reasonLabel(entry.reason) }}</td>
                <td>{{ entry.currency === 'coins' ? '金币' : '钻石' }}</td>
                <td :class="entry.amount > 0 ? 'positive' : 'negative'">{{ entry.amount > 0 ? '+' : '' }}{{ entry.amount }}</td>
                <td>{{ entry.balanceAfter }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <section v-else-if="activeTab === 'inbox'" class="reward-content inbox-view">
      <header class="section-heading"><h2>反馈邮箱</h2><span>{{ inbox.length }} 封</span></header>
      <p v-if="!inbox.length" class="empty-state">还没有新的反馈</p>
      <ul v-else class="message-list">
        <li v-for="message in inbox" :key="message.messageId" class="message-card">
          <img class="message-mail-art" :src="rewardAssets.mailBanner" alt="邮件" aria-hidden="true" />
          <div class="message-main">
            <div class="message-meta"><strong>{{ message.title }}</strong><span>{{ new Date(message.createdAt).toLocaleString('zh-CN') }}</span></div>
            <p>{{ message.body }}</p>
            <blockquote v-if="message.reviewComment">“{{ message.reviewComment }}”</blockquote>
            <span v-if="message.reviewScore" class="score-mark">{{ message.reviewScore }} 分</span>
          </div>
          <div class="message-reward">
            <span><img :src="rewardAssets.coin" alt="金币" />{{ message.rewardCoins }}</span>
            <button
              type="button"
              class="primary"
              :disabled="message.status === 'claimed' || busyKey === `claim:${message.messageId}`"
              @click="claim(message)"
            >
              {{ message.status === 'claimed' ? '已领取' : '领取' }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section v-else-if="activeTab === 'teacher'" class="reward-content teacher-view">
      <div class="teacher-status">
        <span class="section-kicker">{{ dashboard?.teacher?.direction === 'art' ? '美术方向' : '语文方向' }}</span>
        <h2>{{ teacherLevelLabel(dashboard?.teacher?.level ?? '') }}教师</h2>
        <div class="teacher-metrics">
          <div><strong>{{ dashboard?.teacher?.reviewCount ?? 0 }}</strong><span>有效点评</span></div>
          <div><strong>{{ dashboard?.teacher?.rewardPerReview ?? 0 }}</strong><span>每次金币</span></div>
          <div><strong>{{ dashboard?.teacher?.nextThreshold ?? '已满级' }}</strong><span>下一等级</span></div>
        </div>
      </div>
      <div class="level-track" aria-label="教师等级进度">
        <span v-for="level in ['ordinary', 'intermediate', 'advanced', 'expert']" :key="level"><img :src="teacherLevelAsset(level)" :alt="teacherLevelLabel(level)" /><small>{{ teacherLevelLabel(level) }}</small></span>
      </div>
      <button type="button" class="primary" @click="openPlaza">去点评作品</button>
    </section>

    <section v-else-if="activeTab === 'store'" class="reward-content store-view">
      <header class="section-heading"><h2>兑换商城</h2></header>
      <ul class="product-grid">
        <li v-for="(product, index) in dashboard?.products" :key="product.productId" class="product-card">
          <div v-if="product.productId === 'ip_blind_box'" class="blind-box-preview" aria-label="IP 盲盒角色预览">
            <img v-for="item in rewardAssets.blindBox" :key="item.id" :src="item.src" :alt="item.name" />
          </div>
          <div v-else class="fabric-swatch" :class="`swatch-${index + 1}`" aria-hidden="true"></div>
          <h3>{{ productLabel(product) }}</h3>
          <div class="price-actions">
            <button type="button" :disabled="Boolean(busyKey)" @click="redeem(product, 'coins')">
              <img :src="rewardAssets.coin" alt="金币" />{{ product.coinPrice }}
            </button>
            <button type="button" :disabled="Boolean(busyKey)" @click="redeem(product, 'diamonds')">
              <img :src="rewardAssets.diamond" alt="钻石" />{{ product.diamondPrice }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section v-else-if="activeTab === 'bear'" class="reward-content bear-view">
      <div class="bear-room">
        <img class="bear-room-image" :style="bearRoomStyle" :src="rewardAssets.bearRoom" alt="小熊的家" />
        <div class="bear-room-state"><strong>{{ selectedIp }}</strong><span>{{ selectedFurniture }} · {{ ipActionMessage || '等待互动' }}</span></div>
      </div>
      <div class="food-tray">
        <section class="bear-customizer" aria-label="小熊房间动态内容">
          <h2>房间与 IP</h2>
          <label>IP 角色<select v-model="selectedIp" :disabled="Boolean(busyKey)"><option v-for="ip in ipVariants" :key="ip.name" :value="ip.name">{{ ip.name }}</option></select></label>
          <button type="button" class="custom-action" @click="runIpAction">文字互动</button>
          <div class="furniture-choice"><span>房间配色预览</span><button v-for="color in furnitureColors" :key="color" type="button" :disabled="Boolean(busyKey)" :class="{ selected: selectedFurniture === color }" @click="selectedFurniture = color">{{ color }}</button></div>
          <button type="button" class="primary" :disabled="Boolean(busyKey) || !roomLoaded" @click="saveRoom">保存房间设置</button>
          <button type="button" :disabled="Boolean(busyKey)" @click="reloadRoom">重新载入房间设置</button>
        </section>
        <article v-for="food in dashboard?.foods" :key="food.foodId" class="food-item">
          <img :src="foodImage(food.foodId)" :alt="food.name" />
          <h3>{{ food.name }}</h3>
          <div class="price-actions">
            <button type="button" :disabled="Boolean(busyKey)" @click="feed(food, 'coins')">
              <img :src="rewardAssets.coin" alt="金币" />{{ food.coinPrice }}
            </button>
            <button type="button" :disabled="Boolean(busyKey)" @click="feed(food, 'diamonds')">
              <img :src="rewardAssets.diamond" alt="钻石" />{{ food.diamondPrice }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <section v-else-if="activeTab === 'admin' && config" class="reward-content admin-view">
      <header class="section-heading"><h2>奖励规则</h2><button type="button" class="primary" :disabled="busyKey === 'config'" @click="saveConfig">保存</button></header>
      <div class="config-row">
        <label>每日登录钻石<input v-model.number="config.dailyLoginDiamonds" type="number" min="0" /></label>
        <label>点赞奖励金币<input v-model.number="config.likeRewardCoins" type="number" min="0" /></label>
      </div>
      <h3>教师升级阈值</h3>
      <div class="config-row">
        <label>中级<input v-model.number="config.teacherThresholds[0]" type="number" min="1" /></label>
        <label>高级<input v-model.number="config.teacherThresholds[1]" type="number" min="2" /></label>
        <label>专家<input v-model.number="config.teacherThresholds[2]" type="number" min="3" /></label>
      </div>
      <h3>教师与儿童奖励</h3>
      <div class="config-table-scroll">
        <table class="config-table">
          <thead><tr><th>等级</th><th>教师金币</th><th>儿童 1-6 分</th><th>儿童 7-8 分</th><th>儿童 9-10 分</th></tr></thead>
          <tbody>
            <tr v-for="level in (['ordinary', 'intermediate', 'advanced', 'expert'] as const)" :key="level">
              <th>{{ teacherLevelLabel(level) }}</th>
              <td><input v-model.number="config.teacherRewards[level]" type="number" min="0" /></td>
              <td v-for="band in [0, 1, 2]" :key="band"><input v-model.number="config.childScoreRewards[level][band]" type="number" min="0" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
      </div>
    </div>
    <img class="reward-skin reward-skin--frame" :src="rewardAssets.growthCenter.frameOverlay" alt="" aria-hidden="true" />
    <button v-if="!embedded" type="button" class="reward-back" :aria-label="initialTab === 'bear' ? '返回游戏大厅' : '返回个人中心'" @click="initialTab === 'bear' ? openLobby() : openPersonalCenter()">
      <img :src="profileAssets.back" alt="" />
    </button>
  </main>
  <PaymentDialog v-if="rechargeOpen && session" :token="session.token" :user-id="session.user.userId" @close="rechargeOpen = false" @paid="refreshDashboard" />
  <div
    v-if="blindBoxReveal"
    class="recharge-backdrop"
    :style="{ '--reward-card-image': `url(${rewardAssets.growthCenter.cardNineSlice})` }"
    @click.self="blindBoxReveal = null"
  >
    <section class="blind-box-dialog" role="dialog" aria-modal="true" aria-label="盲盒结果">
      <span>恭喜抽中</span>
      <img :src="blindBoxReveal.src" :alt="blindBoxReveal.name" />
      <h2>{{ blindBoxReveal.name }}</h2>
      <button type="button" class="primary" @click="blindBoxReveal = null">收下</button>
    </section>
  </div>
</template>

<style scoped>
.reward-center {
  position: relative;
  isolation: isolate;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: #fff2b3;
  color: #493d33;
}

.reward-skin { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; user-select: none; }
.reward-skin--background { z-index: 0; object-fit: cover; }
.reward-skin--frame { z-index: 30; object-fit: fill; }
.reward-panel {
  position: absolute;
  inset: clamp(52px, 7.8vh, 86px) clamp(64px, 9.2vw, 177px);
  z-index: 1;
  overflow: hidden;
  border: clamp(34px, 4vw, 72px) solid transparent;
  border-image-source: var(--reward-panel-image);
  border-image-slice: 150 fill;
  border-image-width: clamp(34px, 4vw, 72px);
  border-image-repeat: stretch;
  background: transparent;
}
.reward-scroll {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px 34px 48px;
  overflow-x: hidden;
  overflow-y: auto;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.reward-content, .reward-loading { position: relative; z-index: 2; }

.reward-header {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 160px 1fr auto;
  align-items: center;
  width: 100%;
  min-height: 110px;
  margin: 0 auto;
  padding: 12px 28px;
}

.reward-title { grid-column: 2; }
.wallet-strip { grid-column: 3; }
.reward-back {
  position: absolute;
  left: max(34px, calc(9.2vw + 28px));
  top: max(34px, calc(7.8vh + 24px));
  z-index: 40;
  width: clamp(112px, 9.4vw, 180px);
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.reward-back img { display: block; width: 100%; height: auto; object-fit: contain; }
.reward-back:hover { filter: brightness(1.06); }
.reward-back:active { transform: translateY(2px); }
.reward-title h1 { margin: 0; font-size: 30px; letter-spacing: 0; white-space: nowrap; }

.wallet-strip { display: flex; flex-wrap: wrap; gap: 16px; }
.wallet-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 185px;
  height: 88px;
  padding: 12px 18px;
  border: 14px solid transparent;
  border-image-source: var(--reward-card-image);
  border-image-slice: 42 fill;
  border-image-width: 14px;
  border-image-repeat: stretch;
  background: transparent;
  font-size: 30px;
}
.wallet-chip img { width: 48px; height: 48px; object-fit: contain; }
.price-actions img, .message-reward img { width: 30px; height: 30px; object-fit: contain; }
.wallet-plus { width: 42px; height: 42px; margin-left: auto; border: 0; border-radius: 50%; background: #c65a3f; color: #fff; font-size: 30px; line-height: 1; }

.reward-tabs {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 54px;
  margin: 0 auto;
  padding: 0 24px;
}
.reward-tabs button { padding: 0 20px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: #675b50; }
.reward-tabs button.active { border-bottom-color: #b4473d; color: #8c302a; font-weight: 700; }

.reward-content { width: 100%; margin: 0 auto; padding: 28px 0 64px; }
.reward-loading, .empty-state { padding: 48px; text-align: center; color: #81766b; }
.section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.section-heading h2, .ledger-section h2 { margin: 0; font-size: 26px; }
.section-kicker { color: #a0443c; font-size: 15px; font-weight: 700; }

.account-band, .parent-band, .teacher-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 24px 28px;
  border: 18px solid transparent;
  border-image-source: var(--reward-card-image);
  border-image-slice: 42 fill;
  border-image-width: 18px;
  border-image-repeat: stretch;
  background: transparent;
}
.account-band h2, .parent-band h2, .teacher-status h2 { margin: 4px 0 8px; }
.account-band p, .parent-band p { margin: 4px 0; }
.convert-control { display: flex; gap: 10px; }
.convert-control input { width: 110px; min-height: 48px; padding: 0 12px; border: 1px solid #b9afa2; border-radius: 6px; font: inherit; }

.ledger-section {
  margin-top: 24px;
  padding: 24px 28px;
  border: 18px solid transparent;
  border-image-source: var(--reward-card-image);
  border-image-slice: 42 fill;
  border-image-width: 18px;
  border-image-repeat: stretch;
  background: transparent;
}
table { width: 100%; border-collapse: collapse; background: transparent; }
th, td { padding: 13px 14px; border-bottom: 1px solid #e1dbd1; text-align: left; }
th { color: #675b50; font-size: 15px; }
.positive { color: #28725d; font-weight: 700; }
.negative { color: #a13b34; font-weight: 700; }

.message-list, .product-grid { margin: 0; padding: 0; list-style: none; }
.message-list { display: grid; gap: 12px; }
.message-card {
  display: grid;
  grid-template-columns: 1fr 150px;
  gap: 24px;
  padding: 20px 24px;
  border: 18px solid transparent;
  border-image-source: var(--reward-card-image);
  border-image-slice: 42 fill;
  border-image-width: 18px;
  border-image-repeat: stretch;
  background: transparent;
}
.message-mail-art { position: absolute; left: 12px; top: 12px; width: 82px; height: 15px; object-fit: fill; opacity: .86; }
.message-card { position: relative; padding-top: 32px; }
.message-meta { display: flex; justify-content: space-between; gap: 16px; }
.message-meta span { color: #85796d; font-size: 14px; }
.message-main p { margin: 12px 0; }
.message-main blockquote { margin: 10px 0; padding-left: 14px; border-left: 3px solid #d6a15a; color: #65564b; }
.score-mark { display: inline-block; padding: 4px 9px; border-radius: 4px; background: #e8f1ed; color: #286755; }
.message-reward { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 10px; }
.message-reward span { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 22px; }

.teacher-status { display: block; }
.teacher-metrics { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 24px; }
.teacher-metrics div { display: flex; flex-direction: column; gap: 5px; padding: 10px 24px; border-left: 1px solid #d8c9ae; }
.teacher-metrics div:first-child { border-left: 0; padding-left: 0; }
.teacher-metrics strong { font-size: 30px; }
.teacher-metrics span { color: #766858; }
.level-track { display: grid; grid-template-columns: repeat(4, 1fr); margin: 28px 0; border-top: 5px solid #d9b06b; }
.level-track span { display: grid; justify-items: center; gap: 3px; padding-top: 12px; text-align: center; }.level-track img { width: 78px; height: 29px; object-fit: contain; }.level-track small { color: #766858; }

.product-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.product-card, .food-item {
  padding: 18px;
  border: 18px solid transparent;
  border-image-source: var(--reward-card-image);
  border-image-slice: 42 fill;
  border-image-width: 18px;
  border-image-repeat: stretch;
  background: transparent;
}
.product-card {
  display: grid;
  grid-template-columns: minmax(140px, .85fr) minmax(190px, 1.15fr);
  grid-template-rows: auto 1fr;
  align-items: center;
  gap: 10px 20px;
  min-width: 0;
}
.product-card > :first-child { grid-row: 1 / 3; }
.product-card h3 { grid-column: 2; align-self: end; min-height: 0; margin: 0; font-size: 22px; }
.food-item h3 { min-height: 48px; margin: 14px 0; font-size: 20px; }
.fabric-swatch { width: 100%; height: 180px; border-radius: 6px; background: linear-gradient(135deg, #d54b42 0 25%, #f2c34c 25% 50%, #3b8e75 50% 75%, #426ca9 75%); }
.blind-box-preview { display: grid; grid-template-columns: repeat(2, 1fr); width: 100%; height: 180px; overflow: hidden; border-radius: 6px; background: #1b1613; }
.blind-box-preview img { display: block; width: 100%; height: 90px; object-fit: cover; }
.swatch-2 { background: linear-gradient(135deg, #83634c 0 33%, #d9c3a7 33% 66%, #6d8b7d 66%); }
.swatch-3 { background: linear-gradient(135deg, #9f4f62, #e4b65e 50%, #5a769e); }
.swatch-4 { background: linear-gradient(135deg, #4d8b68 0 50%, #d96d4d 50%); }
.price-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; min-width: 0; }
.price-actions button { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 48px; padding: 0 10px; border: 1px solid #cbbfae; border-radius: 6px; background: #faf8f3; color: #493d33; }
.product-card .price-actions { grid-column: 2; align-self: start; }

.bear-view { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr); gap: 28px; }
.bear-room { aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid #cbbfae; border-radius: 8px; background: #a17d4d; }
.bear-room-image { display: block; width: 100%; height: 100%; object-fit: cover; transition: filter 180ms ease; }
.bear-room { position: relative; }
.bear-room-state { position: absolute; left: 18px; bottom: 18px; display: grid; gap: 3px; padding: 9px 13px; border-radius: 7px; background: rgba(255, 250, 231, .88); color: #563c2d; }
.bear-room-state span { font-size: 13px; color: #80634c; }
.bear-customizer {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 18px solid transparent;
  border-image-source: var(--reward-card-image);
  border-image-slice: 42 fill;
  border-image-width: 18px;
  border-image-repeat: stretch;
  background: transparent;
}
.bear-customizer h2 { margin: 0; font-size: 20px; }.bear-customizer label { display: grid; gap: 6px; color: #766858; }.bear-customizer select { min-height: 38px; padding: 4px 8px; border: 1px solid #c9beb0; border-radius: 5px; font: inherit; }.custom-action { min-height: 40px; border: 1px solid #b88a55; border-radius: 6px; background: #fff5d8; color: #70431f; }.furniture-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #766858; }.furniture-choice button { padding: 5px 8px; border: 1px solid #cbbfae; border-radius: 5px; background: #faf8f3; color: #493d33; }.furniture-choice button.selected { border-color: #b4473d; background: #ffe4c4; }
.food-tray { display: grid; gap: 12px; }
.food-item { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 8px 14px; }
.food-item > img { grid-row: 1 / 3; width: 88px; height: 88px; object-fit: contain; }
.food-item h3 { min-height: 0; margin: 0; }

.admin-view h3 { margin-top: 32px; }
.config-row { display: flex; flex-wrap: wrap; gap: 16px; }
.config-row label { display: grid; gap: 7px; min-width: 190px; }
.config-row input, .config-table input { min-height: 42px; padding: 6px 10px; border: 1px solid #c9beb0; border-radius: 5px; font: inherit; }
.config-table-scroll { max-width: 100%; overflow-x: auto; }
.config-table { min-width: 700px; }
.config-table input { width: 100px; }
.recharge-backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(30, 20, 15, .38); }
.recharge-dialog { width: min(420px, calc(100% - 32px)); padding: 28px; border: 18px solid transparent; border-image-source: var(--reward-card-image); border-image-slice: 42 fill; border-image-width: 18px; border-image-repeat: stretch; background: transparent; }
.recharge-dialog h2 { margin: 0 0 8px; }.recharge-dialog p { color: #766858; }.recharge-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }.recharge-options button { min-height: 42px; border: 1px solid #cbbfae; border-radius: 6px; background: #faf8f3; color: #493d33; }.recharge-options button.selected { border-color: #b4473d; background: #ffe4c4; }.recharge-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }.recharge-actions button { min-height: 42px; padding: 0 14px; border: 1px solid #cbbfae; border-radius: 6px; background: #faf8f3; color: #493d33; }
.blind-box-dialog { display: grid; justify-items: center; gap: 12px; width: min(430px, calc(100% - 32px)); padding: 24px; border: 18px solid transparent; border-image-source: var(--reward-card-image); border-image-slice: 42 fill; border-image-width: 18px; border-image-repeat: stretch; background: transparent; text-align: center; }.blind-box-dialog > span { color: #9b3d2e; font-size: 20px; font-weight: 700; }.blind-box-dialog img { display: block; width: min(280px, 100%); aspect-ratio: 1; border-radius: 8px; object-fit: cover; }.blind-box-dialog h2 { margin: 0; font-size: 30px; }.blind-box-dialog .primary { min-width: 140px; min-height: 44px; }

@media (max-width: 1200px) {
  .reward-header {
    grid-template-columns: 1fr;
    justify-items: center;
    gap: 12px;
    min-height: 0;
  }
  .reward-title, .wallet-strip { grid-column: 1; }
  .reward-title { text-align: center; }
  .wallet-strip { justify-content: center; }
  .product-grid { grid-template-columns: 1fr; }
}

@media (max-width: 900px) {
  .reward-panel { inset: 24px 18px; border-width: 26px; border-image-width: 26px; }
  .reward-scroll { padding: 42px 10px 28px; }
  .reward-back { left: 34px; top: 36px; width: 96px; }
  .reward-header, .reward-tabs { width: 100%; }
  .reward-header { grid-template-columns: 1fr; padding: 12px 8px; }
  .reward-title { grid-column: 1; }
  .wallet-strip { grid-column: 1; margin-top: 10px; }
  .reward-tabs { overflow-x: auto; padding: 0 14px; }
  .reward-content { width: 100%; }
  .account-band, .parent-band { flex-direction: column; align-items: stretch; gap: 14px; }
  .account-band h2, .parent-band h2, .account-band p, .parent-band p { margin: 0; }
  .convert-control { width: 100%; }
  .convert-control input { flex: 1; min-width: 0; }
  .parent-band .primary { align-self: flex-start; }
  .product-grid { grid-template-columns: 1fr; }
  .bear-view { grid-template-columns: 1fr; }
  .message-card { grid-template-columns: 1fr; }
}

@media (max-width: 600px) {
  .product-card { grid-template-columns: 1fr; grid-template-rows: auto; }
  .product-card > :first-child, .product-card h3, .product-card .price-actions { grid-column: 1; grid-row: auto; }
}
.reward-center--embedded { height: auto; min-height: 400px; overflow: visible; background: transparent; }
.reward-center--embedded .reward-skin { display: none; }
.reward-center--embedded .reward-panel { position: relative; inset: auto; border: 0; overflow: visible; }
.reward-center--embedded .reward-scroll { height: auto; padding: 0; overflow: visible; }
.reward-center--embedded .reward-header { display: flex; flex-wrap: wrap; justify-content: space-between; padding: 0 0 18px; }
</style>
