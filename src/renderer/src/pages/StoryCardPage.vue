<script setup lang="ts">
import { computed, onUnmounted, ref, watch, type CSSProperties } from 'vue'
import { conciseCopy } from '../ui/concise-copy'
import { continueStoryToExplode } from '../app-nav'
import type {
  ResourceRef,
  StoryCard,
  StoryCardDraft,
  StoryCardWorkContext,
  TemporaryFullRecordingInput,
  TemporaryPartialSupplementInput
} from '@shared/contracts'
import { StoryCardStore, getFeltCraftDatabase } from '../persistence'
import { PersistenceError } from '../persistence/errors'
import { confirmStoryCard } from '../story-card/story-card-confirmation.service'
import { getStoryCardDetail } from '../story-card/story-card-detail.service'
import { prepareStoryCardEditing } from '../story-card/story-card-editing.service'
import { decideStoryCardContentUpdate, type StoryCardContentUpdateChoice } from '../story-card/story-card-content-update-decision.service'
import { syncStoryCardArtworkImage } from '../story-card/story-card-artwork-sync.service'
import { processFullRerecording } from '../story-card/full-rerecording-flow.service'
import { confirmPartialSupplement, processPartialSupplement } from '../story-card/partial-supplement-flow.service'
import { adaptPartialSupplementInput } from '../story-card/partial-supplement-input.adapter'
import {
  confirmTemporaryFullStoryCardRecording,
  deleteTemporaryStoryCardRecording,
  saveTemporaryFullRecording
} from '../story-card/temporary-recording-bridge'
import { GatewaySpeechRecognitionAdapter } from '../story-card/speech-recognition.adapter'
import { GatewayStoryRewriteAdapter } from '../story-card/story-rewrite.adapter'
import { StoryProcessingService } from '../story-card/story-processing.service'
import { MAX_RECORDING_DURATION_MS, RecordingSession, type RecordingSessionState } from '../story-card/recording-session.service'
import { microphoneFailureMessage } from '../services/voice-input'

