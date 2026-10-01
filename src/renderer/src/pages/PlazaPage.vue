<script setup lang="ts">
import '../styles/plaza-v2-detail-dialog.css'
import { computed, onMounted, ref } from 'vue'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import PersonalSpacePanel from '../components/plaza/PersonalSpacePanel.vue'
import { showCenterToast } from '../composables/center-toast'
import { ensureDevPlazaSession } from '../services/plaza-dev-bootstrap'
import { loadPlazaSession } from '../services/plaza-session'
import {
  PLAZA_V2_PUBLIC_DEMO_CARDS,
  type PlazaV2DemoCard
} from '../ui/plaza-v2-demo-cards'
import {
  plazaV2Assets,
  plazaV2ContentSlotStyle,
  plazaV2FullLayerStyle,
  plazaV2HitBoxStyle
} from '../ui/plaza-v2-assets'

type ShareTab = 'public' | 'personal'

const activeTab = ref<ShareTab>('public')
const publicCards = PLAZA_V2_PUBLIC_DEMO_CARDS
const detailCard = ref<PlazaV2DemoCard | null>(null)
const detailOpen = ref(false)
const personalRef = ref<InstanceType<typeof PersonalSpacePanel> | null>(null)

const publicTabHit = plazaV2HitBoxStyle('public-tab')
const personalTabHit = plazaV2HitBoxStyle('personal-tab')
const backHit = plazaV2HitBoxStyle('back-button')

const publicTabLayerClass = computed(() =>
  activeTab.value === 'public' ? 'plaza-v2-tab-layer plaza-v2-tab-layer--active' : 'plaza-v2-tab-layer plaza-v2-tab-layer--idle'
)
const personalTabLayerClass = computed(() =>
  activeTab.value === 'personal' ? 'plaza-v2-tab-layer plaza-v2-tab-layer--active' : 'plaza-v2-tab-layer plaza-v2-tab-layer--idle'
)

function openDetail(card: PlazaV2DemoCard): void {
  detailCard.value = card
  detailOpen.value = true
}

function closeDetail(): void {
  detailOpen.value = false
  detailCard.value = null
}

function selectTab(tab: ShareTab): void {
  if (activeTab.value === tab) return
  activeTab.value = tab
  if (tab === 'personal') {
    void personalRef.value?.refresh?.()
  }
}

function onBack(): void {
  showCenterToast('功能开发中')
}

onMounted(async () => {
  await ensureDevPlazaSession()
  if (!loadPlazaSession()?.token) {
    showCenterToast('开发登录失败，请确认 backend 已启动（8788）')
  }
})
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
      aria-label="公共空间"
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
      <template v-if="activeTab === 'public'">
        <ul class="plaza-grid">
          <li v-for="card in publicCards" :key="card.id">
            <button type="button" class="plaza-card text-box-surface" @click="openDetail(card)">
              <div class="plaza-card__thumb">
                <img :src="card.thumbUrl" :alt="card.title" />
              </div>
              <div class="plaza-card__body">
                <h3 class="plaza-v2-card-title">{{ card.title }}</h3>
                <p class="plaza-v2-card-meta muted">{{ card.meta }}</p>
              </div>
            </button>
          </li>
        </ul>
      </template>
      <PersonalSpacePanel v-else ref="personalRef" />
    </section>

    <img
      class="plaza-v2-layer plaza-v2-layer--z6"
      :style="plazaV2FullLayerStyle"
      :src="plazaV2Assets.backButton"
      alt=""
      aria-hidden="true"
    />
    <button type="button" class="plaza-v2-hit plaza-v2-hit--back" :style="backHit" aria-label="返回" @click="onBack" />
  </AuthArtboard>

  <div v-if="detailOpen && detailCard" class="plaza-v2-detail-backdrop" role="presentation" @click.self="closeDetail">
    <div class="plaza-v2-detail-dialog text-box-surface" role="dialog" aria-modal="true">
      <h3 class="plaza-v2-card-title">{{ detailCard.title }}</h3>
      <p class="plaza-v2-card-meta muted">{{ detailCard.meta }}</p>
      <img class="plaza-v2-detail-dialog__img" :src="detailCard.thumbUrl" :alt="detailCard.title" />
      <button type="button" class="primary" @click="closeDetail">关闭</button>
    </div>
  </div>
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
  mix-blend-mode: multiply;
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
  object-fit: cover;
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
