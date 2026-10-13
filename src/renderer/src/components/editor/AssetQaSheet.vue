<script setup lang="ts">
/**
 * V4.6 阶段 4: 素材「问问它」侧拉面板
 *
 * 视觉对齐 EditorPage 的工作台语言（木质 + 暖橙杏 + 纸张白），
 * 不引入新的色系、不做 ChatGPT/客服/技术 Dashboard 风格。
 *
 * 状态机：
 *  - controller 拥有 history / busy / input / errorMessage / mic 状态
 *  - 独立的 voiceGeneration token 覆盖 getUserMedia 等待 / 录音 /
 *    recorder.onstop 异步 / FileReader / ASR 等待 / 任何 controller 状态变更
 *    任一阶段的 stale
 *  - close / 切素材 / unmount 都 bump generation + voiceGeneration
 *
 * 发送保护（双层）：
 *  - canSend (UI): QA busy / 录音中 / ASR 中 → false
 *  - submitTextQuestion (controller): 同样的 gate，避免 button disabled 失效时
 *    进入半轮状态
 *
 * 错误文案（统一友好，永不暴露 IPC / Gateway / provider / requestId）：
 *  - QA 失败：刚刚没答出来，再试一次吧。
 *  - ASR 失败：刚刚没听清，再说一次吧。
 *  - mic denied：现在不能用麦克风，可以打字问我。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { AssetRecord } from '@shared/contracts'
import { materialQaClient as aiClient } from '../../services/material-qa.client'
import {
  ASSET_QA_MAX_QUESTION,
  AssetQaController,
  type AssetQaSnapshot
} from './asset-qa.controller'
import SourceArtboard from '../artwork/SourceArtboard.vue'
import { suppliedArt } from '../../ui/supplied-controls'
import { handDrawnAssets } from '../../ui/hand-drawn-assets'
import { conciseCopy } from '../../ui/concise-copy'

const props = defineProps<{
  asset: AssetRecord | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const controller = new AssetQaController({
  qaAsk: (input) => aiClient.qaAsk(input).then((result) => ({ answer: result.answer })),
  asrTranscribe: (input) => aiClient.asrTranscribe(input)
})

const snapshot = ref<AssetQaSnapshot>(controller.snapshot())
const panel = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
// Immediate close watcher runs during setup, before the later voice handlers.
let activeStream: MediaStream | null = null
let activeRecorder: MediaRecorder | null = null
let activeChunks: Blob[] = []
let activeVoiceToken = 0
controller.subscribe((s) => { snapshot.value = s })

function panelKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
  if (event.key !== 'Tab') return
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])]
  const first = items[0], last = items[items.length - 1]
  if (!panel.value?.contains(document.activeElement)) { event.preventDefault(); first?.focus() }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

const isBusy = computed(() => snapshot.value.busy)
const isRecording = computed(() => snapshot.value.isRecording)
const isAsrBusy = computed(() => snapshot.value.isAsrBusy)
const isMicStarting = computed(() => snapshot.value.isMicStarting)

// UI guard: any of the four blocking states disables send.
const canSend = computed(() => {
  if (isBusy.value || isRecording.value || isAsrBusy.value || isMicStarting.value) return false
  const text = snapshot.value.input.trim()
  return text.length > 0 && text.length <= ASSET_QA_MAX_QUESTION
})

watch(
  () => props.asset?.assetId,
  (next, prev) => {
    if (prev !== undefined && prev !== next) {
      controller.resetForAssetSwitch()
      releaseMicImmediate()
    }
  }
)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      document.removeEventListener('keydown', panelKeydown)
      controller.resetForClose()
      releaseMicImmediate()
      previousFocus?.focus()
    } else {
      document.addEventListener('keydown', panelKeydown)
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      if (props.open) panel.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    }
  },
  { immediate: true }
)

function onClose(): void {
  emit('close')
}

async function sendTextQuestion(): Promise<void> {
  if (!props.asset) return
  // Second-layer guard: never enter submitTextQuestion if any of the four
  // blocking states is active. The controller also gates internally, but
  // doing it here keeps the surface uniform with canSend.
  if (isBusy.value || isRecording.value || isAsrBusy.value || isMicStarting.value) return
  await controller.submitTextQuestion({
    assetId: props.asset.assetId,
    nameZh: props.asset.nameZh,
    introZh: props.asset.introZh,
    themeId: props.asset.themeId
  })
}

// --- Voice (MediaRecorder) helpers ---
//
// IMPORTANT — per-operation voice token contract:
//
// Every async voice flow captures its OWN immutable `myToken`, `recorder`,
// `stream`, and `chunks` in local variables. After any `await`, the only
// way to tell whether this exact flow is still current is to compare the
// local `myToken` against `controller.captureVoiceGeneration()` — we MUST
// NOT re-read any shared module-scope variable. The recorder callbacks
// (`ondataavailable`, `onstop`, `onerror`) also bind to the per-flow
// locals, never to the shared slot.
//
// The shared `activeStream / activeRecorder / activeChunks / activeVoiceToken`
// slots exist ONLY so that `releaseMicImmediate` (called on close / asset
// switch / unmount) can find the current recorder and stop it. Once a
// per-flow callback runs, it cleans up its own recorder/stream via the
// locals — it does not touch the shared slot for state reads.

interface RecorderContext {
  token: number
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
}

function pickRecorderMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ]
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return candidates[0]!
  }
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime
    } catch {
      // ignore
    }
  }
  return ''
}

async function startRecording(): Promise<void> {
  if (snapshot.value.isRecording || snapshot.value.isAsrBusy || snapshot.value.isMicStarting) return
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    controller.failRecording('unavailable')
    return
  }
  // Capture the voice-generation token LOCALLY. After any await, the only
  // way to check whether THIS flow is still current is to compare against
  // this local — never re-read a shared global, which may have been
  // overwritten by a newer voice flow on a different asset.
  const myToken = controller.captureVoiceGeneration()
  controller.beginRecording()
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    // Late reject: the user may have closed the sheet / switched asset /
    // unmounted (or a newer voice flow on another asset has started)
    // while the mic prompt was open. The Promise then rejects AFTER the
    // controller has been reset, so we must NOT touch state.
    if (!controller.isVoiceTokenCurrent(myToken)) return
    const name = (err as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      controller.failRecording('denied')
    } else {
      controller.failRecording('unavailable')
    }
    return
  }
  // Stale guard: if a newer flow has taken over, drop the stream immediately
  // and never start a MediaRecorder. We compare against OUR local token, not
  // against any shared slot.
  if (!controller.isVoiceTokenCurrent(myToken)) {
    stopStream(stream)
    return
  }
  const mimeType = pickRecorderMimeType()
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  const ctx: RecorderContext = { token: myToken, recorder, stream, chunks }
  // Bind callbacks to the per-flow locals. They must NOT touch the shared
  // slot for state reads.
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) ctx.chunks.push(event.data)
  }
  recorder.onstop = () => {
    void finishRecording(ctx)
  }
  recorder.onerror = () => {
    if (!controller.isVoiceTokenCurrent(ctx.token)) return
    controller.failRecording('unavailable')
    try { ctx.recorder.stop() } catch { /* ignore */ }
    stopStream(ctx.stream)
  }
  // One more stale check right before start().
  if (!controller.isVoiceTokenCurrent(myToken)) {
    stopStream(stream)
    return
  }
  // Stash on shared slot ONLY so releaseMicImmediate can find THIS
  // recorder on close/unmount. The per-flow locals above are still the
  // source of truth for everything else.
  activeStream = stream
  activeRecorder = recorder
  activeChunks = chunks
  activeVoiceToken = myToken
  try {
    recorder.start()
  } catch {
    try { recorder.stop() } catch { /* ignore */ }
    stopStream(stream)
    activeStream = null
    activeRecorder = null
    activeChunks = []
    controller.failRecording('unavailable')
    return
  }
  controller.startRecordingSucceeded()
}

