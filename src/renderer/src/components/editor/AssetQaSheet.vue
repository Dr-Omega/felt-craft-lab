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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AssetRecord } from '@shared/contracts'
import { aiClient } from '../../services/ai.client'
import {
  ASSET_QA_MAX_QUESTION,
  AssetQaController,
  type AssetQaSnapshot
} from './asset-qa.controller'
import { handDrawnAssets } from '../../ui/hand-drawn-assets'

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
controller.subscribe((s) => { snapshot.value = s })

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
  (open) => {
    if (!open) {
      controller.resetForClose()
      releaseMicImmediate()
    }
  }
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

let activeStream: MediaStream | null = null
let activeRecorder: MediaRecorder | null = null
let activeChunks: Blob[] = []
let activeVoiceToken = 0

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
    controller.failTranscription()
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
  return '可以打字，也可以说给它听。'
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
  if (isAsrBusy.value) return '正在听你刚才说的……'
  if (props.asset?.nameZh) return `问${props.asset.nameZh}一个问题吧`
  return '问它一个问题吧'
})
</script>

<template>
  <Teleport to="body">
    <button
      v-if="open"
      class="asset-qa-backdrop"
      type="button"
      aria-label="关闭问问它"
      @click="onClose"
    ></button>
    <aside
      v-if="open"
      class="asset-qa-sheet"
      :class="{ 'is-open': open }"
      role="complementary"
      aria-label="问问它"
    >
    <header class="asset-qa-header">
      <div class="asset-qa-avatar" aria-hidden="true">
        <img v-if="asset" :src="asset.thumbnailUrl || asset.imageUrl" :alt="''" />
        <span v-else>?</span>
      </div>
      <div class="asset-qa-titles">
        <p class="asset-qa-eyebrow">问问它</p>
        <h2 class="asset-qa-name">{{ asset?.nameZh ?? '素材' }}</h2>
      </div>
      <button
        class="hand-icon-btn hand-icon-btn--close asset-qa-close"
        type="button"
        aria-label="关闭问问它"
        @click="onClose"
      >
        <img :src="handDrawnAssets.btnClose" alt="" />
      </button>
    </header>

    <p v-if="asset?.introZh" class="asset-qa-intro">{{ asset.introZh }}</p>

    <div
      class="asset-qa-voicebar"
      :class="{ 'is-live': isRecording, 'is-starting': isMicStarting && !isRecording }"
      :aria-live="(isRecording || isMicStarting) ? 'polite' : 'off'"
    >
      <span class="asset-qa-voicebar-dot" aria-hidden="true"></span>
      <span class="asset-qa-voicebar-text">{{ voiceBarText }}</span>
    </div>

    <div class="asset-qa-thread" role="log" aria-live="polite">
      <p v-if="snapshot.history.length === 0" class="asset-qa-empty">
        <span class="asset-qa-empty-title">{{ emptyTitleCopy }}</span>
      </p>
      <ul v-else class="asset-qa-messages">
        <li
          v-for="(message, index) in snapshot.history"
          :key="index"
          class="asset-qa-bubble"
          :class="message.role === 'user' ? 'qa-bubble-question is-user' : `is-${message.role}`"
        >
          <span class="asset-qa-bubble-text">{{ message.content }}</span>
        </li>
      </ul>
      <p v-if="isBusy" class="asset-qa-loading" role="status">
        <span class="asset-qa-loading-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
        {{ loadingCopy }}
      </p>
    </div>

    <p v-if="snapshot.errorMessage" class="asset-qa-error" role="alert">{{ snapshot.errorMessage }}</p>
    <p v-if="snapshot.micHint" class="asset-qa-mic-hint" role="status">{{ snapshot.micHint }}</p>

    <form
      class="asset-qa-form"
      @submit.prevent="sendTextQuestion"
    >
      <textarea
        :value="snapshot.input"
        class="asset-qa-input qa-input-field"
        rows="2"
        :maxlength="ASSET_QA_MAX_QUESTION"
        :placeholder="inputPlaceholder"
        :disabled="isBusy || isRecording || isAsrBusy || isMicStarting"
        aria-label="问问它的问题"
        @input="(event) => controller.setInput((event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <div class="asset-qa-actions">
        <button
          type="button"
          class="hand-btn-img asset-qa-voice"
          :class="{ 'is-live': isRecording, 'is-starting': isMicStarting && !isRecording }"
          :aria-pressed="isRecording"
          :disabled="isBusy || isAsrBusy || isMicStarting"
          :aria-label="voiceButtonAria"
          :title="voiceButtonAria"
          @click="toggleRecording"
        >
          <img :src="handDrawnAssets.btnVoice" alt="" />
          <span class="sr-only">{{ voiceButtonAria }}</span>
        </button>
        <button
          type="submit"
          class="hand-btn-img asset-qa-send"
          :disabled="!canSend"
          aria-label="发送"
        >
          <img :src="handDrawnAssets.btnSend" alt="" />
        </button>
      </div>
    </form>
    </aside>
  </Teleport>