const props = defineProps<{ workContext?: StoryCardWorkContext }>()
const emit = defineEmits<{ back: []; saved: [card: StoryCard] }>()
const files = import.meta.glob('../assets/story-card/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const store = new StoryCardStore(getFeltCraftDatabase())

type Phase = 'intro' | 'recording' | 'supplement' | 'processing' | 'insufficient' | 'review' | 'detail' | 'update-choice'
type Purpose = 'initial' | 'full-update' | 'partial-update'
type Layer = { file: string; order: number }

const phase = ref<Phase>('intro')
const purpose = ref<Purpose>('initial')
const recordingState = ref<RecordingSessionState>('not_started')
const durationMs = ref(0)
const fullRecording = ref<TemporaryFullRecordingInput>()
const partialRecording = ref<TemporaryPartialSupplementInput>()
const supplementText = ref('')
const draft = ref<StoryCardDraft>()
const editTitle = ref('')
const editText = ref('')
const confirmedCard = ref<StoryCard>()
const busy = ref(false)
const errorMessage = ref('')
const speechFailed = ref(false)
const recognizing = ref(false)
const notice = ref('')
const confirmLeave = ref(false)
const audioElement = ref<HTMLAudioElement>()
const audioCurrent = ref(0)
const audioDuration = ref(0)
const audioPlaying = ref(false)

let session = new RecordingSession()
let recorder: MediaRecorder | undefined
let stream: MediaStream | undefined
let chunks: Blob[] = []
let activeStartedAt: number | undefined
let durationTimer: ReturnType<typeof setInterval> | undefined
let limitTimer: ReturnType<typeof setTimeout> | undefined

function realApi() {
  const api = window.electronAPI
  if (!api?.readTemporaryStoryCardAudio || !api.ai?.asrTranscribe || !api.ai?.storyRewrite) {
    throw new Error('故事服务暂时不可用，请稍后再试。')
  }
  return api
}

const speech = new GatewaySpeechRecognitionAdapter(
  { readTemporaryStoryCardAudio: (audioRef) => realApi().readTemporaryStoryCardAudio(audioRef) },
  { asrTranscribe: (input) => realApi().ai.asrTranscribe(input) }
)
const processor = new StoryProcessingService(
  speech,
  new GatewayStoryRewriteAdapter({ storyRewrite: (input) => realApi().ai.storyRewrite(input) })
)

const layers = computed<Layer[]>(() => {
  const result: Layer[] = [{ file: '大背景（放在最底层）.png', order: 0 }]
  if (phase.value === 'intro' || phase.value === 'recording') {
    if (phase.value === 'intro' || recordingState.value === 'not_started') {
      result.push({ file: '讲述你的故事吧01.png', order: 1 })
      result.push({ file: '开始录音02.png', order: 2 })
    }
  } else if (phase.value === 'supplement' || phase.value === 'processing' || phase.value === 'insufficient') {
    result.push({ file: '还有什么要补充的嘛07.png', order: 7 })
    result.push({ file: '文本框08.png', order: 8 })
  } else if (phase.value === 'review') {
    if (fullRecording.value || confirmedCard.value) result.push({ file: '播放音频按钮06.png', order: 6 })
    result.push(
      { file: '请确认故事10.png', order: 10 },
      { file: '标题输入框11.png', order: 11 },
      { file: '正文输入框12.png', order: 12 },
      { file: '确认13.png', order: 13 }
    )
  } else {
    result.push(
      { file: '背景01.png', order: 1 },
      { file: '画展示框02.png', order: 2 }
    )
    if (phase.value === 'detail') {
      result.push(
        { file: '名称框03.png', order: 3 },
        { file: '内容文本框04.png', order: 4 },
        { file: '日期框05.png', order: 5 },
        { file: '播放音频按钮06.png', order: 6 },
        { file: '保存按钮07.png', order: 7 }
      )
    }
  }
  result.push(
    { file: '背景边框（放在第二高的顶层）.png', order: 90 },
    { file: '返回键（放在最顶层）.png', order: 100 }
  )
  return result.sort((a, b) => a.order - b.order)
})

const currentAudioRef = computed<ResourceRef | undefined>(() => {
  if (phase.value === 'detail') return confirmedCard.value?.originalAudioRef
  if (purpose.value === 'partial-update') return confirmedCard.value?.originalAudioRef
  return fullRecording.value?.audioRef
})
const artworkRef = computed(() => confirmedCard.value?.artworkImageRef ?? props.workContext?.artworkImageRef)
const dateLabel = computed(() => confirmedCard.value
  ? new Date(confirmedCard.value.confirmedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  : '')
const durationLabel = computed(() => formatTime(durationMs.value / 1000))
const audioLabel = computed(() => formatTime(audioCurrent.value) + ' / ' + formatTime(audioDuration.value))

function imageFor(file: string): string {
  return files['../assets/story-card/' + file] ?? ''
}

function box(x: number, y: number, width: number, height: number, order: number): CSSProperties {
  return {
    left: (x / 1920 * 100) + '%',
    top: (y / 1080 * 100) + '%',
    width: (width / 1920 * 100) + '%',
    height: (height / 1080 * 100) + '%',
    zIndex: Math.round(order * 10)
  }
}

function formatTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0')
}

function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return '故事卡暂时没有完成，请重试。'
}

