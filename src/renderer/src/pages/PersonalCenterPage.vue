<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PaymentDialog from '../components/plaza/PaymentDialog.vue'
import RewardCenterPage from './RewardCenterPage.vue'
import WorkspaceSyncStatus from '../components/shell/WorkspaceSyncStatus.vue'
import { syncState } from '../persistence/workspace-sync'
import type { DraftRecord, ProjectRecord, StoryCard } from '@shared/contracts'
import type { RewardDashboard } from '@shared/contracts/rewards'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import ProjectPreviewModal from '../components/library/ProjectPreviewModal.vue'
import StoryCardThumbnail from '../components/library/StoryCardThumbnail.vue'
import WorkNameEditor from '../components/library/WorkNameEditor.vue'
import { renameWork } from '../persistence/rename-work'
import { CUTTING_PRINT_REVISION } from '../projection/print-settings'
import PlazaUploadDialog from '../components/plaza/PlazaUploadDialog.vue'
import { openLobby, openPlaza, openEditor, openRewards, openSavedWork, logout, getPersonalWorksFilter, setPersonalWorksFilter, getPersonalSection } from '../app-nav'
import { getFeltCraftDatabase, DraftStore, ProjectStore, StoryCardStore, deleteExistingProject } from '../persistence'
import { listMySharedProjectIds, publishPlazaPost, withdrawPlazaPost } from '../services/plaza-api'
import { loadPlazaSession } from '../services/plaza-session'
import { loadRewardDashboard, convertDiamonds } from '../services/reward-api'
import { rewardAssets } from '../ui/reward-assets'
import { profileAssets } from '../ui/profile-assets'
import { handDrawnBorderImage, handDrawnBorderStyles } from '../ui/hand-drawn-assets'
import { BlueprintStore, type BlueprintRecord } from '../persistence/blueprints'
import { plazaAvatarForRole } from '../ui/plaza-assets'
import { authAssets, authFullLayerStyle } from '../ui/auth-assets'
import { friendlyRelativeTime } from '../util/friendly-time'
import { showCenterToast } from '../composables/center-toast'
import { replayOnboardingTour } from '../services/onboarding-service'
import { ONBOARDING_PREPARE_EVENT } from '../services/onboarding-nav'

type Filter = 'draft' | 'drawing' | 'story' | 'blueprint' | 'completed'
type ProfileSection = 'works' | 'account' | 'inbox' | 'store'
type WorkItem = { kind: 'draft' | 'project'; id: string; title: string; updatedAt: string; previewUrl?: string; record: DraftRecord | ProjectRecord }

const session = loadPlazaSession()
const dashboard = ref<RewardDashboard | null>(null)
const drafts = ref<DraftRecord[]>([])
const projects = ref<ProjectRecord[]>([])
const stories = ref(new Map<string, StoryCard>())
const blueprints = ref(new Map<string, BlueprintRecord>())
const sharedIds = ref<Set<string>>(new Set())
const sharedStateReady = ref(false)
const filter = ref<Filter>(getPersonalWorksFilter())
const profileSection = ref<ProfileSection>(getPersonalSection())
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const rechargeOpen = ref(false)
const convertAmount = ref(1)
const previewProject = ref<ProjectRecord | null>(null)
const uploadTarget = ref<ProjectRecord | null>(null)
const removal = ref<WorkItem | null>(null)
const completedCardSkin = handDrawnBorderImage(rewardAssets.communityCard, 'community-card')

const wallet = computed(() => dashboard.value?.wallet ?? { coins: 0, diamonds: 0, updatedAt: '' })
const profileUsername = computed(() => dashboard.value?.user.username ?? session?.user.username ?? '用户')
const profileAvatar = computed(() => plazaAvatarForRole(dashboard.value?.user.role ?? session?.user.role ?? 'child'))
const profileRole = computed(() => dashboard.value?.user.role ?? session?.user.role ?? 'child')
const canUseWallet = computed(() => ['child', 'art_teacher', 'chinese_teacher'].includes(profileRole.value))
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
      const storyLike = stories.value.has(record.projectId)
      if (filter.value === 'drawing') return true
      if (filter.value === 'story') return storyLike
      if (filter.value === 'blueprint') return blueprints.value.has(record.projectId)
      return true
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
})

