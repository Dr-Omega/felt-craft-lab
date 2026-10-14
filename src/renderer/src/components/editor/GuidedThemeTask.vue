<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { EditorSessionService } from '../../editor'
import { CATALOG_ASSETS, createUnlockedAccess } from '../../catalog/ywn-catalog'
import { themeLabel } from '../../catalog/theme-labels'
import { playNarration } from '../../learning-zone/narration-playback'
import { acceptsGuidedDrop, guidedStepReady } from '../../learning-zone/guided-placement'
import { openLearning } from '../../app-nav'
import { getCurrentUserId } from '../../services/plaza-session'
import { readGameSession, submitGuidedStep, saveUnlockedThemeId, gameResourceUrl, type GameSession } from '../../learning-zone/game-client'

const props = defineProps<{ service: EditorSessionService; sessionId: string; themeId: string }>()
const task = ref<GameSession>(), surface = ref<HTMLElement>()
const index = ref(0), placed = ref(false), listening = ref(false), busy = ref(false), complete = ref(false)
const heard = ref<string[]>([]), error = ref(''), hint = ref('拖到轮廓里，边玩边听')
const armed = ref(false), drag = ref<{ id: number; x: number; y: number; moved: boolean; startX: number; startY: number }>()
let alive = true, audioAbort: AbortController | undefined
const current = computed(() => task.value?.level.stickers[index.value])
const praiseFiles = ['good_job_animation.mp4', 'well_done_animation.mp4', 'nice_work_animation.mp4', 'excellent_animation.mp4', 'fantastic_animation.mp4', 'amazing_animation.mp4']
const targetStyle = computed(() => {
  const level = task.value?.level, sticker = current.value
  if (!level || !sticker) return {}
  const b = level.canvasBounds, p = sticker.placeholder
  return { left: `${(p.x - b.minX) / (b.maxX - b.minX) * 100}%`, top: `${(p.y - b.minY) / (b.maxY - b.minY) * 100}%`,
    width: `${p.width / (b.maxX - b.minX) * 100}%`, height: `${p.height / (b.maxY - b.minY) * 100}%` }
})
const ghostStyle = computed(() => {
  const r = surface.value?.getBoundingClientRect(), b = task.value?.level.canvasBounds, p = current.value?.placeholder
  return { left: `${drag.value?.x ?? 0}px`, top: `${drag.value?.y ?? 0}px`,
    width: `${r && b && p ? p.width / (b.maxX - b.minX) * r.width : 80}px`,
    height: `${r && b && p ? p.height / (b.maxY - b.minY) * r.height : 80}px` }
})

async function initialize(): Promise<void> {
  busy.value = true; error.value = ''
  try {
    const value = await readGameSession(props.sessionId)
    if (!alive) return
    if (value.level.themeId !== props.themeId || value.allFinished) throw new Error('任务已变化，请返回主题页重试。')
    const background = CATALOG_ASSETS.find(asset => asset.type === 'background' && asset.imageUrl === value.level.backgroundAssetUrl && asset.themeId === props.themeId)
    if (!background) throw new Error('任务背景缺失。')
    await props.service.setBackground(background, createUnlockedAccess(background.assetId, undefined, getCurrentUserId()))
    if (alive) task.value = value
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '任务加载失败。' }
  finally { if (alive) busy.value = false }
}

async function narrate(): Promise<void> {
  const sticker = current.value
  if (!sticker || listening.value || busy.value) return
  heard.value = []; listening.value = true; error.value = ''
  const controller = new AbortController(); audioAbort = controller
  try {
    for (const part of sticker.narrationAudio) {
      await playNarration(new Audio(gameResourceUrl(part.assetUrl)), controller.signal)
      if (!alive) return
      heard.value.push(part.assetUrl)
    }
  } catch { if (alive) error.value = '声音没播完，点一下素材再听。' }
  finally {
    if (alive) { listening.value = false; audioAbort = undefined; void checkStep() }
  }
}