async function loadCard(context?: StoryCardWorkContext): Promise<void> {
  if (!context) {
    errorMessage.value = '请从已完成的作品进入故事卡。'
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const stored = await store.getByWorkId(context.workId)
    if (!stored) {
      phase.value = 'intro'
      return
    }
    if (stored.artworkImageRef !== context.artworkImageRef) {
      await syncStoryCardArtworkImage(context, store)
      phase.value = 'update-choice'
    } else {
      phase.value = 'detail'
    }
    confirmedCard.value = await getStoryCardDetail(context.workId, store)
  } catch (error) {
    if (error instanceof PersistenceError && error.shared.code === 'STORY_CARD_NOT_FOUND') phase.value = 'intro'
    else errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

watch(() => props.workContext, (context) => { void loadCard(context) }, { immediate: true })
watch(currentAudioRef, () => resetAudio())

function clearTimers(): void {
  if (durationTimer) clearInterval(durationTimer)
  if (limitTimer) clearTimeout(limitTimer)
  durationTimer = undefined
  limitTimer = undefined
}

function releaseStream(): void {
  stream?.getTracks().forEach((track) => track.stop())
  stream = undefined
  recorder = undefined
  chunks = []
}

function previewDuration(): void {
  if (activeStartedAt === undefined) return
  durationMs.value = Math.min(MAX_RECORDING_DURATION_MS, session.durationMs + Math.max(Date.now() - activeStartedAt, 0))
}

function commitDuration(): boolean {
  if (activeStartedAt === undefined) return false
  const elapsed = Math.max(Date.now() - activeStartedAt, 0)
  activeStartedAt = undefined
  const progress = session.addRecordedDuration(elapsed)
  durationMs.value = progress.durationMs
  recordingState.value = session.state
  return progress.status === 'limit_reached'
}

function startTimers(): void {
  clearTimers()
  durationTimer = setInterval(previewDuration, 250)
  limitTimer = setTimeout(() => { void finishRecording() }, Math.max(MAX_RECORDING_DURATION_MS - session.durationMs, 0))
}

function beginRecorder(nextStream: MediaStream): void {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  stream = nextStream
  chunks = []
  recorder = new MediaRecorder(stream, { mimeType })
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data)
  })
  recorder.start()
}

function stopRecorder(): Promise<Blob> {
  const active = recorder
  if (!active || active.state === 'inactive') throw new Error('当前没有正在录制的故事。')
  return new Promise((resolve, reject) => {
    active.addEventListener('stop', () => resolve(new Blob(chunks, { type: active.mimeType || 'audio/webm' })), { once: true })
    active.addEventListener('error', () => reject(new Error('录音暂时没有完成，请重试。')), { once: true })
    active.stop()
  })
}