function stopRecording(): void {
  if (!snapshot.value.isRecording) return
  const recorder = activeRecorder
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop() } catch { /* ignore */ }
  } else {
    cleanupRecorder()
    controller.releaseMic()
  }
}

async function finishRecording(ctx: RecorderContext): Promise<void> {
  // Stale guard FIRST. The recorder.onstop callback may fire after the user
  // closed the sheet / switched asset / unmounted (or after a newer voice
  // flow on another asset has started). We must never touch controller
  // state in that case — not even beginTranscribing(). ctx.token is the
  // exact value captured by THIS startRecording invocation; we never
  // re-read any shared global.
  if (!controller.isVoiceTokenCurrent(ctx.token)) {
    try { ctx.recorder.stop() } catch { /* ignore */ }
    stopStream(ctx.stream)
    return
  }
  const mimeType = ctx.recorder.mimeType || 'audio/webm'
  const blob = new Blob(ctx.chunks, { type: mimeType })
  // Clear shared slot if it still points to this flow; otherwise leave
  // the newer flow's references alone.
  if (activeRecorder === ctx.recorder) activeRecorder = null
  if (activeStream === ctx.stream) activeStream = null
  if (activeVoiceToken === ctx.token) {
    activeChunks = []
    activeVoiceToken = 0
  }
  stopStream(ctx.stream)
  controller.beginTranscribing()
  if (ctx.chunks.length === 0) {
    controller.releaseMic()
    return
  }
  try {
    const base64 = await blobToBase64(blob)
    // Stale guard: the sheet/asset might have changed during FileReader.
    if (!controller.isVoiceTokenCurrent(ctx.token)) return
    const result = await aiClient.asrTranscribe({ audioBase64: base64, mimeType })
    if (!controller.isVoiceTokenCurrent(ctx.token)) return
    controller.applyTranscript(result.transcript)
  } catch (err) {
    if (!controller.isVoiceTokenCurrent(ctx.token)) return
    void err
    controller.failTranscription(err)
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const comma = result.indexOf(',')
        resolve(comma >= 0 ? result.slice(comma + 1) : result)
      } else {
        reject(new Error('Audio encoding failed.'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Audio encoding failed.'))
    reader.readAsDataURL(blob)
  })
}

function stopStream(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) track.stop()
  } catch { /* ignore */ }
}