function activate(): void {
  if (busy.value || !current.value) return
  armed.value = !placed.value
  void narrate()
}
function pointerDown(event: PointerEvent): void {
  if (event.button !== 0 || busy.value || placed.value || !current.value || drag.value) return
  event.preventDefault()
  const element = event.currentTarget as HTMLElement
  element.focus(); element.setPointerCapture(event.pointerId)
  drag.value = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }
  armed.value = true
  if (!listening.value && heard.value.length !== current.value.narrationAudio.length) void narrate()
}
function pointerMove(event: PointerEvent): void {
  const d = drag.value
  if (!d || d.id !== event.pointerId) return
  d.x = event.clientX; d.y = event.clientY
  d.moved ||= Math.hypot(d.x - d.startX, d.y - d.startY) > 5
}
function pointerUp(event: PointerEvent): void {
  const d = drag.value
  if (!d || d.id !== event.pointerId) return
  drag.value = undefined
  if (!d.moved) { if (!listening.value) void narrate(); return }
  const rect = surface.value?.getBoundingClientRect(), level = task.value?.level
  if (rect && level && current.value && acceptsGuidedDrop(current.value, level.canvasBounds, rect, event.clientX, event.clientY)) void placeCurrent()
  else { armed.value = false; hint.value = '再试试，拖到发亮的轮廓里' }
}
function cancelDrag(): void { drag.value = undefined; armed.value = false }

async function placeCurrent(): Promise<void> {
  const sticker = current.value, level = task.value?.level
  if (!sticker || !level || busy.value || placed.value || !armed.value) return
  busy.value = true; error.value = ''
  try {
    const asset = CATALOG_ASSETS.find(row => row.assetId === sticker.stickerId && row.themeId === props.themeId && row.type === 'sticker')
    if (!asset) throw new Error('任务素材缺失。')
    const a = sticker.targetArea, b = level.canvasBounds
    await props.service.addSticker(asset, createUnlockedAccess(asset.assetId, undefined, getCurrentUserId()), {
      left: (a.minX + a.maxX) / 2 - b.minX, top: (a.minY + a.maxY) / 2 - b.minY,
      fitBox: { width: sticker.placeholder.width, height: sticker.placeholder.height }
    })
    if (!alive) return
    placed.value = true; armed.value = false; hint.value = listening.value ? '放对啦，接着听' : '放对啦'
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '素材没放好，再试一次。' }
  finally { if (alive) { busy.value = false; void checkStep() } }
}

async function checkStep(): Promise<void> {
  const sticker = current.value
  if (!sticker || !guidedStepReady(placed.value, listening.value, busy.value, heard.value, sticker.narrationAudio.map(a => a.assetUrl))) return
  busy.value = true; error.value = ''
  try {
    const result = await submitGuidedStep(props.sessionId, sticker.stickerId, props.service.prepareDraftSave(), [...heard.value])
    if (!alive) return
    index.value++; placed.value = false; heard.value = []; hint.value = '拖到轮廓里，边玩边听'
    if (result.allFinished) await finishUnlock()
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '进度没记好，点素材重试。' }
  finally { if (alive) busy.value = false }
}

async function finishUnlock(): Promise<void> {
  if (complete.value) return
  busy.value = true; error.value = ''
  try {
    await saveUnlockedThemeId(props.themeId, props.sessionId)
    if (!alive) return
    complete.value = true
    // Praise once per whole theme, including after a successful persistence retry.
    const controller = new AbortController(); audioAbort = controller
    try { await playNarration(new Audio(gameResourceUrl(`/celebrations/${praiseFiles[Math.floor(Math.random() * praiseFiles.length)]}`)), controller.signal) }
    catch { /* Optional praise cannot revoke a successfully validated learning task. */ }
    if (alive) audioAbort = undefined
  }
  catch { if (alive) error.value = '进度没保存好，请重试。' }
  finally { if (alive) busy.value = false }
}

onMounted(initialize)
onBeforeUnmount(() => { alive = false; audioAbort?.abort(); cancelDrag() })
</script>