async function startRecording(replace = false): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  speechFailed.value = false
  let microphone: MediaStream | undefined
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('当前设备暂时不能使用麦克风。')
    }
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      throw new Error(microphoneFailureMessage(error))
    }
    if (replace && recorder && recorder.state !== 'inactive') {
      clearTimers()
      await stopRecorder()
    }
    if (replace) releaseStream()
    session.dispatch(replace ? 'rerecord' : 'start')
    recordingState.value = session.state
    if (replace) {
      durationMs.value = 0
      supplementText.value = ''
      draft.value = undefined
    }
    beginRecorder(microphone)
    microphone = undefined
    activeStartedAt = Date.now()
    startTimers()
    phase.value = 'recording'
    notice.value = ''
  } catch (error) {
    microphone?.getTracks().forEach((track) => track.stop())
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

function pauseRecording(): void {
  if (busy.value) return
  try {
    clearTimers()
    recorder?.pause()
    if (commitDuration()) {
      void finishRecording()
      return
    }
    session.dispatch('pause')
    recordingState.value = session.state
  } catch (error) {
    errorMessage.value = messageFor(error)
  }
}

function resumeRecording(): void {
  if (busy.value) return
  try {
    recorder?.resume()
    session.dispatch('resume')
    recordingState.value = session.state
    activeStartedAt = Date.now()
    startTimers()
  } catch (error) {
    errorMessage.value = messageFor(error)
  }
}

async function finishRecording(): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    clearTimers()
    const limitReached = commitDuration()
    if (!limitReached && session.state !== 'ended') session.dispatch('end')
    recordingState.value = session.state
    const blob = await stopRecorder()
    const audioRef = await saveTemporaryFullRecording(blob)
    const recorded: TemporaryFullRecordingInput = {
      workId: props.workContext!.workId,
      kind: purpose.value === 'full-update' ? 'full_rerecording' : 'initial_full_recording',
      audioRef,
      durationMs: durationMs.value
    }
    if (purpose.value === 'partial-update') {
      const partial = adaptPartialSupplementInput({ workId: recorded.workId, audioRef, durationMs: recorded.durationMs })
      if (!partial.ok) throw new Error(partial.error.message)
      const previous = partialRecording.value?.audioRef
      partialRecording.value = partial.request
      if (previous) await deleteTemporaryStoryCardRecording(previous)
    } else {
      const previous = fullRecording.value?.audioRef
      fullRecording.value = recorded
      if (previous) await deleteTemporaryStoryCardRecording(previous)
    }
    releaseStream()
    phase.value = 'supplement'
    await prepareRecordingText(purpose.value === 'partial-update' ? partialRecording.value! : recorded)
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

/** Recognition populates the existing editable box once. It is never a hidden submit source. */
async function prepareRecordingText(recording: TemporaryFullRecordingInput | TemporaryPartialSupplementInput): Promise<void> {
  recognizing.value = true
  notice.value = '正在识别录音…'
  supplementText.value = purpose.value === 'partial-update' ? confirmedCard.value?.storyText ?? '' : ''
  try {
    const recognized = await speech.transcribe(recording)
    if (!recognized.ok) {
      speechFailed.value = true
      errorMessage.value = recognized.error.message
      return
    }
    supplementText.value = [supplementText.value, recognized.transcript.text].filter(text => text.trim()).join('\n')
    speechFailed.value = false
  } catch (error) {
    speechFailed.value = true
    errorMessage.value = messageFor(error)
  } finally {
    recognizing.value = false
    notice.value = ''
  }
}

async function processStory(): Promise<void> {
  const context = props.workContext
  if (!context || busy.value) return
  const returnPhase = phase.value === 'insufficient' ? 'insufficient' : 'supplement'
  busy.value = true
  phase.value = 'processing'
  errorMessage.value = ''
  try {
    if (!supplementText.value.trim()) throw new Error('请先输入完整的故事内容。')
    let result: StoryCardDraft
    if (purpose.value === 'partial-update') {
      const partial = partialRecording.value
      const current = confirmedCard.value
      if (!partial || !current) throw new Error('请先完成补录。')
      result = await processPartialSupplement(
        { supplement: partial, context },
        store,
        {
          process: async () => {
            return processor.processTranscript({
              workId: context.workId,
              text: supplementText.value.trim(),
              context
            })
          }
        }
      )
    } else {
      const full = fullRecording.value
      if (!full) throw new Error('请先完成一段录音。')
      result = purpose.value === 'full-update'
        ? await processFullRerecording(
          { recording: full, context },
          store,
          { process: () => processor.processTranscript({ workId: context.workId, text: supplementText.value.trim(), context }) }
        )
        : await processor.processTranscript({ workId: context.workId, text: supplementText.value.trim(), context })
    }
    showDraft(result)
    if (phase.value === 'processing') phase.value = returnPhase
  } catch (error) {
    phase.value = returnPhase
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

function showDraft(result: StoryCardDraft): void {
  draft.value = result
  if (result.status === 'ready_for_review') {
    const editing = prepareStoryCardEditing(result)
    if (!editing.ok) {
      errorMessage.value = editing.error.message
      return
    }
    editTitle.value = editing.payload.title
    editText.value = editing.payload.storyText
    phase.value = 'review'
  } else if (result.status === 'needs_more_input') {
    phase.value = 'insufficient'
    errorMessage.value = '请补充一点故事内容后再试。'
  } else if (result.status === 'failed') {
    errorMessage.value = result.error.message
  }
}

async function confirmCandidate(): Promise<void> {
  const context = props.workContext
  if (!context || draft.value?.status !== 'ready_for_review' || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const editPayload = { workId: context.workId, title: editTitle.value, storyText: editText.value }
    const confirmedAt = new Date().toISOString()
    if (purpose.value === 'partial-update') {
      if (!partialRecording.value) throw new Error('补录内容暂时找不到，请重试。')
      await confirmPartialSupplement({ editPayload, workContext: context, confirmedAt, supplement: partialRecording.value }, store)
      await deleteTemporaryStoryCardRecording(partialRecording.value.audioRef)
      partialRecording.value = undefined
    } else {
      if (!fullRecording.value) throw new Error('完整录音暂时找不到，请重试。')
      await confirmStoryCard(
        { editPayload, workContext: context, confirmedAt, recording: fullRecording.value },
        store,
        { promoteTemporaryFullRecording: confirmTemporaryFullStoryCardRecording }
      )
      fullRecording.value = undefined
    }
    confirmedCard.value = await getStoryCardDetail(context.workId, store)
    phase.value = 'detail'
    draft.value = undefined
    notice.value = '故事卡已保存。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

function chooseUpdate(choice: StoryCardContentUpdateChoice): void {
  const context = props.workContext
  if (!context || !confirmedCard.value) return
  const action = decideStoryCardContentUpdate(context.workId, choice)
  if (action.type === 'keep_current_story') {
    phase.value = 'detail'
    return
  }
  purpose.value = action.type === 'start_full_rerecording' ? 'full-update' : 'partial-update'
  session = new RecordingSession()
  recordingState.value = session.state
  durationMs.value = 0
  supplementText.value = ''
  speechFailed.value = false
  fullRecording.value = undefined
  partialRecording.value = undefined
  draft.value = undefined
  phase.value = 'recording'
}

function resetAudio(): void {
  audioElement.value?.pause()
  audioCurrent.value = 0
  audioDuration.value = 0
  audioPlaying.value = false
}

async function toggleAudio(): Promise<void> {
  const audio = audioElement.value
  if (!audio) return
  try {
    if (audio.paused) await audio.play()
    else audio.pause()
  } catch {
    errorMessage.value = '这段录音暂时无法播放，请重试。'
  }
}

function seekAudio(event: Event): void {
  const audio = audioElement.value
  if (!audio) return
  const value = Number((event.target as HTMLInputElement).value)
  audio.currentTime = Math.min(Math.max(value, 0), audioDuration.value)
  audioCurrent.value = audio.currentTime
}

function saveFeedback(): void {
  if (!confirmedCard.value) return
  notice.value = '故事卡已保存。'
  emit('saved', confirmedCard.value)
}

async function nextToExplode(): Promise<void> {
  if (busy.value || phase.value !== 'detail' || !confirmedCard.value || !props.workContext) return
  busy.value = true
  errorMessage.value = ''
  try {
    await continueStoryToExplode(props.workContext.workId)
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally { busy.value = false }
}

function requestBack(): void {
  if (busy.value || phase.value === 'processing') {
    notice.value = '正在处理，请稍后返回。'
    return
  }
  if (fullRecording.value || partialRecording.value || phase.value === 'recording' || phase.value === 'review' || phase.value === 'supplement') {
    confirmLeave.value = true
    return
  }
  emit('back')
}

onUnmounted(() => {
  clearTimers()
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  releaseStream()
  resetAudio()
  const cleanup = (audioRef: string) => void deleteTemporaryStoryCardRecording(audioRef)
    .catch(error => console.warn('故事卡临时录音清理失败，已保存的故事与原音频不受影响。', error))
  if (fullRecording.value) cleanup(fullRecording.value.audioRef)
  if (partialRecording.value) cleanup(partialRecording.value.audioRef)
})
</script>

<template>
  <section class="story-card-page art-scrollbars" aria-label="作品故事卡">
    <div v-if="confirmLeave" class="leave-shade" role="dialog" aria-modal="true" aria-label="离开故事编辑">
      <div><p>这次未确认的录音和故事草稿不会保存。已保存的作品和故事卡不受影响。</p>
        <button autofocus @click="confirmLeave = false">继续编辑</button>
        <button @click="emit('back')">放弃本次编辑并返回</button>
      </div>
    </div>
    <div class="story-stage">
      <img
        v-for="layer in layers"
        :key="layer.file"
        class="layer"
        :src="imageFor(layer.file)"
        :style="{ zIndex: layer.order }"
        alt=""
        draggable="false"
      />

      <img v-if="(phase === 'detail' || phase === 'update-choice') && artworkRef" class="placed-artwork" :src="artworkRef" :style="box(317, 184, 765, 610, 2.2)" alt="当前作品画面" />

      <button class="hotspot" :style="box(40, 34, 205, 114, 101)" aria-label="返回" @click="requestBack" />
      <button v-if="phase === 'intro' || (phase === 'recording' && recordingState === 'not_started')" class="hotspot" :style="box(768, 565, 385, 142, 2.2)" aria-label="开始录音" :disabled="busy || !workContext" @click="startRecording(false)" />
      <template v-if="phase === 'recording' && recordingState !== 'not_started'">
        <div class="recording-panel" :style="box(445, 272, 1030, 536, 1)">
          <span class="recording-title">讲述你的故事吧：</span>
        </div>
        <div class="recording-status" :style="box(610, 455, 700, 58, 2.5)" role="status">
          {{ recordingState === 'paused' ? '录音已暂停' : recordingState === 'ended' ? '录音已结束' : '正在录音' }} · {{ durationLabel }} / 5:00
        </div>
        <button v-if="recordingState === 'recording' || recordingState === 'rerecording'" class="recording-action" :style="box(520, 540, 230, 220, 3.2)" aria-label="暂停录音" :disabled="busy" @click="pauseRecording"><span>暂停<br />录音</span></button>
        <button v-if="recordingState === 'paused'" class="recording-action" :style="box(520, 540, 230, 220, 6.2)" aria-label="继续录音" :disabled="busy" @click="resumeRecording"><span>继续<br />录音</span></button>
        <button v-if="recordingState !== 'ended'" class="recording-action" :style="box(845, 540, 230, 220, 4.2)" aria-label="完成录音" :disabled="busy" @click="finishRecording"><span>完成<br />录音</span></button>
        <button class="recording-action" :style="box(recordingState === 'ended' ? 845 : 1170, 540, 230, 220, 5.2)" aria-label="重新录音" :disabled="busy" @click="startRecording(true)"><span>重新<br />录音</span></button>
      </template>

      <template v-if="phase === 'supplement' || phase === 'processing' || phase === 'insufficient'">
        <textarea
          v-model="supplementText"
          class="layer-input supplement-input"
          :style="box(610, 465, 670, 190, 8.2)"
          placeholder="在这里修改或补充故事内容"
          aria-label="故事补充内容"
          :disabled="busy"
        />
        <button class="added-button supplement-rerecord" :style="box(620, 704, 300, 82, 9.2)" :disabled="busy" @click="startRecording(true)">
          重新录音
        </button>
        <button class="added-button supplement-submit" :style="box(980, 704, 300, 82, 9.2)" :disabled="busy || (speechFailed && !supplementText.trim())" @click="processStory()">
          {{ busy ? (recognizing ? '正在识别…' : '正在生成…') : speechFailed ? '仅用文字生成' : '生成故事' }}
        </button>
        <p v-if="speechFailed" class="feedback" :style="box(940, 800, 390, 100, 9.2)">识别未完成，请输入完整故事。录音仍保留。</p>
      </template>

      <template v-if="phase === 'review'">
        <input v-model="editTitle" class="layer-input title-input" :style="box(720, 425, 530, 62, 11.2)" aria-label="故事标题" :disabled="busy" />
        <textarea v-model="editText" class="layer-input body-input" :style="box(720, 530, 530, 235, 12.2)" aria-label="故事正文" :disabled="busy" />
        <button class="hotspot" :style="box(1290, 625, 80, 160, 13.2)" aria-label="确认故事" :disabled="busy" @click="confirmCandidate" />
      </template>

      <template v-if="phase === 'detail' && confirmedCard">
        <button class="added-button" :style="box(1190, 100, 390, 70, 8)" @click="phase = 'update-choice'">修改故事内容</button>
        <h2 class="detail-title" :style="box(1220, 188, 335, 90, 3.2)">{{ confirmedCard.title }}</h2>
        <p class="detail-story" :style="box(1210, 333, 360, 455, 4.2)" tabindex="0">{{ confirmedCard.storyText }}</p>
        <time class="detail-date" :style="box(770, 867, 320, 45, 5.2)">{{ dateLabel }}</time>
        <button class="hotspot" :style="box(1735, 422, 130, 225, 7.2)" aria-label="保存故事卡" @click="saveFeedback" />
        <button class="added-button" :style="box(1660, 820, 200, 82, 101)" :disabled="busy" aria-label="下一步：爆炸图" @click="nextToExplode">下一步</button>
      </template>

      <div v-if="phase === 'update-choice'" class="update-panel" :style="box(1120, 235, 490, 560, 8.5)">
        <h2>更新故事内容</h2>
        <p>更新画面不会改写故事。</p>
        <button class="added-button" @click="chooseUpdate('keep_current_story')">保持当前故事</button>
        <button class="added-button" @click="chooseUpdate('full_rerecording')">重新录完整故事</button>
        <button class="added-button" @click="chooseUpdate('partial_supplement')">补录修改内容</button>
      </div>

      <template v-if="currentAudioRef && (phase === 'review' || phase === 'detail')">
        <audio
          ref="audioElement"
          :src="currentAudioRef"
          preload="metadata"
          @loadedmetadata="audioDuration = Number.isFinite(($event.target as HTMLAudioElement).duration) ? ($event.target as HTMLAudioElement).duration : 0"
          @timeupdate="audioCurrent = ($event.target as HTMLAudioElement).currentTime"
          @play="audioPlaying = true"
          @pause="audioPlaying = false"
          @ended="audioPlaying = false"
          @error="errorMessage = '这段录音暂时无法播放，请重试。'"
        />
        <button class="hotspot" :style="box(1197, 843, 108, 100, 6.2)" :aria-label="audioPlaying ? '暂停播放' : '播放录音'" @click="toggleAudio" />
        <div class="audio-progress" :style="box(1310, 850, 300, 90, 6.2)">
          <span>{{ audioLabel }}</span>
          <input type="range" min="0" :max="audioDuration" step="0.1" :value="audioCurrent" :disabled="audioDuration <= 0" aria-label="播放进度" @input="seekAudio" />
        </div>
      </template>

      <div v-if="errorMessage" class="feedback error" :style="box(430, 953, 1060, 65, 20)" role="alert">{{ conciseCopy(errorMessage) }}</div>
      <div v-else-if="phase === 'processing'" class="feedback" :style="box(430, 953, 1060, 65, 20)" role="status">正在整理故事…</div>
      <div v-else-if="notice" class="feedback" :style="box(430, 953, 1060, 65, 20)" role="status">{{ notice }}</div>
    </div>
  </section>
</template>

<style scoped>
.leave-shade { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; background: #0008; }
.leave-shade > div { max-width: 480px; padding: 24px; background: #fff1b7; border: 3px solid #591608; border-radius: 20px; }
.leave-shade button { margin: 6px; }
.story-card-page {
  display: grid;
  place-items: center;
  width: 100vw;
  min-height: 100vh;
  overflow: hidden;
  background: #fff1b7;
  color: #591608;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}
.story-stage {
  position: relative;
  width: min(100vw, 177.7778vh);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  container-type: inline-size;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}
.hotspot, .layer-input, .placed-artwork, .recording-panel, .recording-action, .recording-status,
.detail-title, .detail-story, .detail-date, .audio-progress,
.update-panel, .feedback, .added-button {
  position: absolute;
}
.recording-panel {
  box-sizing: border-box;
  border: 0.45cqw solid #63180d;
  border-radius: 3cqw;
  background: #dbb24a;
}
.recording-title {
  position: absolute;
  top: 16%;
  left: 0;
  width: 100%;
  color: #63180d;
  font-size: 4.1cqw;
  font-weight: 900;
  line-height: 1.1;
  text-align: center;
  white-space: nowrap;
}
.recording-status {
  color: #63180d;
  font-size: 1.8cqw;
  font-weight: 700;
  text-align: center;
}
.recording-action {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 0;
  border: 0.45cqw solid #63180d;
  border-radius: 1.5cqw;
  background: #fff1b6;
  color: #63180d;
  font: 900 2.9cqw/1.18 "Microsoft YaHei", "PingFang SC", sans-serif;
  text-align: center;
  cursor: pointer;
}
.recording-action:disabled { cursor: default; }
.recording-action:focus-visible { outline: 4px solid #63180d; outline-offset: 3px; }
.hotspot {
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.hotspot:focus-visible, .added-button:focus-visible, .layer-input:focus-visible {
  outline: 4px solid #5a1709;
  outline-offset: 3px;
}
.hotspot:disabled { cursor: default; }
.placed-artwork { object-fit: contain; }
.layer-input {
  padding: 0.35em 0.5em;
  border: 0;
  background: transparent;
  color: #591608;
  font: inherit;
  resize: none;
}
.supplement-input { font-size: clamp(12px, 2vw, 31px); }
.title-input { font-size: clamp(12px, 2.2vw, 36px); font-weight: 700; }
.body-input { font-size: clamp(12px, 1.65vw, 27px); line-height: 1.5; }
.added-button {
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent url('../../../../assets/ui/hand-drawn/btn-primary.png') center / 100% 100% no-repeat;
  color: #5a1709;
  font: 700 clamp(11px, 1.5vw, 25px) "Microsoft YaHei", sans-serif;
  cursor: pointer;
  padding: 0.2em 0.5em;
}
.added-button:disabled { opacity: 0.55; cursor: default; }
.detail-title, .detail-story, .detail-date { margin: 0; text-align: center; }
.detail-title { display: grid; place-items: center; overflow: hidden; font-size: clamp(13px, 2vw, 32px); }
.detail-story { overflow-y: auto; white-space: pre-wrap; text-align: left; font-size: clamp(12px, 1.5vw, 24px); line-height: 1.55; }
.detail-date { font-size: clamp(11px, 1.5vw, 24px); }
.audio-progress { display: grid; gap: 2px; align-content: center; font-size: clamp(10px, 1.2vw, 18px); }
.audio-progress input { appearance: none; width: 100%; height: 24px; padding: 0; margin: 0; background: transparent; cursor: pointer; }
.audio-progress input::-webkit-slider-runnable-track { height: 5px; border-radius: 8px; background: rgba(90,23,9,.3); }
.audio-progress input::-webkit-slider-thumb { appearance: none; width: 15px; height: 15px; margin-top: -5px; border-radius: 50%; background: #71351c; border: 2px solid #fff1b7; }
.audio-progress input:focus-visible { outline: 2px solid #71351c; outline-offset: 3px; }
.audio-progress input:disabled { opacity: .5; cursor: default; }
.update-panel { display: flex; flex-direction: column; justify-content: center; gap: 3%; text-align: center; font-size: clamp(13px, 1.7vw, 27px); }
.update-panel .added-button { position: static; min-height: 15%; }
.feedback { display: grid; place-items: center; border-radius: 14px; background: #fff0b5; font-size: clamp(11px, 1.4vw, 22px); font-weight: 700; }
.feedback.error { color: #a42313; }
</style>