function cleanupRecorder(): void {
  activeRecorder = null
  activeChunks = []
  if (activeStream) {
    stopStream(activeStream)
    activeStream = null
  }
}

function releaseMicImmediate(): void {
  if (activeRecorder && activeRecorder.state !== 'inactive') {
    try { activeRecorder.stop() } catch { /* ignore */ }
  }
  cleanupRecorder()
  controller.bumpVoiceGeneration()
  controller.releaseMic()
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', panelKeydown)
  releaseMicImmediate()
  controller.resetForClose()
})

function toggleRecording(): void {
  if (snapshot.value.busy) return
  if (snapshot.value.isMicStarting) return // second click is silently ignored
  if (snapshot.value.isRecording) stopRecording()
  else void startRecording()
}

const voiceButtonAria = computed(() => {
  if (isRecording.value) return '停止录音'
  if (isMicStarting.value) return '等一下'
  return '说一说'
})

// Voice bar copy anchored on the asset name.
const voiceBarText = computed(() => {
  if (isMicStarting.value) {
    return '准备听你说……'
  }
  if (isRecording.value) {
    return props.asset?.nameZh
      ? `${props.asset.nameZh}正在听你说……`
      : '正在听你说……'
  }
  return ''
})

const emptyTitleCopy = computed(() => {
  if (props.asset?.nameZh) return `你想问${props.asset.nameZh}什么？`
  return '你想问它什么？'
})

const loadingCopy = computed(() => {
  if (props.asset?.nameZh) return `${props.asset.nameZh}正在想一想……`
  return '正在想一想……'
})

const inputPlaceholder = computed(() => {
  if (isMicStarting.value) return '准备听你说……'
  if (isRecording.value) return '说完点“停止”'
  if (isAsrBusy.value) return '正在识别录音…'
  return ''
})
// One conversation turn occupies the original two bubble slots. History scrolls by turn;
 // source geometry is not stretched to fit message length (each text area scrolls).
const thread = ref<HTMLElement>()
const turns = computed(() => {
  const rows: { question: string; answer: string }[] = []
  for (const message of snapshot.value.history) {
    if (message.role === 'user') rows.push({ question: message.content, answer: '' })
    else { if (!rows.length) rows.push({ question: '', answer: '' }); rows[rows.length - 1].answer += message.content }
  }
  return rows.length ? rows : [{ question: '', answer: emptyTitleCopy.value }]
})
watch(() => snapshot.value.history.length, async () => {
  await nextTick()
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight
})
</script>


