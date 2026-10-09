<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { EditorSessionService } from '../../editor'
import { CATALOG_ASSETS, createUnlockedAccess } from '../../catalog/ywn-catalog'
import { themeLabel } from '../../catalog/theme-labels'
import { openLearning } from '../../app-nav'
import { getCurrentUserId } from '../../services/plaza-session'
import { readGameSession, submitGuidedStep, saveUnlockedThemeId, gameResourceUrl, type GameSession } from '../../learning-zone/game-client'

const props = defineProps<{ service: EditorSessionService; sessionId: string; themeId: string }>()
const task = ref<GameSession>()
const index = ref(0)
const added = ref(false)
const listening = ref(false)
const heard = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const complete = ref(false)
let alive = true
let audio: HTMLAudioElement | undefined
let cancelAudio: (() => void) | undefined
const current = computed(() => task.value?.level.stickers[index.value])
const targetStyle = computed(() => {
  const level = task.value?.level, sticker = current.value
  if (!level || !sticker) return {}
  const b = level.canvasBounds, p = sticker.placeholder
  return { left: `${(p.x - b.minX) / (b.maxX - b.minX) * 100}%`, top: `${(p.y - b.minY) / (b.maxY - b.minY) * 100}%`,
    width: `${p.width / (b.maxX - b.minX) * 100}%`, height: `${p.height / (b.maxY - b.minY) * 100}%` }
})

async function initialize(): Promise<void> {
  busy.value = true; error.value = ''
  try {
    const value = await readGameSession(props.sessionId)
    if (!alive) return
    if (value.level.themeId !== props.themeId || value.allFinished) throw new Error('任务身份不一致，请返回主题页重新开始。')
    const background = CATALOG_ASSETS.find(asset => asset.type === 'background' && asset.imageUrl === value.level.backgroundAssetUrl && asset.themeId === props.themeId)
    if (!background) throw new Error('任务背景缺失。')
    // Session-local capability only. Never save this access record to the database.
    await props.service.setBackground(background, createUnlockedAccess(background.assetId, undefined, getCurrentUserId()))
    if (alive) task.value = value
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '任务加载失败。' }
  finally { if (alive) busy.value = false }
}

async function narrate(): Promise<void> {
  const sticker = current.value
  if (!sticker || listening.value || !added.value) return
  heard.value = []; listening.value = true; error.value = ''
  try {
    for (const part of sticker.narrationAudio) {
      if (!alive) return
      await new Promise<void>((resolve, reject) => {
        const player = new Audio(gameResourceUrl(part.assetUrl)); audio = player
        cancelAudio = () => reject(new Error('已退出任务。'))
        player.onended = () => resolve()
        player.onerror = () => reject(new Error('讲解播放失败，请重播当前讲解。'))
        void player.play().catch(reject)
      })
      if (!alive) return
      heard.value.push(part.assetUrl)
    }
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '讲解播放失败。' }
  finally { if (alive) { listening.value = false; audio = undefined; cancelAudio = undefined } }
}

async function addCurrent(): Promise<void> {
  const sticker = current.value, level = task.value?.level
  if (!sticker || !level || busy.value || added.value) return
  busy.value = true; error.value = ''
  try {
    const asset = CATALOG_ASSETS.find(row => row.assetId === sticker.stickerId && row.themeId === props.themeId && row.type === 'sticker')
    if (!asset) throw new Error('任务素材缺失。')
    const objectId = await props.service.addSticker(asset, createUnlockedAccess(asset.assetId, undefined, getCurrentUserId()), {
      left: (level.canvasBounds.maxX - level.canvasBounds.minX) * .5,
      top: (level.canvasBounds.maxY - level.canvasBounds.minY) * .85,
      fitBox: { width: sticker.placeholder.width, height: sticker.placeholder.height }
    })
    if (!alive) return
    props.service.selectObject(objectId)
    added.value = true
    void narrate()
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '素材添加失败。' }
  finally { if (alive) busy.value = false }
}