function isShared(project: ProjectRecord): boolean { return sharedIds.value.has(project.projectId) }
function selectFilter(nextFilter: Filter): void { filter.value = nextFilter; setPersonalWorksFilter(nextFilter) }
function projectTitle(project: ProjectRecord): string { return project.projectName?.trim() || '我的作品' }
function draftTitle(draft: DraftRecord): string { return draft.scene.workName?.trim() || '未命名草稿' }
function projectFor(item: WorkItem): ProjectRecord | null { return item.kind === 'project' ? item.record as ProjectRecord : null }
function canPublish(item: WorkItem): boolean { const project = projectFor(item); return Boolean(sharedStateReady.value && project && !isShared(project)) }
function publishItem(item: WorkItem): void { const project = projectFor(item); if (project) askUpload(project) }
function withdrawItem(item: WorkItem): void { const project = projectFor(item); if (project) void withdraw(project) }

function storyFor(item: WorkItem): StoryCard | undefined { return stories.value.get(item.id) }
function blueprintFor(item: WorkItem): BlueprintRecord | undefined { return blueprints.value.get(item.id) }
function cardTitle(item: WorkItem): string { return filter.value === 'story' ? storyFor(item)?.title ?? item.title : item.title }

async function saveWorkName(item: WorkItem, name: string): Promise<void> {
  if (busy.value) throw new Error('请稍后再试。')
  busy.value=true
  try {
    const saved=await renameWork(item.kind,item.id,session?.user.userId ?? '',name)
    if(item.kind==='draft') drafts.value=drafts.value.map(row=>row.draftId===item.id?saved as DraftRecord:row)
    else {
      projects.value=projects.value.map(row=>row.projectId===item.id?saved as ProjectRecord:row)
      if(previewProject.value?.projectId===item.id) previewProject.value=saved as ProjectRecord
    }
    showCenterToast('作品名已修改')
  } finally { busy.value=false }
}

