<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue'
import { CATALOG_ASSETS } from '../catalog/ywn-catalog'
import { openLibrary } from '../app-nav'

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

const selectedUnit = ref(units[0])
const selectedTopic = ref(units[0].topics[0])
const reviewUnlocked = new URLSearchParams(window.location.search).get('learning-preview') === 'unlocked'
const selectedAssets = computed(() => CATALOG_ASSETS.filter((asset) => asset.themeId === selectedTopic.value.themeId))
const background = computed(() => selectedAssets.value.find((asset) => asset.type === 'background'))
const stickers = computed(() => selectedAssets.value.filter((asset) => asset.type === 'sticker'))
const unlockedAssets = computed(() => [
  ...selectedAssets.value.filter((asset) => asset.type === 'background'),
  ...selectedAssets.value.filter((asset) => asset.type === 'sticker')
])

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
    ...box(1080, 205, 450, 330, 90),
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

    <template v-if="!reviewUnlocked">
      <img class="layer" :src="imageFor('素材展示页05.png')" alt="" :style="unlockFrameStyle()">
      <section class="unlock-panel" :style="unlockPanelStyle()" :aria-label="`${selectedTopic.name}待解锁内容`">
      <div class="unlock-heading"><span class="status-label">待解锁</span><h2>{{ selectedTopic.name }}</h2></div>
      <p class="unlock-copy">拖动每张贴纸到背景中的虚线位置，即可解锁本主题。</p>
      <div class="background-preview" aria-label="主题背景目标区">
        <img v-if="background" :src="previewUrl(background.thumbnailUrl)" :alt="background.nameZh">
        <span v-for="sticker in stickers" :key="sticker.assetId" class="target-dot" :style="{ left: `${20 + stickers.indexOf(sticker) * 28}%` }" aria-hidden="true"></span>
      </div>
      <section class="sticker-tray" aria-label="待拖拽贴纸">
        <p>待放置贴纸</p>
        <div class="sticker-list">
          <article v-for="sticker in stickers" :key="sticker.assetId" class="sticker-card" draggable="true"><img :src="previewUrl(sticker.thumbnailUrl)" :alt="sticker.nameZh"><span>{{ sticker.nameZh }}</span></article>
        </div>
      </section>
      </section>
    </template>
    <section v-else class="unlocked-panel" :style="unlockedPanelStyle()" :aria-label="`${selectedTopic.name}已解锁内容`">
      <header><span class="status-label">已解锁</span><h2>{{ selectedTopic.name }}的素材</h2></header>
      <p class="unlocked-copy">背景和主题贴纸均已收集，可随时播放名称与介绍音频。</p>
      <div class="material-list">
        <article v-for="asset in unlockedAssets" :key="asset.assetId" class="material-card" :class="{ 'background-card': asset.type === 'background' }">
          <img :src="previewUrl(asset.thumbnailUrl)" :alt="asset.nameZh">
          <div>
            <div class="material-title"><h3>{{ asset.nameZh }} <span>/ {{ asset.nameEn }}</span></h3><button class="audio-button name-audio-button" type="button" :aria-label="`播放${asset.nameZh}的中英文名称`"><img :src="imageFor('audio-button.png')" alt="">中英文名称</button></div>
            <p>{{ asset.introZh }}</p>
            <div class="audio-actions" :aria-label="`${asset.nameZh}的音频`">
              <button class="audio-button" type="button" :aria-label="`播放${asset.nameZh}的中文介绍`"><img :src="imageFor('audio-button.png')" alt="">中文介绍</button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <img class="layer" :src="imageFor('learning-border.png')" alt="" :style="box(0, 0, 1920, 1080, 70)">
    <button class="back-button" type="button" aria-label="返回素材库" :style="box(39, 35, 208, 112, 100)" @click="openLibrary"><img :src="imageFor('back-button.png')" alt=""></button>
  </section>
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
.background-preview { position: relative; width: calc(100% + 40px); aspect-ratio: 902 / 516; margin-left: -20px; overflow: hidden; border: 3px dashed #a9632c; border-radius: 20px; background: #fff7d7; transform: translateY(-14px); }.background-preview img { width: 100%; height: 100%; object-fit: cover; }.target-dot { position: absolute; top: 52%; width: 34px; height: 34px; border: 3px dashed #8a3b1c; border-radius: 50%; background: rgba(255, 247, 217, .72); transform: translate(-50%, -50%); }
.sticker-tray { position: absolute; top: 270px; left: -12px; width: calc(100% + 52px); min-width: 0; }.sticker-tray > p { margin: 0 0 4px; font-weight: 800; font-size: clamp(12px, 1.3vw, 24px); }.sticker-list { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(4px, .65vw, 12px); overflow: visible; }.sticker-card { min-width: 0; text-align: center; font-weight: 700; font-size: clamp(12px, 1.18vw, 22px); cursor: grab; }.sticker-card img { display: block; width: clamp(38px, 4.5vw, 68px); height: clamp(38px, 4.5vw, 68px); margin: 0 auto 2px; object-fit: contain; }
.unlocked-panel { display: grid; grid-template-rows: auto auto 1fr; gap: 9px; padding: 0; background: transparent; }.unlocked-panel header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }.unlocked-panel h2, .unlocked-panel h3, .unlocked-panel p { margin: 0; }.unlocked-panel h2 { font-size: clamp(16px, 1.65vw, 32px); }.unlocked-copy { font-size: clamp(8px, .85vw, 16px); line-height: 1.5; }.material-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 2px 6px 2px 2px; }.material-card { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 10px; width: 100%; aspect-ratio: auto; padding: 10px; border: 3px solid #a45e25; border-radius: 22px; background: #fff9de; }.material-card > div { min-width: 0; flex: 1 1 auto; }.material-card > img { flex: 0 0 auto; width: clamp(58px, 6.5vw, 110px); height: 126px; object-fit: contain; border-radius: 14px; background: #f1e0ae; }.background-card { flex-direction: column; }.background-card > img { width: 100%; height: 140px; }.material-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }.material-card h3 { font-size: clamp(12px, 1.3vw, 24px); }.material-card h3 span { font-size: .68em; font-weight: 600; }.material-card p { margin-top: 4px; color: #71331d; font-size: clamp(8px, .8vw, 15px); line-height: 1.4; white-space: pre-line; }.audio-actions { display: flex; margin-top: 8px; }.audio-button { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: #6c210e; font-weight: 800; font-size: clamp(8px, .8vw, 15px); }.name-audio-button { flex: 0 0 auto; }.audio-button img { width: clamp(18px, 2vw, 38px); height: auto; }
.back-button { border: 0; padding: 0; background: transparent; cursor: pointer; }.back-button img { width: 100%; height: 100%; object-fit: contain; }
</style>
