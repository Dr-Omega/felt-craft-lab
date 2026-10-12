<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PaymentDialog from '../components/plaza/PaymentDialog.vue'
import type { DraftRecord, ProjectRecord } from '@shared/contracts'
import type { RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import ProjectPreviewModal from '../components/library/ProjectPreviewModal.vue'
import PlazaUploadDialog from '../components/plaza/PlazaUploadDialog.vue'
import { openLobby, openPlaza, openEditor, openRewards, openSavedWork, logout } from '../app-nav'
import { getFeltCraftDatabase, DraftStore, ProjectStore, StoryCardStore } from '../persistence'
import { listMySharedProjectIds, publishPlazaPost, withdrawPlazaPost } from '../services/plaza-api'
import { loadPlazaSession } from '../services/plaza-session'
import { loadRewardDashboard, convertDiamonds } from '../services/reward-api'
import { rewardAssets } from '../ui/reward-assets'
import { profileAssets } from '../ui/profile-assets'
import { plazaAvatarForRole } from '../ui/plaza-assets'
import { authAssets, authFullLayerStyle } from '../ui/auth-assets'
import { friendlyRelativeTime } from '../util/friendly-time'
import { showCenterToast } from '../composables/center-toast'
import { replayOnboardingTour } from '../services/onboarding-service'
import { ONBOARDING_PREPARE_EVENT, type OnboardingPrepareDetail } from '../services/onboarding-nav'

type Filter = 'draft' | 'drawing' | 'story' | 'blueprint' | 'completed'
type ProfileSection = 'works' | 'account'
type WorkItem = { kind: 'draft' | 'project'; id: string; title: string; updatedAt: string; previewUrl?: string; record: DraftRecord | ProjectRecord }

const session = loadPlazaSession()
const dashboard = ref<RewardDashboard | null>(null)
const drafts = ref<DraftRecord[]>([])
const projects = ref<ProjectRecord[]>([])
const storyWorkIds = ref(new Set<string>())
const sharedIds = ref<Set<string>>(new Set())
const filter = ref<Filter>('completed')
const profileSection = ref<ProfileSection>('works')
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const rechargeOpen = ref(false)
const convertAmount = ref(1)
const previewProject = ref<ProjectRecord | null>(null)
const uploadTarget = ref<ProjectRecord | null>(null)

const wallet = computed(() => dashboard.value?.wallet ?? { coins: 0, diamonds: 0, updatedAt: '' })
const profileUsername = computed(() => dashboard.value?.user.username ?? session?.user.username ?? '用户')
const profileAvatar = computed(() => plazaAvatarForRole(dashboard.value?.user.role ?? session?.user.role ?? 'child'))
const visibleWorks = computed<WorkItem[]>(() => {
  const draftItems: WorkItem[] = drafts.value.map((record) => ({
    kind: 'draft', id: record.draftId, title: record.scene.workName?.trim() || '未命名草稿', updatedAt: record.updatedAt, record
  }))
  const projectItems: WorkItem[] = projects.value.map((record) => ({
    kind: 'project', id: record.projectId, title: record.projectName?.trim() || '未命名作品', updatedAt: record.updatedAt, previewUrl: record.previewUrl, record
  }))
  return [...draftItems, ...projectItems]
    .filter((item) => {
      if (filter.value === 'draft') return item.kind === 'draft'
      if (item.kind !== 'project') return false
      const record = item.record as ProjectRecord
      const storyLike = storyWorkIds.value.has(record.projectId)
      if (filter.value === 'drawing') return true
      if (filter.value === 'story') return storyLike
      if (filter.value === 'blueprint') return false // No persisted manufacturing/export artifact yet; do not label collages as blueprints.
      return true
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
})

function isShared(project: ProjectRecord): boolean { return sharedIds.value.has(project.projectId) }
function selectFilter(nextFilter: Filter): void { filter.value = nextFilter }
function projectTitle(project: ProjectRecord): string { return project.projectName?.trim() || '我的作品' }
function draftTitle(draft: DraftRecord): string { return draft.scene.workName?.trim() || '未命名草稿' }
function projectFor(item: WorkItem): ProjectRecord | null { return item.kind === 'project' ? item.record as ProjectRecord : null }
function canPublish(item: WorkItem): boolean { const project = projectFor(item); return Boolean(project && !isShared(project)) }
function publishItem(item: WorkItem): void { const project = projectFor(item); if (project) askUpload(project) }
function withdrawItem(item: WorkItem): void { const project = projectFor(item); if (project) void withdraw(project) }

function replayGuide(): void {
  openLobby()
  replayOnboardingTour()
}

function uploadFirstAvailable(): void {
  const project = projects.value.find((item) => item.previewUrl && !sharedIds.value.has(item.projectId))
  if (project) askUpload(project)
  else showCenterToast('暂时没有可上传的新作品')
}

async function refresh(): Promise<void> {
  if (!session?.token) { openPlaza(); return }
  loading.value = true
  try {
    const db = getFeltCraftDatabase()
    drafts.value = (await new DraftStore(db).list()).filter(row => row.scene.userId === session.user.userId)
    projects.value = (await new ProjectStore(db).list()).filter(row => row.scene.userId === session.user.userId)
    storyWorkIds.value = new Set((await Promise.all(projects.value.map(async project => (await new StoryCardStore(db).getByWorkId(project.projectId)) ? project.projectId : null))).filter((id): id is string => id !== null))
    const [nextDashboard, ids] = await Promise.all([
      loadRewardDashboard(session.token),
      listMySharedProjectIds(session.token).catch(() => [])
    ])
    dashboard.value = nextDashboard
    sharedIds.value = new Set(ids)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '个人中心载入失败。'
  } finally { loading.value = false }
}

async function openWork(item: WorkItem): Promise<void> {
  if (item.kind === 'project' && filter.value === 'story') {
    try { await openSavedWork(item.id, 'story-card', 'profile') } catch (error) { message.value = (error as Error).message }
    return
  }
  if (item.kind === 'draft') {
    const draft = item.record as DraftRecord
    openEditor({ mode: 'draft', scene: draft.scene, draftId: draft.draftId })
  } else {
    const project = item.record as ProjectRecord
    openEditor({ mode: 'project', scene: project.scene, projectId: project.projectId })
  }
}

function showDetails(item: WorkItem): void {
  if (item.kind === 'project') previewProject.value = item.record as ProjectRecord
  else showCenterToast('草稿可以继续编辑，保存后即可查看详情。')
}

function askUpload(project: ProjectRecord): void {
  if (!project.previewUrl || isShared(project)) return
  uploadTarget.value = project
}

async function confirmUpload(title: string): Promise<void> {
  if (!session?.token || !uploadTarget.value?.previewUrl) return
  busy.value = true
  try {
    await publishPlazaPost({ token: session.token, projectId: uploadTarget.value.projectId, title, previewRef: uploadTarget.value.previewUrl })
    showCenterToast('已发布到分享社区')
    uploadTarget.value = null
    await refresh()
  } catch (error) { message.value = error instanceof Error ? error.message : '发布失败。' }
  finally { busy.value = false }
}

async function withdraw(project: ProjectRecord): Promise<void> {
  if (!session?.token) return
  busy.value = true
  try { await withdrawPlazaPost(session.token, project.projectId); showCenterToast('已撤回分享'); await refresh() }
  catch (error) { message.value = error instanceof Error ? error.message : '撤回失败。' }
  finally { busy.value = false }
}


async function convert(): Promise<void> {
  if (!session?.token) return
  busy.value = true
  try {
    const amount = Math.max(1, Math.floor(convertAmount.value || 1))
    const result = await convertDiamonds(session.token, amount)
    dashboard.value = dashboard.value ? { ...dashboard.value, wallet: result.wallet } : dashboard.value
    showCenterToast(`${amount} 钻石已转换为 ${result.receivedCoins} 金币`)
  } catch (error) { message.value = error instanceof Error ? error.message : '转换失败。' }
  finally { busy.value = false }
}

const syncRefresh = () => { void refresh() }

function onOnboardingPrepare(event: Event): void {
  const detail = (event as CustomEvent<OnboardingPrepareDetail>).detail
  if (detail?.profileSection) profileSection.value = detail.profileSection
  if (detail?.profileFilter) filter.value = detail.profileFilter
}

onMounted(() => {
  void refresh()
  window.addEventListener('felt-workspace-synced', syncRefresh)
  window.addEventListener(ONBOARDING_PREPARE_EVENT, onOnboardingPrepare)
})
onUnmounted(() => {
  window.removeEventListener('felt-workspace-synced', syncRefresh)
  window.removeEventListener(ONBOARDING_PREPARE_EVENT, onOnboardingPrepare)
})
</script>

<template>
  <AuthArtboard>
    <img class="profile-layer" :style="authFullLayerStyle" :src="authAssets.background" alt="" aria-hidden="true" />
    <img class="profile-layer profile-layer--frame" :style="authFullLayerStyle" :src="profileAssets.frameFull" alt="" aria-hidden="true" />
    <button type="button" class="profile-back" aria-label="返回游戏大厅" @click="openLobby"><img :src="profileAssets.back" alt="" /></button>

    <nav class="profile-side-nav" aria-label="个人中心导航">
      <button type="button" :class="{ active: profileSection === 'account' }" aria-label="账号" @click="profileSection = 'account'">
        <img :src="profileAssets.account" alt="账号" />
      </button>
      <button type="button" data-tour-id="tour-profile-works" :class="{ active: profileSection === 'works' }" aria-label="作品" @click="profileSection = 'works'">
        <img :src="profileAssets.works" alt="作品" />
      </button>
    </nav>

    <nav v-if="profileSection === 'works'" class="profile-filter-nav" aria-label="作品筛选">
      <button type="button" :class="{ active: filter === 'draft' }" aria-label="进度草稿" @click="selectFilter('draft')"><img :src="profileAssets.drafts" alt="进度草稿" /></button>
      <button type="button" :class="{ active: filter === 'drawing' }" aria-label="创作图画" @click="selectFilter('drawing')"><img :src="profileAssets.createDrawing" alt="创作图画" /></button>
      <button type="button" data-tour-id="tour-profile-story" :class="{ active: filter === 'story' }" aria-label="故事卡" @click="selectFilter('story')"><img :src="profileAssets.story" alt="故事卡" /></button>
      <button type="button" :class="{ active: filter === 'blueprint' }" aria-label="制作图纸" @click="selectFilter('blueprint')"><img :src="profileAssets.blueprint" alt="制作图纸" /></button>
      <button type="button" :class="{ active: filter === 'completed' }" aria-label="完成作品" @click="selectFilter('completed')"><img :src="profileAssets.completed" alt="完成作品" /></button>
    </nav>

    <button v-if="profileSection === 'works'" type="button" class="profile-upload" aria-label="上传作品" @click="uploadFirstAvailable"><img :src="profileAssets.upload" alt="上传" /></button>

    <main class="profile-panel" :aria-label="profileSection === 'works' ? '作品列表' : '账号信息'">
      <section v-if="profileSection === 'works'" class="works-section">
        <p v-if="loading" role="status">正在加载我的作品…</p>
        <p v-else-if="!visibleWorks.length" class="empty-state">{{ filter === 'blueprint' ? '尚无已保存的制作图纸；普通拼贴不会被自动归类为图纸。' : '此分类暂无作品。' }}</p>
        <ul v-if="!loading && visibleWorks.length" class="work-grid">
          <li v-for="item in visibleWorks" :key="`${item.kind}-${item.id}`" class="work-card" :style="{ backgroundImage: `url(${rewardAssets.communityCard})` }">
            <button type="button" class="work-preview" @click="showDetails(item)"><img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.title" /><span v-else>草稿</span></button>
            <div class="work-info"><strong>{{ item.title }}</strong><span>{{ friendlyRelativeTime(item.updatedAt) }} · {{ item.kind === 'draft' ? '草稿' : (sharedIds.has(item.id) ? '已发布' : '未发布') }}</span></div>
            <div class="work-actions"><button type="button" @click="openWork(item)">{{ item.kind === 'draft' ? '继续编辑' : '打开' }}</button><button v-if="canPublish(item)" type="button" :disabled="!item.previewUrl" @click="publishItem(item)">发布</button><button v-else-if="item.kind === 'project'" type="button" @click="withdrawItem(item)">撤回</button></div>
          </li>
        </ul>
      </section>
      <section v-else class="account-section">
        <header class="profile-header">
          <div class="profile-identity" :aria-label="`当前用户 ${profileUsername}`">
            <span class="profile-avatar-frame"><img class="profile-avatar" :src="profileAvatar" alt="用户头像" /></span>
            <strong class="profile-username" :title="profileUsername">{{ profileUsername }}</strong>
          </div>
          <button type="button" class="wallet-detail" data-tour-id="tour-profile-rewards" @click="openRewards">成长中心</button>
          <button type="button" class="wallet-detail guide-replay" @click="replayGuide">玩法指引</button>
          <button type="button" class="wallet-detail" @click="logout">退出登录</button>
        </header>

        <div class="profile-wallet" aria-label="账户余额">
          <article class="wallet-card">
            <img :src="rewardAssets.diamond" alt="钻石" />
            <div><span>钻石</span><strong>{{ wallet.diamonds }}</strong></div>
            <button type="button" aria-label="充值钻石" @click="rechargeOpen = true">+</button>
          </article>
          <article class="wallet-card">
            <img :src="rewardAssets.coin" alt="金币" />
            <div><span>金币</span><strong>{{ wallet.coins }}</strong></div>
          </article>
        </div>

        <div class="profile-convert">
          <strong>钻石转换金币</strong>
          <span class="rate">1 钻石 = 10 金币</span>
          <label>数量 <input v-model.number="convertAmount" type="number" min="1" :max="wallet.diamonds" aria-label="转换钻石数量" /></label>
          <button type="button" class="small-action" :disabled="busy || wallet.diamonds < 1" @click="convert">转换</button>
        </div>
      </section>
      <p v-if="message" class="profile-message">{{ message }}</p>
    </main>
  </AuthArtboard>

  <PaymentDialog v-if="rechargeOpen && session" :token="session.token" :user-id="session.user.userId" @close="rechargeOpen = false" @paid="refresh" />
  <ProjectPreviewModal :project="previewProject" :open="Boolean(previewProject)" @close="previewProject = null" @open="project => { previewProject = null; openEditor({ mode: 'project', scene: project.scene, projectId: project.projectId }) }" />
  <PlazaUploadDialog :open="Boolean(uploadTarget)" :default-title="uploadTarget ? projectTitle(uploadTarget) : ''" :busy="busy" @close="uploadTarget = null" @confirm="confirmUpload" />
</template>

<style scoped>
.profile-layer { position: absolute; display: block; pointer-events: none; user-select: none; }
.profile-layer--frame { z-index: 2; }
.profile-back,
.profile-side-nav button,
.profile-filter-nav button,
.profile-upload { position: absolute; z-index: 6; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
.profile-back { left: 270px; top: 140px; width: 180px; height: 81px; }
.profile-back img,
.profile-side-nav img,
.profile-filter-nav img,
.profile-upload img { display: block; width: 100%; height: 100%; object-fit: contain; }
.profile-back:hover,
.profile-side-nav button:hover,
.profile-filter-nav button:hover,
.profile-upload:hover { filter: brightness(1.06); }
.profile-back:active,
.profile-side-nav button:active,
.profile-filter-nav button:active,
.profile-upload:active { transform: translateY(2px); }
.profile-side-nav,
.profile-filter-nav { position: absolute; inset: 0; z-index: 6; pointer-events: none; }
.profile-side-nav button { left: 312px; width: 209px; height: 101px; pointer-events: auto; }
.profile-side-nav button:first-child { top: 280px; }
.profile-side-nav button:last-child { top: 412px; }
.profile-filter-nav button { top: 140px; width: 212px; height: 77px; pointer-events: auto; }
.profile-filter-nav button:nth-child(1) { left: 500px; }
.profile-filter-nav button:nth-child(2) { left: 736px; top: 139px; }
.profile-filter-nav button:nth-child(3) { left: 973px; }
.profile-filter-nav button:nth-child(4) { left: 1211px; }
.profile-filter-nav button:nth-child(5) { left: 1440px; }
.profile-side-nav button:not(.active),
.profile-filter-nav button:not(.active) { filter: saturate(.72) brightness(.94); opacity: .86; }
.profile-side-nav button.active,
.profile-filter-nav button.active { filter: drop-shadow(0 5px 2px rgba(91, 47, 25, .22)); }
.profile-upload { left: 1281px; top: 863px; width: 217px; height: 104px; }
.profile-panel { position: absolute; z-index: 4; left: 560px; top: 225px; width: 1000px; height: 630px; padding: 24px 30px; overflow: auto; color: #563c2d; }
.account-section { padding: 28px 18px; }
.profile-header, .profile-wallet, .works-heading, .profile-identity { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.profile-identity { justify-content: flex-start; min-width: 0; }
.profile-avatar-frame { position: relative; flex: 0 0 auto; width: 96px; height: 96px; overflow: hidden; }
.profile-avatar { position: absolute; left: -517px; top: -10px; display: block; width: 640px; height: 360px; max-width: none; object-fit: fill; }
.profile-username {
  display: inline-flex;
  align-items: center;
  width: max-content;
  max-width: 520px;
  min-height: 56px;
  padding: 10px 20px;
  overflow: hidden;
  border: 3px solid #71351c;
  border-radius: 12px;
  background: #fff4bd;
  font-size: 28px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.community-link, .wallet-detail, .small-action, .work-actions button { border: 2px solid #71351c; border-radius: 12px; background: #fff4bd; color: #71351c; font-weight: 700; }.community-link { padding: 12px 22px; font-size: 22px; }
.profile-wallet { align-items: stretch; margin-top: 28px; }.wallet-card { display: flex; align-items: center; gap: 12px; flex: 1; min-height: 92px; padding: 14px 18px; border: 3px solid #c68b3c; border-radius: 16px; background: #fffdf2; }.wallet-card img { width: 54px; height: 54px; object-fit: contain; }.wallet-card div { display: grid; gap: 4px; }.wallet-card span { color: #8b684e; }.wallet-card strong { font-size: 30px; }.wallet-card button { margin-left: auto; width: 42px; height: 42px; border: 0; border-radius: 50%; background: #d97b49; color: #fff; font-size: 30px; line-height: 1; }.wallet-detail { align-self: center; padding: 14px 18px; font-size: 18px; }
.profile-convert { display: flex; align-items: center; gap: 14px; margin: 22px 0; padding: 16px 20px; border-left: 6px solid #548870; background: #e8f1ed; font-size: 20px; }.profile-convert .rate { font-weight: 700; color: #34715d; }.profile-convert input { width: 84px; padding: 9px; border: 1px solid #b99d82; border-radius: 8px; font: inherit; }.small-action { padding: 9px 16px; font-size: 17px; }
.works-section { margin-top: 18px; }.works-heading h2 { display: inline; margin: 0 12px 0 0; font-size: 30px; }.works-heading span { color: #8b684e; }
.work-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 22px; margin: 0; padding: 0; list-style: none; }
.work-card { min-width: 0; padding: 20px; background-size: 100% 100%; background-repeat: no-repeat; }
.work-preview { display: grid; place-items: center; width: 100%; aspect-ratio: 4 / 3; padding: 0; background: #fff9e8; }
.work-preview img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
.work-info { display: grid; gap: 8px; padding: 12px 0; overflow-wrap: anywhere; }
.work-info strong { font-size: 22px; }.work-info span { color: #8b684e; font-size: 17px; }
.work-actions { display: flex; flex-wrap: wrap; gap: 10px; }.work-actions button { padding: 9px 14px; }
.profile-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(49, 27, 17, .48);
}
.profile-modal {
  width: min(430px, calc(100vw - 40px));
  padding: 28px;
  border: 4px solid #7c321c;
  border-radius: 8px;
  background: #fff4bd;
  color: #563c2d;
  box-shadow: 0 14px 36px rgba(49, 27, 17, .32);
}
.profile-modal h2 { margin: 0 0 8px; font-size: 30px; }
.profile-modal p { margin: 0 0 20px; color: #7c5a42; font-size: 17px; }
.recharge-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.recharge-options button,
.modal-actions button {
  min-height: 44px;
  padding: 8px 14px;
  border: 2px solid #9a5b32;
  border-radius: 6px;
  background: #fffdf2;
  color: #71351c;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.recharge-options button.selected { background: #f3b64d; box-shadow: inset 0 0 0 2px #fff4bd; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.modal-actions .small-action { background: #d97b49; color: #fff; }
.modal-actions button:disabled { cursor: wait; opacity: .58; }
</style>