async function checkStep(): Promise<void> {
  const sticker = current.value
  if (!sticker || busy.value || listening.value || !added.value || heard.value.length !== sticker.narrationAudio.length) return
  busy.value = true; error.value = ''
  try {
    const result = await submitGuidedStep(props.sessionId, sticker.stickerId, props.service.prepareDraftSave(), [...heard.value])
    if (!alive) return
    index.value++; added.value = false; heard.value = []
    if (result.allFinished) await finishUnlock()
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '位置检查失败，请重试。' }
  finally { if (alive) busy.value = false }
}

async function finishUnlock(): Promise<void> {
  busy.value = true; error.value = ''
  try {
    await saveUnlockedThemeId(props.themeId, props.sessionId)
    if (alive) complete.value = true
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '主题权限保存失败，请重试。' }
  finally { if (alive) busy.value = false }
}

onMounted(initialize)
onBeforeUnmount(() => { alive = false; audio?.pause(); cancelAudio?.() })
</script>

<template>
  <div v-if="current" class="guided-target" :style="targetStyle" aria-hidden="true"><img :src="current.stickerAssetUrl" alt=""></div>
  <Teleport to="body">
  <section class="guided-controls" aria-label="主题解锁引导">
    <div class="guided-instructions" aria-live="polite">
      <strong>{{ themeLabel(themeId) }} · {{ complete ? '整个主题已解锁' : '引导创作' }}</strong>
      <p v-if="current">第 {{ index + 1 }} / {{ task?.level.stickers.length }} 步：添加{{ current.name }}，拖到虚线提示位置，并听完讲解。</p>
      <p v-else-if="complete">本主题背景和贴纸已全部开放，可返回自由创作使用。</p>
      <p v-else>{{ task ? '操作已完成，正在保存主题解锁权限。' : '正在准备任务画布…' }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div class="guided-actions">
      <button v-if="current && !added" :disabled="busy" @click="addCurrent">添加{{ current.name }}</button>
      <button v-if="current && added" :disabled="busy || listening" @click="narrate">{{ listening ? '正在讲解…' : '重播讲解' }}</button>
      <button v-if="current" :disabled="busy || !added || listening || heard.length !== current.narrationAudio.length" @click="checkStep">检查这一步</button>
      <button v-if="task && !current && !complete" :disabled="busy" @click="finishUnlock">重试保存主题解锁</button>
      <button v-if="!task && error" :disabled="busy" @click="initialize">重试加载</button>
      <button v-if="complete" @click="openLearning(themeId)">查看已解锁主题素材</button>
    </div>
  </section>
  </Teleport>
</template>

<style scoped>
.guided-target { position: absolute; pointer-events: none; border: 3px dashed #71331d; border-radius: 12px; box-sizing: border-box; z-index: 3; }
.guided-target img { width: 100%; height: 100%; object-fit: contain; opacity: .22; }
.guided-controls { position: fixed; z-index: 50; bottom: 2vh; left: 15vw; right: 15vw; display: flex; align-items: center; gap: 16px; padding: 12px 18px; border: 2px solid #a45e25; border-radius: 16px; background: #fff9de; color: #6c210e; max-height: 24vh; overflow-y: auto; }
.guided-instructions { flex: 1; min-width: 0; }.guided-instructions p { margin: 4px 0; font-size: 14px; }
.guided-actions { display: flex; gap: 8px; flex-wrap: wrap; max-width: 45%; }
button { color: #6c210e; border: 1px solid #a45e25; border-radius: 8px; background: #ffe390; padding: 8px 12px; cursor: pointer; font: inherit; }
button:disabled { opacity: .55; cursor: default; }button:focus-visible { outline: 3px solid #71331d; outline-offset: 2px; }
@media(max-width: 1000px) { .guided-controls { left: 6vw; right: 6vw; bottom: 1vh; padding: 8px; gap: 8px; }.guided-actions { max-width: 48%; } }
</style>
