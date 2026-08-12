<script setup lang="ts">
/**
 * V4.6 阶段 4: 素材「问问它」侧拉面板
 *
 * UI 调度：所有状态在 AssetQaController 里管理，本组件只负责渲染 + 派发。
 *
 * - 文本问答：调用 aiClient.qaAsk，UI 中只展示 QaResult.answer（safetyAction 一律不显示）
 * - 语音输入：MediaRecorder → base64 → aiClient.asrTranscribe → 把 transcript 写入输入框
 *   **绝不自动 qaAsk**，必须由用户手动点发送
 * - 关闭 Sheet / 切换素材 / 卸载：controller.resetForClose() 丢弃任何未完成的响应
 * - 失败不写入半轮 history；输入内容保留
 * - 麦克风被拒/不可用：展示温和提示，文字问答继续可用
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AssetRecord } from '@shared/contracts'
import { aiClient } from '../../services/ai.client'
import {
  ASSET_QA_MAX_QUESTION,
  AssetQaController,
  type AssetQaSnapshot
} from './asset-qa.controller'

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

const canSend = computed(() => {
  if (snapshot.value.busy) return false
  const text = snapshot.value.input.trim()
  return text.length > 0 && text.length <= ASSET_QA_MAX_QUESTION
})

watch(
  () => props.asset?.assetId,
  (next, prev) => {
    if (prev !== undefined && prev !== next) {
      controller.resetForAssetSwitch()
      // Forcefully stop any in-flight recording tied to the previous asset.
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
  await controller.submitTextQuestion({
    assetId: props.asset.assetId,
    nameZh: props.asset.nameZh,
    introZh: props.asset.introZh,
    themeId: props.asset.themeId
  })
}

// --- Voice (MediaRecorder) helpers ---

let activeStream: MediaStream | null = null
let activeRecorder: MediaRecorder | null = null
let activeChunks: Blob[] = []

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
  if (snapshot.value.isRecording || snapshot.value.isAsrBusy) return
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    controller.failRecording('unavailable')
    return
  }
  controller.beginRecording()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    activeStream = stream
    const mimeType = pickRecorderMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    activeRecorder = recorder
    activeChunks = []
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) activeChunks.push(event.data)
    }
    recorder.onstop = () => {
      void finishRecording()
    }
    recorder.onerror = () => {
      controller.failRecording('unavailable')
      cleanupRecorder()
    }
    recorder.start()
    controller.startRecordingSucceeded()
  } catch (err) {
    cleanupRecorder()
    const name = (err as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      controller.failRecording('denied')
    } else {
      controller.failRecording('unavailable')
    }
  }
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

async function finishRecording(): Promise<void> {
  const streamAtStop = activeStream
  const chunks = activeChunks
  const recorder = activeRecorder
  cleanupRecorder()
  controller.beginTranscribing()
  if (!recorder || chunks.length === 0) {
    if (streamAtStop) stopStream(streamAtStop)
    controller.releaseMic()
    return
  }
  const mimeType = recorder.mimeType || 'audio/webm'
  const blob = new Blob(chunks, { type: mimeType })
  if (streamAtStop) stopStream(streamAtStop)
  try {
    const base64 = await blobToBase64(blob)
    // If user closed the sheet / switched asset during ASR, controller already
    // bumped its generation; the transcript result must not leak into a new
    // session. We still call the API for evidence, but discard the outcome.
    const result = await aiClient.asrTranscribe({ audioBase64: base64, mimeType })
    controller.applyTranscript(result.transcript)
  } catch {
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
  controller.releaseMic()
}

onBeforeUnmount(() => {
  releaseMicImmediate()
  controller.resetForClose()
})

function toggleRecording(): void {
  if (snapshot.value.busy) return
  if (snapshot.value.isRecording) stopRecording()
  else void startRecording()
}
</script>

<template>
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
    role="dialog"
    aria-label="问问它"
  >
    <header class="asset-qa-header">
      <div class="asset-qa-avatar" aria-hidden="true">
        <img v-if="asset" :src="asset.thumbnailUrl || asset.imageUrl" :alt="''" />
        <span v-else>?</span>
      </div>
      <div class="asset-qa-title">
        <p class="asset-qa-eyebrow">问问它</p>
        <h2>{{ asset?.nameZh ?? '素材' }}</h2>
      </div>
      <button
        class="asset-qa-close"
        type="button"
        aria-label="关闭问问它"
        @click="onClose"
      >×</button>
    </header>

    <p v-if="asset?.introZh" class="asset-qa-intro">{{ asset.introZh }}</p>

    <div class="asset-qa-thread" role="log" aria-live="polite">
      <p v-if="snapshot.history.length === 0" class="asset-qa-empty">
        想知道这个小物件的故事吗？用文字或者声音问它吧。
      </p>
      <ul v-else class="asset-qa-messages">
        <li
          v-for="(message, index) in snapshot.history"
          :key="index"
          class="asset-qa-bubble"
          :class="`is-${message.role}`"
        >
          <span class="asset-qa-bubble-text">{{ message.content }}</span>
        </li>
      </ul>
      <p v-if="snapshot.busy" class="asset-qa-loading" role="status">正在想…</p>
    </div>

    <p v-if="snapshot.errorMessage" class="asset-qa-error" role="alert">{{ snapshot.errorMessage }}</p>
    <p v-if="snapshot.micHint" class="asset-qa-mic-hint" role="status">{{ snapshot.micHint }}</p>

    <form
      class="asset-qa-form"
      @submit.prevent="sendTextQuestion"
    >
      <textarea
        :value="snapshot.input"
        class="asset-qa-input"
        rows="2"
        :maxlength="ASSET_QA_MAX_QUESTION"
        :placeholder="snapshot.isRecording ? '正在录音…' : '问它一个问题吧'"
        :disabled="snapshot.busy || snapshot.isAsrBusy"
        aria-label="问问它的问题"
        @input="(event) => controller.setInput((event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <div class="asset-qa-actions">
        <button
          type="button"
          class="asset-qa-voice"
          :class="{ 'is-recording': snapshot.isRecording }"
          :aria-pressed="snapshot.isRecording"
          :disabled="snapshot.busy || snapshot.isAsrBusy"
          :title="snapshot.isRecording ? '停止录音' : '说一说'"
          aria-label="说一说"
          @click="toggleRecording"
        >
          <span aria-hidden="true">{{ snapshot.isRecording ? '◉' : '🎤' }}</span>
          <span class="asset-qa-voice-label">{{ snapshot.isRecording ? '停止' : '说一说' }}</span>
        </button>
        <button
          type="submit"
          class="asset-qa-send"
          :disabled="!canSend"
          aria-label="发送"
        >
          发送
        </button>
      </div>
    </form>
  </aside>
</template>

<style scoped>
.asset-qa-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(22, 48, 43, 0.18);
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
}

.asset-qa-sheet {
  position: fixed;
  z-index: 61;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 92vw);
  background: var(--panel, #ffffff);
  border-left: 1px solid var(--line, #c5d5d0);
  box-shadow: -8px 0 24px rgba(89, 71, 56, 0.18);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 20px 16px;
  color: var(--ink, #16302b);
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
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
  border-radius: 16px;
  background: var(--paper, #eef4f2);
  border: 1px solid var(--line, #c5d5d0);
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 1.4rem;
  color: var(--muted, #4d6460);
}

.asset-qa-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.asset-qa-title h2 {
  margin: 2px 0 0;
  font-size: 1.2rem;
  color: var(--ink, #16302b);
}

.asset-qa-eyebrow {
  margin: 0;
  color: var(--accent, #1f6f63);
  font-weight: 600;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.asset-qa-close {
  appearance: none;
  border: 1px solid var(--line, #c5d5d0);
  background: #fff;
  color: var(--muted, #4d6460);
  border-radius: 999px;
  width: 32px;
  height: 32px;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.asset-qa-intro {
  margin: 0;
  color: var(--muted, #4d6460);
  font-size: 0.9rem;
  line-height: 1.5;
  padding: 8px 12px;
  background: var(--paper, #eef4f2);
  border-radius: 12px;
  border: 1px solid var(--line, #c5d5d0);
}

.asset-qa-thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0;
}

.asset-qa-empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  color: var(--muted, #4d6460);
  font-size: 0.95rem;
  line-height: 1.5;
}

.asset-qa-messages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asset-qa-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 18px;
  font-size: 0.95rem;
  line-height: 1.45;
  border: 1px solid var(--line, #c5d5d0);
  background: var(--paper, #eef4f2);
  color: var(--ink, #16302b);
  word-break: break-word;
}

.asset-qa-bubble.is-user {
  align-self: flex-end;
  background: var(--accent, #1f6f63);
  color: #fff;
  border-color: var(--accent, #1f6f63);
  border-bottom-right-radius: 6px;
}

.asset-qa-bubble.is-assistant {
  align-self: flex-start;
  border-bottom-left-radius: 6px;
}

.asset-qa-loading {
  margin: 8px 0 0;
  color: var(--muted, #4d6460);
  font-size: 0.9rem;
}

.asset-qa-error,
.asset-qa-mic-hint {
  margin: 0;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 0.85rem;
  line-height: 1.4;
}

.asset-qa-error {
  background: #fdecec;
  border: 1px solid #f3b3b3;
  color: var(--danger, #9b2c2c);
}

.asset-qa-mic-hint {
  background: var(--paper, #eef4f2);
  border: 1px solid var(--line, #c5d5d0);
  color: var(--muted, #4d6460);
}

.asset-qa-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line, #c5d5d0);
}

.asset-qa-input {
  width: 100%;
  border: 1px solid var(--line, #c5d5d0);
  border-radius: 12px;
  padding: 10px 12px;
  background: #fff;
  color: var(--ink, #16302b);
  font: inherit;
  resize: none;
  outline: none;
}

.asset-qa-input:focus {
  border-color: var(--accent, #1f6f63);
  box-shadow: 0 0 0 3px rgba(31, 111, 99, 0.18);
}

.asset-qa-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.asset-qa-voice,
.asset-qa-send {
  appearance: none;
  font: inherit;
  border-radius: 999px;
  padding: 8px 16px;
  cursor: pointer;
  border: 1px solid var(--line, #c5d5d0);
  background: #fff;
  color: var(--ink, #16302b);
}

.asset-qa-voice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
}

.asset-qa-voice.is-recording {
  background: var(--danger, #9b2c2c);
  border-color: var(--danger, #9b2c2c);
  color: #fff;
}

.asset-qa-voice:disabled,
.asset-qa-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.asset-qa-send {
  background: var(--accent, #1f6f63);
  border-color: var(--accent, #1f6f63);
  color: #fff;
  padding: 8px 20px;
  font-weight: 600;
}

.asset-qa-send:disabled {
  background: var(--muted, #4d6460);
  border-color: var(--muted, #4d6460);
}
</style>