</template>

<style scoped>
/* Visuals are aligned with the EditorPage wood/apricot design tokens. */
.asset-qa-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--ui-qa-sheet-z-index, 92);
  background: rgba(89, 71, 56, 0.18);
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
}

.asset-qa-sheet {
  position: fixed;
  z-index: calc(var(--ui-qa-sheet-z-index, 92) + 1);
  display: flex;
  flex-direction: column;
  color: var(--color-text, #594738);
  transform: translateX(0);
}

.asset-qa-header {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  align-items: center;
  gap: 12px;
}

.asset-qa-avatar {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md, 20px);
  background: #fffef8;
  border: 1px solid rgba(89, 71, 56, 0.18);
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 1.4rem;
  color: var(--color-text-soft, #8b7355);
  box-shadow: var(--shadow-soft, 0 2px 8px rgba(89, 71, 56, 0.08));
}

.asset-qa-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.asset-qa-titles { min-width: 0; }
.asset-qa-eyebrow {
  margin: 0;
  font-weight: 600;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-soft, #8b7355);
}
.asset-qa-name {
  margin: 2px 0 0;
  font-size: 1.15rem;
  font-weight: 650;
  color: var(--color-text, #594738);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-qa-close {
  justify-self: end;
}

.asset-qa-intro {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.5;
  padding: 8px 12px;
  border-radius: var(--radius-sm, 16px);
  background: rgba(255, 254, 248, 0.7);
  border: 1px dashed rgba(89, 71, 56, 0.18);
  color: var(--color-text-soft, #8b7355);
  font-style: italic;
}

.asset-qa-voicebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  font-size: 0.78rem;
  color: var(--color-text-soft, #8b7355);
}
.asset-qa-voicebar-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill, 999px);
  background: var(--wood-mid, #d9b98a);
  display: inline-block;
}
.asset-qa-voicebar.is-live .asset-qa-voicebar-dot {
  background: var(--color-primary, #e8a572);
  animation: asset-qa-pulse 1.2s ease-in-out infinite;
}
.asset-qa-voicebar.is-live { color: var(--color-text, #594738); }

@keyframes asset-qa-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.55; }
}

.asset-qa-thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 4px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: flex-start;
}

.asset-qa-empty {
  margin: 4px 0 0;
  padding: 12px 4px 0;
  text-align: left;
  color: var(--color-text-soft, #8b7355);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.92rem;
  line-height: 1.5;
}
.asset-qa-empty-title { color: var(--color-text, #594738); font-weight: 700; font-size: 1.02rem; }

.asset-qa-messages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asset-qa-bubble {
  max-width: 88%;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--color-text, #594738);
  word-break: break-word;
}

.asset-qa-bubble.is-assistant {
  align-self: flex-start;
  padding: 10px 14px;
  border-radius: var(--radius-md, 20px);
  border: 1px solid rgba(89, 71, 56, 0.12);
  background: #fffef8;
  box-shadow: var(--shadow-soft, 0 2px 8px rgba(89, 71, 56, 0.08));
  border-bottom-left-radius: var(--radius-xs, 14px);
}

.asset-qa-loading {
  margin: 4px 0 0;
  color: var(--color-text-soft, #8b7355);
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.asset-qa-loading-dots {
  display: inline-flex;
  gap: 3px;
}
.asset-qa-loading-dots span {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-text-soft, #8b7355);
  animation: asset-qa-bounce 1.1s ease-in-out infinite;
}
.asset-qa-loading-dots span:nth-child(2) { animation-delay: 0.15s; }
.asset-qa-loading-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes asset-qa-bounce {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  50% { transform: translateY(-3px); opacity: 1; }
}

.asset-qa-error,
.asset-qa-mic-hint {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-sm, 16px);
  font-size: 0.85rem;
  line-height: 1.4;
}
.asset-qa-error {
  background: rgba(244, 213, 192, 0.7);
  border: 1px solid rgba(168, 112, 76, 0.32);
  color: var(--wood-deeper, #7e6244);
}
.asset-qa-mic-hint {
  background: rgba(255, 254, 248, 0.78);
  border: 1px solid rgba(89, 71, 56, 0.14);
  color: var(--color-text-soft, #8b7355);
}

.asset-qa-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

.asset-qa-input {
  font-size: 0.95rem;
  line-height: 1.5;
}

.asset-qa-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}
</style>