<template>
  <div ref="surface" class="guided-surface">
    <button v-if="current" class="guided-target" :class="{ 'is-placed': placed }" :style="targetStyle"
      :aria-label="placed ? `重听${current.name}` : `放置${current.name}的位置`" :disabled="busy || (!armed && !placed)"
      @click="placed ? activate() : placeCurrent()"><img v-if="!placed" :src="current.stickerAssetUrl" alt="" /></button>
  </div>
  <Teleport to="body">
    <img v-if="drag?.moved && current" class="guided-drag-ghost" :src="current.stickerAssetUrl" :style="ghostStyle" alt="" />
    <section class="guided-tray" aria-label="主题解锁引导" :aria-busy="busy">
      <p class="guided-status" role="status">{{ themeLabel(themeId) }} · {{ complete ? '主题已解锁' : current ? hint : '正在准备…' }}</p>
      <div v-if="task && !complete" class="guided-materials" aria-label="待放置素材">
        <button v-for="(sticker, i) in task.level.stickers" :key="sticker.stickerId" class="guided-material"
          :class="{ current: i === index, done: i < index, placed: i === index && placed }" :disabled="i !== index || busy"
          :aria-label="`${i < index ? '已完成' : i === index && placed ? '重听' : '拖动'}${sticker.name}`" :aria-current="i === index ? 'step' : undefined"
          @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelDrag" @lostpointercapture="drag && cancelDrag()"
          @click="($event.detail === 0 || placed) && activate()" @dragstart.prevent>
          <img :src="sticker.stickerAssetUrl" alt="" draggable="false" /><span>{{ sticker.name }}</span>
        </button>
      </div>
      <p v-if="error" class="guided-error" role="alert">{{ error }}</p>
      <button v-if="!task && error" class="hand-btn-primary" :disabled="busy" @click="initialize">重试加载</button>
      <button v-if="task && !current && !complete && error" class="hand-btn-primary" :disabled="busy" @click="finishUnlock">重试保存</button>
      <button v-if="complete" class="hand-btn-primary" @click="openLearning(themeId)">查看主题素材</button>
    </section>
  </Teleport>
</template>

<style scoped>
.guided-surface { position: absolute; inset: 0; z-index: 3; }
.guided-target { position: absolute; padding: 0; border: 3px dashed #71331d; border-radius: 12px; background: #fff4bd22; box-sizing: border-box; animation: guided-breathe 2.8s ease-in-out infinite; }
.guided-target img { width: 100%; height: 100%; object-fit: contain; opacity: .32; pointer-events: none; }
.guided-target:disabled { opacity: 1; cursor: default; }
.guided-target.is-placed { animation: none; border-color: transparent; background: transparent; }
@keyframes guided-breathe { 0%, 100% { opacity: .42; } 50% { opacity: .95; } }
@media(prefers-reduced-motion: reduce) { .guided-target { animation: none; opacity: .8; } }
.guided-tray { position: fixed; z-index: 50; bottom: 1vh; left: 18vw; right: 18vw; display: grid; justify-items: center; gap: 3px; color: #6c210e; }
.guided-status { margin: 0; font-size: 15px; text-align: center; background: #fff4bdd9; border-radius: 12px; padding: 2px 12px; }
.guided-materials { display: flex; justify-content: center; gap: 16px; max-width: 100%; overflow-x: auto; }
.guided-material { position: relative; flex: 0 0 auto; display: grid; justify-items: center; width: 100px; padding: 4px 8px; gap: 2px; border: 2px solid transparent; border-radius: 16px; background: transparent; color: inherit; font: inherit; font-size: 14px; touch-action: none; user-select: none; cursor: grab; }
.guided-material img { height: 64px; width: 80px; object-fit: contain; pointer-events: none; }
.guided-material.current { border-color: #8c552d; background: #fff4bdd9; }.guided-material:disabled { opacity: .45; cursor: default; }.guided-material.done { opacity: .65; }.guided-material.placed { cursor: pointer; }
.guided-material:focus-visible, .guided-target:focus-visible { outline: 3px solid #71331d; outline-offset: 3px; }
.guided-drag-ghost { position: fixed; z-index: 100; transform: translate(-50%, -50%); object-fit: contain; pointer-events: none; opacity: .9; }
.guided-error { margin: 0; padding: 3px 10px; background: #fff4bd; color: #a13c22; font-size: 14px; }
@media(max-width: 1000px) { .guided-tray { left: 16vw; right: 16vw; }.guided-status { font-size: 12px; }.guided-material { width: 76px; font-size: 12px; padding: 2px 4px; }.guided-material img { width: 62px; height: 44px; } }
</style>
