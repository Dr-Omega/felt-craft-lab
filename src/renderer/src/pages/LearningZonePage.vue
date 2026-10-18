<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { CATALOG_ASSETS, createBlankScene } from '../catalog/ywn-catalog'
import { getLearningThemeId, openEditor, openLobby } from '../app-nav'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import AssetQaSheet from '../components/editor/AssetQaSheet.vue'
import ArtworkButton from '../components/editor/ArtworkButton.vue'
import { suppliedArt } from '../ui/supplied-controls'
import type { AssetRecord } from '@shared/contracts'
import {
  createGameSession,
  loadUnlockedThemeIds,
  type GameSession
} from '../learning-zone/game-client'

type Topic = { id: string; name: string; themeId: string }
type Unit = { id: string; order: number; name: string; topics: Topic[] }

const files = import.meta.glob('../assets/learning-zone/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const materialPreviews = import.meta.glob('../assets/learning-zone/material-previews/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const units: Unit[] = [
  { id: 'festival', order: 1, name: '节日', topics: [
    { id: 'mid-autumn', name: '中秋节', themeId: 'mid_autumn_festival' },
    { id: 'spring-festival', name: '春节', themeId: 'spring_festival' },
    { id: 'lantern-festival', name: '元宵节', themeId: 'lantern_festival' },
    { id: 'dragon-boat', name: '端午节', themeId: 'dragon_boat_festival' },
    { id: 'qingming', name: '清明节', themeId: 'qingming_festival' }
  ] },
  { id: 'season', order: 2, name: '季节', topics: [
    { id: 'spring', name: '春天', themeId: 'spring' },
    { id: 'summer', name: '夏天', themeId: 'summer' },
    { id: 'autumn', name: '秋天', themeId: 'autumn' },
    { id: 'winter', name: '冬天', themeId: 'winter' }
  ] },
  { id: 'folk', order: 3, name: '民俗风物', topics: [
    { id: 'brush-ink', name: '书画', themeId: 'brush_ink_painting' },
    { id: 'tea', name: '茶文化', themeId: 'chinese_tea_culture' },
    { id: 'music', name: '传统乐器', themeId: 'traditional_folk_music' },
    { id: 'opera', name: '传统戏曲', themeId: 'traditional_opera' }
  ] },
  { id: 'plants-animals', order: 4, name: '动植物', topics: [
    { id: 'animals', name: '动物', themeId: 'animals' },
    { id: 'plants', name: '植物', themeId: 'plants' }
  ] }
]

const initialTheme = getLearningThemeId()
const initialUnit = units.find(unit => unit.topics.some(topic => topic.themeId === initialTheme)) ?? units[0]
const selectedUnit = ref(initialUnit)
const selectedTopic = ref(initialUnit.topics.find(topic => topic.themeId === initialTheme) ?? initialUnit.topics[0])
const qaAsset = ref<AssetRecord | null>(null)
const unlockedThemeIds = ref<string[]>([])
let pageEpoch = 0
let activeAudio: HTMLAudioElement | null = null
const loadingGame = ref(false)
const gameError = ref('')
const selectedAssets = computed(() => CATALOG_ASSETS.filter(asset => asset.themeId === selectedTopic.value.themeId))
const background = computed(() => selectedAssets.value.find(asset => asset.type === 'background'))
const stickers = computed(() => selectedAssets.value.filter(asset => asset.type === 'sticker'))
const isUnlocked = computed(() => unlockedThemeIds.value.includes(selectedTopic.value.themeId))
const unlockedAssets = computed(() => [...selectedAssets.value].sort((a, b) => a.type === b.type ? 0 : a.type === 'background' ? -1 : 1))

function imageFor(file: string): string {
  return files[`../assets/learning-zone/${file}`] ?? ''
}

function previewUrl(resourceRef: string): string {
  if (window.location.protocol.startsWith('http') && resourceRef.startsWith('felt-resource://material/')) {
    const fileName = resourceRef.slice(resourceRef.lastIndexOf('/') + 1)
    return materialPreviews[`../assets/learning-zone/material-previews/${fileName}`] ?? resourceRef
  }
  return resourceRef
}

function box(x: number, y: number, width: number, height: number, zIndex: number): CSSProperties {
  return { left: `${x / 1920 * 100}%`, top: `${y / 1080 * 100}%`, width: `${width / 1920 * 100}%`, height: `${height / 1080 * 100}%`, zIndex }
}

// All dimensions below are in the same 1920 × 1080 artboard as the team's artwork.
// AuthArtboard scales the artwork and content together, not each control separately.
function topicListStyle(): CSSProperties {
  return { ...box(590, 150, 340, 730, 32), gridTemplateRows: 'repeat(5, 108px)' }
}

function unitListStyle(): CSSProperties {
  return box(400, 145, 155, 660, 31)
}

function unlockPanelStyle(): CSSProperties {
  return box(1062, 184, 400, 690, 90)
}

function unlockFrameStyle(): CSSProperties {
  return {
    ...box(0, 0, 1920, 1080, 5),
    transform: 'scaleY(1.22)',
    transformOrigin: '50% 158px'
  }
}

function unlockedPanelStyle(): CSSProperties {
  return box(1040, 170, 500, 710, 90)
}

function selectUnit(unit: Unit): void {
  selectedUnit.value = unit
  selectedTopic.value = unit.topics[0]
}

function selectTopic(topic: Topic): void {
  selectedTopic.value = topic
}

function stopActiveAudio(): void {
  activeAudio?.pause()
  activeAudio = null
}

async function beginGuidedCreation(): Promise<void> {
  if (loadingGame.value) return
  const epoch = pageEpoch
  const topic = selectedTopic.value
  loadingGame.value = true
  gameError.value = ''
  try {
    const task: GameSession = await createGameSession(topic.themeId)
    if (epoch !== pageEpoch) return
    const scene = createBlankScene(`${topic.name}·引导教学`, topic.themeId)
    scene.canvas.width = task.level.canvasBounds.maxX - task.level.canvasBounds.minX
    scene.canvas.height = task.level.canvasBounds.maxY - task.level.canvasBounds.minY
    openEditor({ mode: 'new', scene, guidedTheme: { sessionId: task.playSessionId, themeId: topic.themeId } })
  } catch (error) {
    if (epoch === pageEpoch) gameError.value = error instanceof Error ? error.message : '引导任务暂时无法开始。'
  } finally { if (epoch === pageEpoch) loadingGame.value = false }
}

function playCatalogAudio(urls: Array<string | undefined>): void {
  stopActiveAudio()
  const [first, ...rest] = urls.filter((url): url is string => Boolean(url))
  if (!first) return
  const playNext = (url: string): void => {
    const audio = new Audio(url)
    activeAudio = audio
    audio.onended = () => {
      const next = rest.shift()
      if (next) playNext(next)
    }
    void audio.play().catch(() => { gameError.value = '音频暂时无法播放，请重试。' })
  }
  playNext(first)
}

watch(selectedTopic, () => { pageEpoch++; loadingGame.value = false; gameError.value = ''; qaAsset.value = null; stopActiveAudio() })
onMounted(async () => {
  try { unlockedThemeIds.value = await loadUnlockedThemeIds() }
  catch (error) { gameError.value = error instanceof Error ? error.message : '学习记录读取失败。' }
})
onBeforeUnmount(() => { pageEpoch++; stopActiveAudio() })
</script>

<template>
  <AuthArtboard class="learning-artboard">
  <section class="learning-zone-page art-scrollbars" aria-label="学习区">
    <img class="layer" :src="imageFor('learning-background.png')" alt="" :style="box(0, 0, 1920, 1080, 1)">
    <img class="layer" :src="imageFor('learning-book.png')" alt="" :style="box(0, 0, 1920, 1080, 2)">

    <div class="unit-list" :style="unitListStyle()">
      <button v-for="unit in units" :key="unit.id" class="unit-button" :class="{ selected: selectedUnit.id === unit.id }" type="button" :aria-pressed="selectedUnit.id === unit.id" @click="selectUnit(unit)">
        <img class="frame-image" :src="imageFor('unit-card-frame.png')" alt="">
        <span>第{{ unit.order }}单元</span><strong>{{ unit.name }}</strong>
      </button>
    </div>

    <div class="topic-list" :style="topicListStyle()">
      <button v-for="topic in selectedUnit.topics" :key="topic.id" class="topic-button" :class="{ selected: selectedTopic.id === topic.id }" type="button" :aria-pressed="selectedTopic.id === topic.id" @click="selectTopic(topic)">
        <img class="frame-image" :src="imageFor('topic-card-frame.png')" alt=""><strong>{{ topic.name }}</strong>
      </button>
    </div>

    <template v-if="!isUnlocked">
      <img class="layer" :src="imageFor('素材展示页05.png')" alt="" :style="unlockFrameStyle()">
      <section class="unlock-panel" :style="unlockPanelStyle()" :aria-label="`${selectedTopic.name}待解锁内容`">
      <div class="theme-preview-card">
      <div class="unlock-heading"><span class="status-label">待解锁</span><h2>{{ selectedTopic.name }}</h2></div>
      <p class="unlock-copy">完成引导教学后解锁。</p>
      <div class="background-preview" aria-label="主题背景预览">
        <img v-if="background" :src="previewUrl(background.thumbnailUrl ?? background.imageUrl)" :alt="background.nameZh">
      </div>
      </div>
      <section class="theme-preview-stickers" aria-label="本主题贴纸预览">
        <div class="theme-sticker-grid">
          <figure v-for="asset in stickers" :key="asset.assetId">
            <img :src="previewUrl(asset.thumbnailUrl ?? asset.imageUrl)" :alt="asset.nameZh">
            <figcaption>{{ asset.nameZh }}</figcaption>
          </figure>
        </div>
      </section>
      <button class="begin-guided" data-tour-id="tour-learning-guided" type="button" :disabled="loadingGame" @click="beginGuidedCreation">{{ loadingGame ? '正在准备…' : '进入引导教学，解锁本主题' }}</button>
      <p v-if="gameError" role="alert">{{ gameError }}</p>
      </section>
    </template>
    <section v-else class="unlocked-panel" :style="unlockedPanelStyle()" :aria-label="`${selectedTopic.name}已解锁内容`">
      <header><span class="status-label">已解锁</span><h2>{{ selectedTopic.name }}的素材</h2></header>
      <div class="material-list">
        <article v-for="asset in unlockedAssets" :key="asset.assetId" class="material-card" :class="{ 'background-card': asset.type === 'background' }">
          <img :src="previewUrl(asset.thumbnailUrl ?? asset.imageUrl)" :alt="asset.nameZh">
          <div>
            <div class="material-title"><h3>{{ asset.nameZh }} <span>/ {{ asset.nameEn }}</span></h3><button class="audio-button name-audio-button" type="button" :aria-label="`播放${asset.nameZh}的中英文名称`" @click="playCatalogAudio([asset.audio.nameZhUrl, asset.audio.nameEnUrl])"><img :src="imageFor('audio-button.png')" alt="">中英文名称</button></div>
            <p>{{ asset.introZh }}</p>
            <div class="audio-actions" :aria-label="`${asset.nameZh}的音频`">
              <button class="audio-button" type="button" :aria-label="`播放${asset.nameZh}的中文介绍`" @click="playCatalogAudio([asset.audio.introZhUrl])"><img :src="imageFor('audio-button.png')" alt="">中文介绍</button>
              <ArtworkButton class="material-question" :image="suppliedArt.qaEntry" bounds="1037 816 182 76" :label="`提问：${asset.nameZh}`" @click="stopActiveAudio(); qaAsset = asset" />
            </div>
          </div>
        </article>
      </div>
    </section>
    <img class="layer" :src="imageFor('learning-border.png')" alt="" :style="box(0, 0, 1920, 1080, 70)">
    <button class="back-button" type="button" aria-label="返回大厅" :style="box(39, 35, 208, 112, 100)" @click="openLobby"><img :src="imageFor('back-button.png')" alt=""></button>
  </section>
  </AuthArtboard>
  <AssetQaSheet :asset="qaAsset" :open="!!qaAsset" @close="qaAsset = null" />
</template>

<style scoped>
.material-question { flex: 0 0 auto; width: 128px; height: 54px; margin-left: auto; }
.learning-artboard { z-index: 80; }
.learning-zone-page {
  position: relative; width: 1920px; height: 1080px; background: #fff2be;
  color: #6c210e; font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}
.learning-zone-page *, .learning-zone-page *::before, .learning-zone-page *::after { box-sizing: border-box; }
.layer { position: absolute; display: block; pointer-events: none; }
.unit-list, .topic-list, .unlock-panel, .unlocked-panel, .back-button { position: absolute; }
.unit-list, .topic-list { display: grid; align-content: start; gap: 18px; }
.unit-button, .topic-button { position: relative; display: grid; place-items: center; border: 0; color: #6c210e; background: transparent; cursor: pointer; font-family: inherit; }
.unit-button { width: 100%; height: 136px; padding: 20px 12px; gap: 8px; font-size: 22px; }
.topic-button { width: 100%; height: 100%; padding: 12px 30px; border-radius: 24px; font-size: 30px; }
.frame-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
.unit-button > span, .unit-button > strong, .topic-button > strong { position: relative; z-index: 1; }
.unit-button > span { font-size: 23px; }
.unit-button strong { white-space: nowrap; font-size: 27px; }
.unit-button.selected > span, .unit-button.selected > strong, .topic-button.selected > strong { color: #a53c14; }
.unit-button.selected, .topic-button.selected { filter: drop-shadow(0 0 8px rgba(232, 159, 41, .58)); }
.unlock-panel { display: flex; flex-direction: column; align-items: stretch; gap: 24px; }
.theme-preview-card { display: grid; gap: 12px; padding: 8px 0 0; }
.unlock-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.unlock-panel h2, .unlock-copy, .status-label { margin: 0; }
.status-label { color: #a53c14; font-weight: 800; font-size: 22px; }
.unlock-panel h2 { font-size: 34px; line-height: 1.3; }
.unlock-copy { font-size: 22px; line-height: 1.4; }
.background-preview { width: 100%; aspect-ratio: 902 / 516; border: 3px dashed #a9632c; border-radius: 20px; background: #fff7d7; overflow: hidden; }
.background-preview > img { display: block; width: 100%; height: 100%; object-fit: contain; }
.theme-preview-stickers { margin-top: 16px; padding-top: 36px; }
.theme-sticker-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.theme-sticker-grid figure { min-width: 0; margin: 0; text-align: center; }
.theme-sticker-grid img { display: block; width: 100%; height: 68px; object-fit: contain; }
.theme-sticker-grid figcaption { margin-top: 6px; font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; }
.begin-guided { border: 2px solid #a45e25; border-radius: 12px; padding: 14px 10px; background: #ffe390; color: #6c210e; font: inherit; font-size: 22px; font-weight: bold; cursor: pointer; }
.begin-guided:disabled { cursor: wait; opacity: .65; }
.unlock-panel > [role="alert"] { margin: 0; font-size: 20px; line-height: 1.4; overflow-wrap: anywhere; }
.unlocked-panel { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 14px; }
.unlocked-panel header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.unlocked-panel h2, .unlocked-panel h3, .unlocked-panel p { margin: 0; }
.unlocked-panel h2 { font-size: 30px; }
.material-list { display: flex; flex-direction: column; gap: 14px; min-height: 0; overflow-y: auto; padding: 4px 8px 4px 4px; }
.material-card { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 12px; width: 100%; padding: 14px; border: 3px solid #a45e25; border-radius: 22px; background: #fff9de; }
.material-card > div { min-width: 0; flex: 1 1 auto; }
.material-card > img { flex: 0 0 auto; width: 100px; height: 126px; object-fit: contain; border-radius: 14px; background: #f1e0ae; }
.background-card { flex-direction: column; }
.background-card > img { width: 100%; height: 170px; }
.material-title { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px; }
.material-card h3 { font-size: 25px; }
.material-card h3 span { font-size: .75em; font-weight: 600; }
.material-card p { margin-top: 8px; color: #71331d; font-size: 21px; line-height: 1.5; white-space: pre-line; }
.material-card button { cursor: pointer; }
.audio-actions { display: flex; flex-wrap: wrap; align-items: center; margin-top: 12px; gap: 8px; }
.audio-button { display: inline-flex; align-items: center; gap: 6px; padding: 4px; border: 0; background: transparent; color: #6c210e; font-weight: 800; font-size: 21px; }
.name-audio-button { flex: 0 0 auto; }
.audio-button img { width: 32px; height: auto; }
.back-button { border: 0; padding: 0; background: transparent; cursor: pointer; }
.back-button img { width: 100%; height: 100%; object-fit: contain; }
.learning-zone-page button:focus-visible { outline: 3px solid #6c210e; outline-offset: 4px; }
</style>