<template>
  <Teleport to="body">
    <div v-if="open" class="supplied-qa-overlay">
      <button class="qa-backdrop" aria-label="关闭问问它" tabindex="-1" @click="onClose"></button>
      <SourceArtboard>
        <aside ref="panel" class="supplied-qa-panel art-scrollbars" role="dialog" aria-modal="true" aria-label="问问它">
          <div class="qa-panel-hit" aria-hidden="true"></div>
          <img class="qa-source" :src="suppliedArt.qaPanel" alt="" />
          <img class="qa-source" :src="suppliedArt.qaInput" alt="" />
          <h2 class="qa-heading">提问 · {{ asset?.nameZh ?? '素材' }}</h2>
          <button class="qa-close" aria-label="关闭问问它" @click="onClose"><img :src="handDrawnAssets.btnClose" alt="" /></button>
          <div ref="thread" class="qa-turns" role="log" aria-live="polite" aria-label="对话记录" tabindex="0">
            <section v-for="(turn, index) in turns" :key="index" class="qa-turn">
              <svg class="qa-question-art" viewBox="959 207 479 149" aria-hidden="true"><image :href="suppliedArt.qaUser" width="1920" height="1080" /></svg>
              <svg class="qa-answer-art" viewBox="480 363 479 149" aria-hidden="true"><image :href="suppliedArt.qaAssistant" width="1920" height="1080" /></svg>
              <p class="qa-question-text" tabindex="0" aria-label="我的提问">{{ turn.question }}</p>
              <p class="qa-answer-text" tabindex="0" aria-label="回答">{{ turn.answer || (isBusy ? loadingCopy : '') }}</p>
            </section>
          </div>
          <p class="qa-feedback" :role="snapshot.errorMessage ? 'alert' : 'status'">{{ conciseCopy(snapshot.errorMessage || snapshot.micHint || voiceBarText) }}</p>
          <form @submit.prevent="sendTextQuestion">
            <textarea :value="snapshot.input" class="qa-text-entry" :maxlength="ASSET_QA_MAX_QUESTION" :placeholder="inputPlaceholder" :disabled="isBusy || isRecording || isAsrBusy || isMicStarting" aria-label="问问它的问题"
              @input="event => controller.setInput((event.target as HTMLTextAreaElement).value)"
              @keydown.ctrl.enter.prevent="sendTextQuestion"></textarea>
            <button type="button" class="qa-voice-art" :aria-label="voiceButtonAria" :aria-pressed="isRecording" :disabled="isBusy || isAsrBusy || isMicStarting" @click="toggleRecording">
              <svg viewBox="1175 745 199 69" aria-hidden="true"><image :href="suppliedArt.qaVoice" width="1920" height="1080" /></svg>
              <span v-if="isRecording" class="qa-record-state">停止录音</span>
            </button>
            <button class="qa-send" type="submit" :disabled="!canSend" aria-label="发送"><img :src="handDrawnAssets.btnSend" alt="" /></button>
          </form>
        </aside>
      </SourceArtboard>
    </div>
  </Teleport>
</template>
<style scoped>
.supplied-qa-overlay { position: fixed; inset: 0; z-index: 1100; }
.qa-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; padding: 0; background: transparent; }
.supplied-qa-panel { position: absolute; inset: 0; pointer-events: none; color: #652415; }
.qa-source { position: absolute; inset: 0; width: 1920px; height: 1080px; pointer-events: none; }
.qa-panel-hit { position: absolute; left: 440px; top: 157px; width: 1046px; height: 711px; pointer-events: auto; }
.qa-heading { position: absolute; left: 494px; top: 168px; width: 860px; height: 32px; font-size: 24px; line-height: 32px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qa-close { position: absolute; left: 1438px; top: 165px; width: 36px; height: 36px; padding: 0; pointer-events: auto; border: 0; background: transparent; }
.qa-close img { width: 100%; height: 100%; object-fit: contain; }
.qa-turns { position: absolute; left: 480px; top: 207px; width: 976px; height: 305px; overflow-x: hidden; overflow-y: auto; pointer-events: auto; scroll-snap-type: y mandatory; }
.qa-turn { position: relative; width: 958px; height: 305px; scroll-snap-align: start; }
.qa-question-art, .qa-answer-art { position: absolute; width: 479px; height: 149px; pointer-events: none; }
.qa-question-art { left: 479px; top: 0; }.qa-answer-art { left: 0; top: 156px; }
.qa-question-text, .qa-answer-text { position: absolute; width: 419px; height: 80px; overflow-x: hidden; overflow-y: auto; margin: 0; font-size: 24px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
.qa-question-text { left: 504px; top: 17px; }.qa-answer-text { left: 30px; top: 169px; }
.qa-feedback { position: absolute; left: 494px; top: 522px; width: 932px; height: 38px; margin: 0; font-size: 22px; overflow: auto; pointer-events: auto; }
.qa-text-entry { position: absolute; left: 514px; top: 586px; width: 892px; height: 143px; resize: none; border: 0; padding: 8px; background: transparent; color: inherit; font: inherit; font-size: 26px; pointer-events: auto; }
.qa-voice-art { position: absolute; left: 1175px; top: 745px; width: 199px; height: 69px; padding: 0; border: 0; background: transparent; pointer-events: auto; }
.qa-voice-art svg { width: 100%; height: 100%; display: block; }
.qa-record-state { position: absolute; inset: 10px 12px; background: #ffe8a8; display: grid; place-items: center; font-size: 26px; }
.qa-send { position: absolute; left: 995px; top: 750px; width: 150px; height: 58px; pointer-events: auto; padding: 0; border: 0; background: transparent; }
.qa-send img { display: block; width: 100%; height: 100%; object-fit: contain; }
button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 4px solid #71331d; outline-offset: 3px; }
</style>