async function downloadBlueprint(item: WorkItem): Promise<void> {
  const project = projectFor(item)
  if (!project || busy.value) return
  busy.value = true; message.value = ''
  try {
    const saved = await new ProjectStore(getFeltCraftDatabase()).get(project.projectId)
    if (!saved || saved.scene.userId !== session?.user.userId) throw new Error('作品不存在或不属于当前账号。')
    const artifact = await new BlueprintStore().getForWork(saved)
    if (!artifact) throw new Error('作品已更新，请打开图纸重新导出。')
    if (artifact.printRevision !== CUTTING_PRINT_REVISION) throw new Error('这份图纸是旧版打印排版，请点击打开后重新导出。')
    const url = URL.createObjectURL(artifact.pdf), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${project.projectName.replace(/[\\/:*?"<>|]/g, '_')}-彩色裁片图纸.pdf`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (error) { message.value = (error as Error).message }
  finally { busy.value = false }
}

async function refresh(): Promise<void> {
  if (!session?.token) { openPlaza(); return }
  loading.value = true
  sharedStateReady.value = false
  try {
    const db = getFeltCraftDatabase()
    drafts.value = (await new DraftStore(db).list()).filter(row => row.scene.userId === session.user.userId)
    projects.value = (await new ProjectStore(db).list()).filter(row => row.scene.userId === session.user.userId)
    const cards = await Promise.all(projects.value.map(project => new StoryCardStore(db).getByWorkId(project.projectId)))
    stories.value = new Map(cards.filter((card): card is StoryCard => Boolean(card)).map(card => [card.workId, card]))
    blueprints.value = new Map((await new BlueprintStore(db).listForWorks(session.user.userId, projects.value)).map(row => [row.projectId, row]))
    const [nextDashboard, ids] = await Promise.all([
      loadRewardDashboard(session.token),
      listMySharedProjectIds(session.token)
    ])
    dashboard.value = nextDashboard
    sharedIds.value = new Set(ids)
    sharedStateReady.value = true
  } catch (error) {
    message.value = error instanceof Error ? error.message : '个人中心载入失败。'
  } finally { loading.value = false }
}

async function openWork(item: WorkItem): Promise<void> {
  if (item.kind === 'project' && filter.value === 'blueprint') {
    await openProjectFlow(item.record as ProjectRecord, 'work-export')
    return
  }
  if (item.kind === 'project' && filter.value === 'story') {
    try { await openSavedWork(item.id, 'story-card', 'profile') } catch (error) { message.value = (error as Error).message }
    return
  }
  if (item.kind === 'draft') {
    const draft = item.record as DraftRecord
    openEditor({ mode: 'draft', scene: draft.scene, draftId: draft.draftId, returnTo: 'profile', returnFilter: filter.value })
  } else {
    const project = item.record as ProjectRecord
    editProject(project)
  }
}

function editProject(project: ProjectRecord): void {
  previewProject.value = null
  openEditor({ mode: 'project', scene: project.scene, projectId: project.projectId, returnTo: 'profile', returnFilter: filter.value })
}

async function openProjectFlow(project: ProjectRecord, target: 'story-card' | 'work-export'): Promise<void> {
  if (busy.value) return
  busy.value = true; message.value = ''
  try { await openSavedWork(project.projectId, target, 'profile') }
  catch (error) { message.value = (error as Error).message }
  finally { busy.value = false }
}

async function removeWork(): Promise<void> {
  const item = removal.value
  if (!item || busy.value) return
  busy.value = true; message.value = ''
  try {
    // Recheck ownership on the persisted record; never trust an old card alone.
    const db = getFeltCraftDatabase()
    const record = item.kind === 'draft'
      ? await new DraftStore(db).get(item.id) : await new ProjectStore(db).get(item.id)
    if (!record || record.scene.userId !== session?.user.userId) throw new Error('作品不存在或不属于当前账号。')
    if (item.kind === 'draft') await new DraftStore(db).delete(item.id)
    else await deleteExistingProject(item.id)
    removal.value = null; previewProject.value = null
    await refresh()
  } catch (error) { message.value = (error as Error).message }
  finally { busy.value = false }
}

function showDetails(item: WorkItem): void {
  message.value = ''
  if (item.kind === 'project') previewProject.value = item.record as ProjectRecord
  else showCenterToast('请先保存草稿。')
}

function askUpload(project: ProjectRecord): void {
  if (!sharedStateReady.value || busy.value || !project.previewUrl || isShared(project)) return
  uploadTarget.value = project
}

async function confirmUpload(title: string): Promise<void> {
  if (!session?.token || !uploadTarget.value?.previewUrl) return
  busy.value = true
  try {
    const story = stories.value.get(uploadTarget.value.projectId)
    await publishPlazaPost({ token: session.token, projectId: uploadTarget.value.projectId, title, previewRef: uploadTarget.value.previewUrl,
      storyTitle: story?.title, storyText: story?.storyText })
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
  if (!session?.token || busy.value || !canUseWallet.value) return
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
function prepareGuideSection(): void { profileSection.value = getPersonalSection(); filter.value = getPersonalWorksFilter() }
onMounted(() => { void refresh(); window.addEventListener('felt-workspace-synced', syncRefresh); window.addEventListener(ONBOARDING_PREPARE_EVENT, prepareGuideSection) })
onUnmounted(() => { window.removeEventListener('felt-workspace-synced', syncRefresh); window.removeEventListener(ONBOARDING_PREPARE_EVENT, prepareGuideSection) })
</script>

<template>
  <AuthArtboard :inert="Boolean(previewProject) || undefined">
    <img class="profile-layer" :style="authFullLayerStyle" :src="authAssets.background" alt="" aria-hidden="true" />
    <img class="profile-layer profile-layer--frame" :style="authFullLayerStyle" :src="profileAssets.frameFull" alt="" aria-hidden="true" />
    <button type="button" class="profile-back" aria-label="返回游戏大厅" @click="openLobby"><img :src="profileAssets.back" alt="" /></button>

    <nav class="profile-side-nav" aria-label="个人中心导航">
      <button type="button" class="profile-text-tab" :class="{ active: profileSection === 'account' }" :aria-pressed="profileSection === 'account'" @click="profileSection = 'account'">账号</button>
      <button type="button" class="profile-text-tab" :class="{ active: profileSection === 'works' }" :aria-pressed="profileSection === 'works'" @click="profileSection = 'works'" data-tour-id="tour-profile-works">作品</button>
      <button v-if="profileRole === 'child'" type="button" class="profile-text-tab" :class="{ active: profileSection === 'inbox' }" :aria-pressed="profileSection === 'inbox'" @click="profileSection = 'inbox'">邮箱</button>
      <button v-if="!['parent','admin'].includes(profileRole)" type="button" class="profile-text-tab" :class="{ active: profileSection === 'store' }" :aria-pressed="profileSection === 'store'" @click="profileSection = 'store'">商城</button>
    </nav>

    <nav v-if="profileSection === 'works'" class="profile-filter-nav" aria-label="作品筛选">
      <button type="button" :class="{ active: filter === 'draft' }" aria-label="进度草稿" @click="selectFilter('draft')"><img :src="profileAssets.drafts" alt="进度草稿" /></button>
      <button type="button" :class="{ active: filter === 'drawing' }" aria-label="创作图画" @click="selectFilter('drawing')"><img :src="profileAssets.createDrawing" alt="创作图画" /></button>
      <button type="button" :class="{ active: filter === 'story' }" aria-label="故事卡" data-tour-id="tour-profile-story" @click="selectFilter('story')"><img :src="profileAssets.story" alt="故事卡" /></button>
      <button type="button" :class="{ active: filter === 'blueprint' }" aria-label="制作图纸" @click="selectFilter('blueprint')"><img :src="profileAssets.blueprint" alt="制作图纸" /></button>
      <button type="button" :class="{ active: filter === 'completed' }" aria-label="完成作品" @click="selectFilter('completed')"><img :src="profileAssets.completed" alt="完成作品" /></button>
    </nav>

    <main class="profile-panel art-scrollbars" :aria-label="({ works: '作品列表', account: '账号信息', inbox: '反馈邮箱', store: '商城' })[profileSection]">
      <section v-if="profileSection === 'works'" class="works-section">
        <p v-if="syncState.conflict" role="alert">作品在其他终端有更新。<button @click="profileSection = 'account'">前往账号处理同步冲突</button></p>
        <p v-if="loading" role="status">正在加载我的作品…</p>
        <p v-else-if="!visibleWorks.length" class="empty-state">{{ filter === 'blueprint' ? '暂无制作图纸。' : '此分类暂无作品。' }}</p>
        <ul v-if="!loading && visibleWorks.length" class="work-grid" :class="{ 'work-grid--completed': filter === 'completed', 'work-grid--story': filter === 'story' }">
          <li v-for="item in visibleWorks" :key="`${item.kind}-${item.id}`" class="work-card" :class="{ 'work-card--completed': filter === 'completed' }"
            :aria-label="item.title" :style="filter === 'completed' ? completedCardSkin : { backgroundImage: `url(${rewardAssets.communityCard})` }">
            <template v-if="filter === 'completed'">
              <div class="completed-artwork">
                <button type="button" class="work-preview" :aria-label="`查看画面：${item.title}`" @click="showDetails(item)"><img :src="item.previewUrl" :alt="item.title" /></button>
                <div class="work-info"><WorkNameEditor :name="item.title" :disabled="busy" :save-name="name => saveWorkName(item,name)" /><span>{{ friendlyRelativeTime(item.updatedAt) }} · {{ !sharedStateReady ? '分享状态待确认' : sharedIds.has(item.id) ? '已发布' : '未发布' }}</span></div>
              </div>
              <button type="button" class="completed-story" :style="handDrawnBorderStyles.btnSecondary" :aria-label="`查看故事：${item.title}`" @click="openProjectFlow(projectFor(item)!, 'story-card')">
                <strong>{{ storyFor(item)?.title || '故事卡' }}</strong>
                <span>{{ storyFor(item)?.storyText || '还没有故事，点击讲述。' }}</span>
              </button>
              <div class="work-actions completed-actions" aria-label="作品操作">
                <button type="button" :disabled="busy" @click="openWork(item)">打开</button>
                <button type="button" :disabled="busy" @click="openProjectFlow(projectFor(item)!, 'work-export')">图纸</button>
                <button v-if="!sharedIds.has(item.id)" type="button" :disabled="busy || !sharedStateReady || !item.previewUrl" @click="publishItem(item)">发布</button>
                <button v-else type="button" :disabled="busy" @click="withdrawItem(item)">撤回</button>
                <button type="button" :disabled="busy" @click="removal = item">删除</button>
              </div>
            </template>
            <template v-else>
              <button type="button" class="work-preview" :class="{ 'work-preview--story': filter === 'story', 'work-preview--blueprint': filter === 'blueprint' }"
                :aria-label="`${filter === 'story' ? '查看故事卡' : filter === 'blueprint' ? '查看图纸' : '查看画面'}：${cardTitle(item)}`"
                @click="filter === 'story' || filter === 'blueprint' ? openWork(item) : showDetails(item)">
                <StoryCardThumbnail v-if="filter === 'story' && storyFor(item)" :card="storyFor(item)!" />
                <img v-else-if="filter === 'blueprint' && blueprintFor(item)" :src="blueprintFor(item)!.thumbnail" :alt="`${item.title}首张图纸`" />
                <img v-else-if="item.previewUrl" :src="item.previewUrl" :alt="item.title" /><span v-else>草稿</span>
              </button>
              <div class="work-info"><strong v-if="filter === 'story'">{{ cardTitle(item) }}</strong><WorkNameEditor v-else :name="item.title" :disabled="busy" :save-name="name => saveWorkName(item,name)" /><span>{{ friendlyRelativeTime(filter === 'blueprint' ? blueprintFor(item)!.exportedAt : item.updatedAt) }} · {{ filter === 'blueprint' ? '制作图纸' : item.kind === 'draft' ? '草稿' : !sharedStateReady ? '分享状态待确认' : (sharedIds.has(item.id) ? '已发布' : '未发布') }}</span></div>
              <div class="work-actions">
                <button type="button" :disabled="busy" @click="openWork(item)">{{ item.kind === 'draft' ? '继续编辑' : '打开' }}</button>
                <button v-if="filter === 'blueprint'" type="button" :disabled="busy" @click="downloadBlueprint(item)">下载</button>
                <template v-else>
                  <button v-if="canPublish(item)" type="button" :disabled="busy || !item.previewUrl" @click="publishItem(item)">发布</button>
                  <button v-else-if="sharedStateReady && item.kind === 'project'" type="button" :disabled="busy" @click="withdrawItem(item)">撤回</button>
                  <button type="button" :disabled="busy" @click="removal = item">删除</button>
                </template>
              </div>
            </template>
            <div v-if="removal?.id === item.id && removal.kind === item.kind" class="work-removal" role="group" aria-label="删除确认">
              <p>确定删除“{{ item.title }}”{{ item.kind === 'draft' ? '草稿' : '作品' }}？{{ item.kind === 'project' ? '分享广场中的发布不会自动撤回。' : '' }}</p>
              <button :disabled="busy" @click="removeWork">确定删除</button><button :disabled="busy" @click="removal = null">取消</button>
            </div>
          </li>
        </ul>
      </section>
      <RewardCenterPage v-else-if="profileSection === 'inbox' || profileSection === 'store'" :key="profileSection" :initial-tab="profileSection" embedded @account="profileSection = 'account'" />
      <section v-else class="account-section">
        <header class="profile-header">
          <div class="profile-identity" :aria-label="`当前用户 ${profileUsername}`">
            <span class="profile-avatar-frame"><img class="profile-avatar" :src="profileAvatar" alt="用户头像" /></span>
            <strong class="profile-username" :title="profileUsername">{{ profileUsername }}</strong>
          </div>
          <button type="button" class="wallet-detail hand-btn-secondary" @click="openRewards()">账户流水与规则</button>
          <button type="button" class="wallet-detail hand-btn-secondary" @click="logout">退出登录</button>
          <button type="button" class="wallet-detail hand-btn-secondary" @click="replayOnboardingTour">重看新手引导</button>
        </header>

        <div v-if="canUseWallet" class="profile-wallet" aria-label="账户余额">
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

        <div v-if="canUseWallet" class="profile-convert">
          <strong>钻石转换金币</strong>
          <span class="rate">1 钻石 = 10 金币</span>
          <label>数量 <input v-model.number="convertAmount" type="number" min="1" :max="wallet.diamonds" aria-label="转换钻石数量" /></label>
          <button type="button" class="small-action hand-btn-primary" :disabled="busy || wallet.diamonds < 1" @click="convert">转换</button>
        </div>
        <WorkspaceSyncStatus display-only />
      </section>
      <p v-if="message" class="profile-message">{{ message }}</p>
    </main>
  </AuthArtboard>

  <PaymentDialog v-if="rechargeOpen && session && canUseWallet" :token="session.token" :user-id="session.user.userId" @close="rechargeOpen = false" @paid="refresh" />
  <ProjectPreviewModal :project="previewProject" :open="Boolean(previewProject)" @close="previewProject = null" @open="editProject">
    <template #feedback><p v-if="message" role="alert">{{ message }}</p></template>
    <template #actions><button v-if="previewProject" :disabled="busy" @click="openProjectFlow(previewProject, 'story-card')">讲故事</button></template>
  </ProjectPreviewModal>
  <PlazaUploadDialog :open="Boolean(uploadTarget)" :default-title="uploadTarget ? projectTitle(uploadTarget) : ''" :busy="busy" @close="uploadTarget = null" @confirm="confirmUpload" />
</template>

<style scoped>
.profile-layer { position: absolute; display: block; pointer-events: none; user-select: none; }
.profile-layer--frame { z-index: 2; }
.profile-back,
.profile-side-nav button,
.profile-filter-nav button { position: absolute; z-index: 6; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
.profile-back { left: 270px; top: 140px; width: 180px; height: 81px; }
.profile-back img,
.profile-side-nav img,
.profile-filter-nav img { display: block; width: 100%; height: 100%; object-fit: contain; }
.profile-back:hover,
.profile-side-nav button:hover,
.profile-filter-nav button:hover { filter: brightness(1.06); }
.profile-back:active,
.profile-side-nav button:active,
.profile-filter-nav button:active { transform: translateY(2px); }
.profile-side-nav,
.profile-filter-nav { position: absolute; inset: 0; z-index: 6; pointer-events: none; }
.profile-side-nav button { left: 312px; width: 209px; height: 101px; pointer-events: auto; }
.profile-side-nav button:first-child { top: 280px; }
.profile-side-nav button:nth-child(2) { top: 412px; }
.profile-side-nav button:nth-child(3) { top: 544px; }
.profile-side-nav button:nth-child(4) { top: 676px; }
.profile-side-nav .profile-text-tab { border: 5px solid #71351c; border-radius: 20px; background: #f6cc79; color: #71351c; font-size: 48px; font-weight: 900; }
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
.work-preview { overflow:hidden; border:0; cursor:pointer; color:inherit; }
.work-preview--story { aspect-ratio:16/9; background:transparent; }
.work-preview--blueprint { background:#efe4bf; padding:8px; box-sizing:border-box; }
.work-grid--story { grid-template-columns:repeat(2,minmax(0,1fr)); }
.work-grid--completed { grid-template-columns:minmax(0,1fr); gap:22px; }
.work-card--completed { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 148px; align-items:stretch; gap:18px; padding:16px; }
.completed-artwork { min-width:0; }
.completed-artwork .work-preview { aspect-ratio:16/10; background:transparent; }
.completed-artwork .work-info { padding-bottom:0; }
.completed-artwork .work-info strong { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.completed-story { min-width:0; padding:16px 12px; color:inherit; font:inherit; text-align:left; cursor:pointer; display:flex; flex-direction:column; gap:14px; }
.completed-story strong { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; font-size:24px; line-height:1.4; overflow-wrap:anywhere; }
.completed-story span { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:6; overflow:hidden; white-space:pre-wrap; overflow-wrap:anywhere; font-size:20px; line-height:1.6; }
.work-actions.completed-actions { display:flex; flex-direction:column; justify-content:center; flex-wrap:nowrap; gap:12px; padding:12px 8px; }
.completed-actions button { width:100%; font-size:22px; min-height:48px; }
.work-preview:focus-visible,.completed-story:focus-visible,.profile-filter-nav button:focus-visible,.profile-back:focus-visible { outline:3px solid #71351c; outline-offset:3px; }
.work-card--completed .work-removal { grid-column:1/-1; }
.work-actions button:disabled { opacity:.55; cursor:default; }
.work-info { display: grid; gap: 8px; padding: 12px 0; overflow-wrap: anywhere; }
.work-info strong { font-size: 22px; }.work-info span { color: #8b684e; font-size: 17px; }
.work-actions { display: flex; flex-wrap: wrap; gap: 10px; }.work-actions button { padding: 9px 14px; }
.work-actions button, .work-removal button {
  border: 0; background: transparent url('../../../../assets/ui/hand-drawn/btn-primary.png') center / 100% 100% no-repeat;
  color: #71351c; min-height: 44px; padding: 9px 14px; font-weight: 700;
}
.work-removal button { background-image: url('../../../../assets/ui/hand-drawn/btn-secondary.png'); }
.wallet-detail, .small-action { border: 0; background-color: transparent; background-size: 100% 100%; background-repeat: no-repeat; }
.wallet-detail { background-image: url('../../../../assets/ui/hand-drawn/btn-secondary.png'); }
.small-action { background-image: url('../../../../assets/ui/hand-drawn/btn-primary.png'); }
.profile-username { border: 0; background: transparent; padding: 0; }
.profile-convert { flex-wrap: wrap; border: 0; background: transparent; padding: 12px 0; }
.profile-convert .rate { color: #71351c; }
.profile-convert input { color: #563c2d; background: #fff4bd; border: 2px solid #71351c; }
.work-actions button:focus-visible, .work-removal button:focus-visible { outline: 3px solid #71351c; outline-offset: 2px; }
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
