<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { CATALOG_ASSETS, createBlankScene } from '../catalog/ywn-catalog'
import { getLearningThemeId, openEditor, openLibrary, openLobby } from '../app-nav'
import AssetQaSheet from '../components/editor/AssetQaSheet.vue'
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

function topicListStyle(): CSSProperties {
  return {
    ...box(575, 150, 415, 880, 32),
    transform: 'scale(.8)',
    transformOrigin: 'top left',
    gridTemplateRows: `repeat(${selectedUnit.value.topics.length}, 84px)`
  }
}

function unitListStyle(): CSSProperties {
  return {
    ...box(400, 145, 180, 570, 31),
    transform: 'scale(.8)',
    transformOrigin: 'top left'
  }
}

function unlockPanelStyle(): CSSProperties {
  return {
    ...box(1080, 205, 450, 730, 90),
    transform: 'scale(.8)',
    transformOrigin: 'top left'
  }
}

function unlockFrameStyle(): CSSProperties {
  return {
    ...box(0, 0, 1920, 1080, 5),
    transform: 'translateY(12px) scaleY(1.15)',
    transformOrigin: '50% 31%'
  }
}

function unlockedPanelStyle(): CSSProperties {
  return {
    ...box(1020, 155, 560, 825, 90),
    transform: 'scale(.8)',
    transformOrigin: 'top left'
  }
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
    const scene = createBlankScene(`${topic.name}·引导解锁`, topic.themeId)
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
  <section class="learning-zone-page" aria-label="学习区">
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
      <div class="unlock-heading"><span class="status-label">待解锁</span><h2>{{ selectedTopic.name }}</h2></div>
      <p class="unlock-copy">前往创作画布，按引导完成摆放与讲解，解锁整个主题。</p>
      <div class="background-preview" aria-label="主题背景预览">
        <img v-if="background" :src="previewUrl(background.thumbnailUrl ?? background.imageUrl)" :alt="background.nameZh">
      </div>
      <div class="theme-preview-stickers"><img v-for="asset in stickers" :key="asset.assetId" :src="previewUrl(asset.thumbnailUrl ?? asset.imageUrl)" :alt="asset.nameZh"></div>
      <button class="begin-guided" type="button" data-tour-id="tour-learning-guided" :disabled="loadingGame" @click="beginGuidedCreation">{{ loadingGame ? '正在准备…' : '进入引导创作，解锁本主题' }}</button>
      <p v-if="gameError" role="alert">{{ gameError }}</p>
      </section>
    </template>
    <section v-else class="unlocked-panel" :style="unlockedPanelStyle()" :aria-label="`${selectedTopic.name}已解锁内容`">
      <header><span class="status-label">已解锁</span><h2>{{ selectedTopic.name }}的素材</h2></header>
      <p class="unlocked-copy">背景和主题贴纸均已收集，可随时播放名称与介绍音频。</p>
      <div class="material-list">
        <article v-for="asset in unlockedAssets" :key="asset.assetId" class="material-card" :class="{ 'background-card': asset.type === 'background' }">
          <img :src="previewUrl(asset.thumbnailUrl ?? asset.imageUrl)" :alt="asset.nameZh">
          <div>
            <div class="material-title"><h3>{{ asset.nameZh }} <span>/ {{ asset.nameEn }}</span></h3><button class="audio-button name-audio-button" type="button" :aria-label="`播放${asset.nameZh}的中英文名称`" @click="playCatalogAudio([asset.audio.nameZhUrl, asset.audio.nameEnUrl])"><img :src="imageFor('audio-button.png')" alt="">中英文名称</button></div>
            <p>{{ asset.introZh }}</p>
            <button type="button" @click="stopActiveAudio(); qaAsset = asset">问问它</button>
            <div class="audio-actions" :aria-label="`${asset.nameZh}的音频`">
              <button class="audio-button" type="button" :aria-label="`播放${asset.nameZh}的中文介绍`" @click="playCatalogAudio([asset.audio.introZhUrl])"><img :src="imageFor('audio-button.png')" alt="">中文介绍</button>
            </div>
          </div>
        </article>
      </div>
    </section>


    <img class="layer" :src="imageFor('learning-border.png')" alt="" :style="box(0, 0, 1920, 1080, 70)">
    <button class="back-button" type="button" aria-label="返回大厅" :style="box(39, 35, 208, 112, 100)" @click="openLobby"><img :src="imageFor('back-button.png')" alt=""></button>
  </section>
  <AssetQaSheet :asset="qaAsset" :open="!!qaAsset" @close="qaAsset = null" />
</template>

<style scoped>
.learning-zone-page { position: relative; width: 100vw; min-height: 100vh; overflow: hidden; aspect-ratio: 16 / 9; background: #fff2be; color: #6c210e; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
.layer { position: absolute; display: block; pointer-events: none; }
.unit-list, .topic-list, .unlock-panel, .unlocked-panel, .back-button { position: absolute; }
.unit-list, .topic-list { display: grid; align-content: start; gap: 12px; }
.unit-button, .topic-button { position: relative; display: grid; place-items: center; border: 0; color: #6c210e; background: transparent; cursor: pointer; font-family: inherit; }
.unit-button { width: 100%; height: 116px; padding: clamp(5px, 1vw, 20px) clamp(6px, 1.2vw, 24px); gap: 2px; font-size: clamp(10px, 1.05vw, 20px); }
.topic-button { width: 100%; height: 100%; padding: 10px 36px; overflow: hidden; border-radius: 24px; font-size: clamp(17px, 1.6vw, 31px); }
.frame-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }.topic-button .frame-image { transform: scale(1.035); }
.unit-button > span, .unit-button > strong, .topic-button > strong { position: relative; z-index: 1; }
.unit-button > span { font-size: clamp(13px, 1.35vw, 26px); }
.unit-button strong { font-size: clamp(17px, 1.6vw, 30px); transform: translateY(-8px); }
.unit-button.selected > span, .unit-button.selected > strong, .topic-button.selected > strong { color: #a53c14; }
.unit-button.selected, .topic-button.selected { filter: drop-shadow(0 0 8px rgba(232, 159, 41, 0.58)); }
.unlock-panel { display: grid; grid-template-rows: auto auto 1fr auto; gap: 7px; padding: clamp(7px, .95vw, 18px) clamp(10px, 1.35vw, 26px); }.unlock-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; transform: translateY(-20px); }.unlock-panel h2, .unlock-copy, .status-label { margin: 0; }.status-label { color: #a53c14; font-weight: 800; font-size: clamp(11px, 1.2vw, 22px); }.unlock-panel h2 { font-size: clamp(20px, 2vw, 38px); }.unlock-copy { font-size: clamp(10px, 1.1vw, 21px); line-height: 1.4; transform: translateY(-20px); }
.background-preview { position: relative; width: calc(100% + 40px); aspect-ratio: 902 / 516; margin-left: -20px; overflow: hidden; border: 3px dashed #a9632c; border-radius: 20px; background: #fff7d7; transform: translateY(-14px); }.background-preview > img { width: 100%; height: 100%; object-fit: cover; }.target-shadow { position: absolute; display: block; transform: translate(-50%, -50%); pointer-events: none; }.target-shadow::after { position: absolute; inset: 4%; box-sizing: border-box; border: 3px dashed rgba(112, 57, 28, .9); border-radius: 50%; content: ''; }.target-shadow img { width: 100%; height: 100%; object-fit: contain; filter: grayscale(1) brightness(.35); opacity: .42; }.placed-sticker { position: absolute; width: 24%; height: 24%; transform: translate(-50%, -50%); pointer-events: none; }.placed-sticker img { width: 100%; height: 100%; object-fit: contain; }
.sticker-tray { position: absolute; top: 330px; left: -12px; width: calc(100% + 52px); min-width: 0; }.sticker-tray > p { margin: 0 0 4px; font-weight: 800; font-size: clamp(12px, 1.3vw, 24px); }.sticker-list { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(4px, .65vw, 12px); overflow: visible; }.sticker-card { min-width: 0; text-align: center; font-weight: 700; font-size: clamp(12px, 1.18vw, 22px); cursor: grab; }.sticker-card.locked { opacity: .45; cursor: not-allowed; }.sticker-card img { display: block; width: clamp(38px, 4.5vw, 68px); height: clamp(38px, 4.5vw, 68px); margin: 0 auto 2px; object-fit: contain; }.game-message { color: #a53c14; }
.retry-audio-button { padding: 3px 8px; border: 1px solid #a45e25; border-radius: 8px; background: #fff9de; color: #6c210e; font: inherit; font-weight: 800; cursor: pointer; }
.unlocked-panel { display: grid; grid-template-rows: auto auto 1fr; gap: 9px; padding: 0; background: transparent; }.unlocked-panel header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }.unlocked-panel h2, .unlocked-panel h3, .unlocked-panel p { margin: 0; }.unlocked-panel h2 { font-size: clamp(16px, 1.65vw, 32px); }.unlocked-copy { font-size: clamp(8px, .85vw, 16px); line-height: 1.5; }.material-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 2px 6px 2px 2px; }.material-card { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 10px; width: 100%; aspect-ratio: auto; padding: 10px; border: 3px solid #a45e25; border-radius: 22px; background: #fff9de; }.material-card > div { min-width: 0; flex: 1 1 auto; }.material-card > img { flex: 0 0 auto; width: clamp(58px, 6.5vw, 110px); height: 126px; object-fit: contain; border-radius: 14px; background: #f1e0ae; }.background-card { flex-direction: column; }.background-card > img { width: 100%; height: 140px; }.material-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }.material-card h3 { font-size: clamp(12px, 1.3vw, 24px); }.material-card h3 span { font-size: .68em; font-weight: 600; }.material-card p { margin-top: 4px; color: #71331d; font-size: clamp(8px, .8vw, 15px); line-height: 1.4; white-space: pre-line; }.audio-actions { display: flex; margin-top: 8px; }.audio-button { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: #6c210e; font-weight: 800; font-size: clamp(8px, .8vw, 15px); }.name-audio-button { flex: 0 0 auto; }.audio-button img { width: clamp(18px, 2vw, 38px); height: auto; }
.back-button { border: 0; padding: 0; background: transparent; cursor: pointer; }.back-button img { width: 100%; height: 100%; object-fit: contain; }
.celebration-video { position: fixed; inset: 15% 25%; z-index: 200; width: 50%; max-height: 70%; border: 4px solid #a45e25; border-radius: 20px; background: #fff9de; }
/* PS artboards scale to .8; keep the rendered reading size at least 12px. */
.unlock-copy, .unlocked-copy, .material-card p, .audio-button { font-size: clamp(15px, 1.1vw, 21px); }
.unit-button strong { white-space: nowrap; font-size: clamp(15px, 1.6vw, 30px); }
.material-title { flex-wrap: wrap; }
.audio-actions { flex-wrap: wrap; gap: 6px; }
.background-preview > img { object-fit: contain; }
.theme-preview-stickers { display: flex; flex-wrap: wrap; gap: 6px; }
.unlock-panel { display: flex; flex-direction: column; height: auto !important; gap: 12px; }
.unlock-heading, .unlock-copy { transform: none; }
.background-preview { flex: none; width: 100%; margin: 0; transform: none; }
.background-preview > img { display: block; }
.theme-preview-stickers img { width: 48px; height: 48px; object-fit: contain; }
.begin-guided { border: 2px solid #a45e25; border-radius: 12px; padding: 10px; background: #ffe390; color: #6c210e; font: inherit; font-weight: bold; cursor: pointer; }
.begin-guided:focus-visible { outline: 3px solid #6c210e; outline-offset: 3px; }
</style>
