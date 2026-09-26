<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  ResourceRef,
  StoryCard,
  StoryCardDraft,
  StoryCardManualTextInputRequest,
  StoryCardWorkContext,
  TemporaryFullRecordingInput
} from '@shared/contracts'
import {
  STORY_CARD_TEST_UPDATED_WORK_CONTEXT,
  STORY_CARD_TEST_WORK_CONTEXT
} from '../story-card/story-card-test-fixtures'
import {
  StoryCardTestRecordingFlow,
  manualTextRequestSummary
} from '../story-card/story-card-test-recording-flow.service'
import {
  STORY_CARD_TEST_INSUFFICIENT_TEXT,
  STORY_CARD_TEST_READY_TEXT,
  createStoryCardTestProcessor,
  processTestRuleExample,
  type StoryCardTestRuleExampleId,
  processTestManualTextWithFullRecording
} from '../story-card/story-card-test-processing-flow.service'
import {
  createTestFullRerecordingInput,
  createTestPartialSupplementInput
} from '../story-card/story-card-test-processing-flow.service'
import { getFeltCraftDatabase, StoryCardStore } from '../persistence'
import { confirmStoryCard } from '../story-card/story-card-confirmation.service'
import { getStoryCardDetail } from '../story-card/story-card-detail.service'
import { prepareStoryCardEditing } from '../story-card/story-card-editing.service'
import { processFullRerecording } from '../story-card/full-rerecording-flow.service'
import { confirmPartialSupplement, processPartialSupplement } from '../story-card/partial-supplement-flow.service'
import {
  decideStoryCardContentUpdate,
  type StoryCardContentUpdateChoice
} from '../story-card/story-card-content-update-decision.service'
import { syncStoryCardArtworkImage } from '../story-card/story-card-artwork-sync.service'
import {
  confirmTemporaryFullStoryCardRecording,
  deleteTemporaryStoryCardRecording,
  saveTemporaryFullRecording
} from '../story-card/temporary-recording-bridge'
import { formatStoryCardAudioTime } from '../story-card/story-card-test-audio-player.service'
import { GatewaySpeechRecognitionAdapter } from '../story-card/speech-recognition.adapter'
import { GatewayStoryRewriteAdapter } from '../story-card/story-rewrite.adapter'
import { StoryProcessingService } from '../story-card/story-processing.service'
import { MAX_RECORDING_DURATION_MS } from '../story-card/recording-session.service'

const props = defineProps<{ workContext?: StoryCardWorkContext }>()
const workContext = props.workContext ?? STORY_CARD_TEST_WORK_CONTEXT
const updatedWorkContext = props.workContext ? workContext : STORY_CARD_TEST_UPDATED_WORK_CONTEXT

const entered = ref(false)
const recordingFlow = new StoryCardTestRecordingFlow(workContext.workId)
const storyProcessor = createStoryCardTestProcessor(workContext)
const realSpeechRecognition = new GatewaySpeechRecognitionAdapter(
  {
    readTemporaryStoryCardAudio: async (audioRef) => requireRealStoryCardApi().readTemporaryStoryCardAudio(audioRef)
  },
  {
    asrTranscribe: async (input) => requireRealStoryCardApi().ai.asrTranscribe(input)
  }
)
const realStoryRewrite = new GatewayStoryRewriteAdapter({
  storyRewrite: async (input) => requireRealStoryCardApi().ai.storyRewrite(input)
})
const realStoryProcessor = new StoryProcessingService(
  realSpeechRecognition,
  realStoryRewrite
)
const storyCardStore = new StoryCardStore(getFeltCraftDatabase())
const recordingState = ref(recordingFlow.state)
const durationMs = ref(0)
const fullRecording = ref<TemporaryFullRecordingInput>()
const realFullTranscript = ref<{ audioRef: ResourceRef; text: string }>()
const manualText = ref('')
const pendingManualTextRequest = ref<StoryCardManualTextInputRequest>()
const storyDraft = ref<StoryCardDraft>()
const supplementText = ref(STORY_CARD_TEST_READY_TEXT)
const editingTitle = ref('')
const editingStoryText = ref('')
const confirmedCard = ref<StoryCard>()
const statusMessage = ref('')
const errorMessage = ref('')
const busy = ref(false)
const audioElement = ref<HTMLAudioElement>()
const currentAudioTime = ref(0)
const audioDuration = ref(0)
const isAudioPlaying = ref(false)
const updateChoicesVisible = ref(false)
const updateDraft = ref<StoryCardDraft>()
const updateChoice = ref<Exclude<StoryCardContentUpdateChoice, 'keep_current_story'>>()
const updateEditingTitle = ref('')
const updateEditingStoryText = ref('')
const ruleExampleDraft = ref<StoryCardDraft>()
const activeRuleExampleId = ref<StoryCardTestRuleExampleId>()

let recorder: MediaRecorder | undefined
let stream: MediaStream | undefined
let chunks: Blob[] = []
let activeStartedAt: number | undefined
let durationRefreshTimer: ReturnType<typeof setInterval> | undefined
let durationLimitTimer: ReturnType<typeof setTimeout> | undefined
let previousBodyOverflowY = ''
let previousDocumentOverflowY = ''

const durationLabel = computed(() => `${Math.floor(durationMs.value / 1_000)} 秒`)
const confirmedDateLabel = computed(() => {
  if (!confirmedCard.value) return ''
  return new Date(confirmedCard.value.confirmedAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})
const currentAudioTimeLabel = computed(() => formatStoryCardAudioTime(currentAudioTime.value))
const audioDurationLabel = computed(() => formatStoryCardAudioTime(audioDuration.value))
const canConfirmFullRerecording = computed(() => fullRecording.value?.kind === 'full_rerecording')

function syncRecordingState(): void {
  recordingState.value = recordingFlow.state
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '录音测试操作失败，请重试。'
}

function requireRealStoryCardApi(): {
  readTemporaryStoryCardAudio: (audioRef: string) => Promise<{ audioBase64: string; mimeType: 'audio/webm' }>
  ai: {
    asrTranscribe: (input: { audioBase64: string; mimeType: string; language?: string }) => Promise<unknown>
    storyRewrite: (input: { workId: string; text: string; context: Record<string, unknown> }) => Promise<unknown>
  }
} {
  const api = window.electronAPI
  if (!api?.readTemporaryStoryCardAudio || !api.ai?.asrTranscribe || !api.ai?.storyRewrite) {
    throw new Error('真实故事服务接口不可用，请在已启动本机 AI 网关的 Electron 应用中打开。')
  }
  return api
}

function releaseStream(): void {
  stream?.getTracks().forEach((track) => track.stop())
  stream = undefined
  recorder = undefined
  chunks = []
}

function clearRecordingTimers(): void {
  if (durationRefreshTimer !== undefined) clearInterval(durationRefreshTimer)
  if (durationLimitTimer !== undefined) clearTimeout(durationLimitTimer)
  durationRefreshTimer = undefined
  durationLimitTimer = undefined
}

function syncActiveDurationPreview(): void {
  if (activeStartedAt === undefined) return
  durationMs.value = Math.min(
    MAX_RECORDING_DURATION_MS,
    recordingFlow.durationMs + Math.max(Date.now() - activeStartedAt, 0)
  )
}

function recordActiveDuration(): boolean {
  if (activeStartedAt === undefined) return false

  const elapsedMs = Math.max(Date.now() - activeStartedAt, 0)
  activeStartedAt = undefined
  const progress = recordingFlow.addRecordedDuration(elapsedMs)
  durationMs.value = progress.durationMs
  return progress.status === 'limit_reached'
}

async function persistEndedRecording(limitReached: boolean): Promise<void> {
  const recording = await stopRecorder()
  const audioRef = await saveTemporaryFullRecording(recording)
  const completed = recordingFlow.completeFullRecording(audioRef, durationMs.value)
  fullRecording.value = completed.recording
  realFullTranscript.value = undefined
  releaseStream()

  if (completed.supersededAudioRef) {
    await deleteTemporaryStoryCardRecording(completed.supersededAudioRef)
  }

  statusMessage.value = limitReached
    ? '已达到 5 分钟录音上限，完整录音已临时保存。现在可以补充文字。'
    : `完整录音已临时保存（${durationLabel.value}）。现在可以补充文字。`
}

async function stopRecordingAtLimit(): Promise<void> {
  clearRecordingTimers()
  busy.value = true
  errorMessage.value = ''
  try {
    const remainingMs = MAX_RECORDING_DURATION_MS - recordingFlow.durationMs
    if (remainingMs > 0) recordingFlow.addRecordedDuration(remainingMs)
    durationMs.value = recordingFlow.durationMs
    activeStartedAt = undefined
    syncRecordingState()
    await persistEndedRecording(true)
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

function startRecordingTimers(): void {
  clearRecordingTimers()
  durationRefreshTimer = setInterval(syncActiveDurationPreview, 250)
  const remainingMs = MAX_RECORDING_DURATION_MS - recordingFlow.durationMs
  durationLimitTimer = setTimeout(() => {
    void stopRecordingAtLimit()
  }, Math.max(remainingMs, 0))
}

function resetAudioPlayback(): void {
  audioElement.value?.pause()
  currentAudioTime.value = 0
  audioDuration.value = 0
  isAudioPlaying.value = false
}

async function toggleAudioPlayback(): Promise<void> {
  const audio = audioElement.value
  if (!audio) return

  errorMessage.value = ''
  try {
    if (audio.paused) {
      await audio.play()
      return
    }
    audio.pause()
  } catch (error) {
    errorMessage.value = messageFor(error)
  }
}

function updateAudioMetadata(): void {
  const duration = audioElement.value?.duration ?? 0
  audioDuration.value = Number.isFinite(duration) ? duration : 0
}

function updateAudioProgress(): void {
  const currentTime = audioElement.value?.currentTime ?? 0
  currentAudioTime.value = Number.isFinite(currentTime) ? currentTime : 0
}

function seekAudio(event: Event): void {
  const audio = audioElement.value
  if (!audio) return

  const nextTime = Math.min(Math.max(Number((event.target as HTMLInputElement).value), 0), audioDuration.value)
  audio.currentTime = nextTime
  currentAudioTime.value = nextTime
}

async function requestMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('当前环境不支持麦克风录音测试。')
  }
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

function startRecorder(nextStream: MediaStream): void {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  stream = nextStream
  chunks = []
  recorder = new MediaRecorder(stream, { mimeType })
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  recorder.start()
}

function stopRecorder(): Promise<Blob> {
  const activeRecorder = recorder
  if (!activeRecorder || activeRecorder.state === 'inactive') {
    throw new Error('当前没有可结束的录音。')
  }

  return new Promise((resolve, reject) => {
    activeRecorder.addEventListener('stop', () => {
      resolve(new Blob(chunks, { type: activeRecorder.mimeType || 'audio/webm' }))
    }, { once: true })
    activeRecorder.addEventListener('error', () => reject(new Error('浏览器录音失败。')), { once: true })
    activeRecorder.stop()
  })
}

function enterStoryCardTestFlow(): void {
  entered.value = true
}

async function startRecording(): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  try {
    const microphone = await requestMicrophone()
    recordingFlow.dispatch('start')
    startRecorder(microphone)
    activeStartedAt = Date.now()
    startRecordingTimers()
    syncRecordingState()
    statusMessage.value = '正在录制完整故事。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function pauseRecording(): Promise<void> {
  try {
    clearRecordingTimers()
    recorder?.pause()
    if (recordActiveDuration()) {
      busy.value = true
      try {
        syncRecordingState()
        await persistEndedRecording(true)
      } finally {
        busy.value = false
      }
      return
    }
    recordingFlow.dispatch('pause')
    syncRecordingState()
    statusMessage.value = '录音已暂停。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  }
}

function resumeRecording(): void {
  try {
    recorder?.resume()
    recordingFlow.dispatch('resume')
    activeStartedAt = Date.now()
    startRecordingTimers()
    syncRecordingState()
    statusMessage.value = '录音已继续。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  }
}

async function endRecording(): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  try {
    clearRecordingTimers()
    const limitReached = recordActiveDuration()
    if (!limitReached) recordingFlow.dispatch('end')
    syncRecordingState()
    await persistEndedRecording(limitReached)
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function rerecord(): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  try {
    const microphone = await requestMicrophone()
    if (recorder && recorder.state !== 'inactive') {
      await stopRecorder()
      releaseStream()
    }
    recordingFlow.dispatch('rerecord')
    durationMs.value = 0
    realFullTranscript.value = undefined
    activeStartedAt = Date.now()
    startRecorder(microphone)
    startRecordingTimers()
    syncRecordingState()
    statusMessage.value = '已开始新的完整录音；旧的已保存录音会在新录音保存成功后清理。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

function submitManualText(): void {
  errorMessage.value = ''
  const result = recordingFlow.createManualTextRequest(manualText.value)
  if (!result.ok) {
    errorMessage.value = result.error.message
    return
  }

  pendingManualTextRequest.value = result.request
  storyDraft.value = undefined
  confirmedCard.value = undefined
  statusMessage.value = manualTextRequestSummary(result.request)
}

function useCandidateExample(): void {
  manualText.value = STORY_CARD_TEST_READY_TEXT
  statusMessage.value = '已填入候选故事 Mock 示例。固定 Mock 不会识别本次录音，只会返回预设结果。'
}

function useInsufficientExample(): void {
  manualText.value = STORY_CARD_TEST_INSUFFICIENT_TEXT
  statusMessage.value = '已填入内容不足 Mock 示例。固定 Mock 不会识别本次录音，只会返回预设结果。'
}

async function showRuleExample(id: StoryCardTestRuleExampleId): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  try {
    activeRuleExampleId.value = id
    ruleExampleDraft.value = await processTestRuleExample(workContext, id)
    statusMessage.value = '已生成故事整理规则 Mock 示例；此结果仅供验收查看，不会保存为故事卡。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function processManualText(): Promise<void> {
  const input = pendingManualTextRequest.value
  const recording = fullRecording.value
  if (!input || !recording) return

  busy.value = true
  errorMessage.value = ''
  try {
    const draft = await processTestManualTextWithFullRecording(
      workContext,
      recording,
      input
    )
    storyDraft.value = draft
    if (draft.status === 'ready_for_review') {
      const editing = prepareStoryCardEditing(draft)
      if (!editing.ok) throw new Error(editing.error.message)
      editingTitle.value = editing.payload.title
      editingStoryText.value = editing.payload.storyText
    }
    statusMessage.value = draft.status === 'needs_more_input'
      ? '内容还不够完整，请回答下方问题后再次整理。'
      : '已生成临时候选故事，尚未确认或保存。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function processFullRecordingWithRealServices(): Promise<void> {
  if (!fullRecording.value) return

  busy.value = true
  errorMessage.value = ''
  statusMessage.value = '正在调用真实语音识别和故事整理服务，请稍候。'
  try {
    const recognition = await realSpeechRecognition.transcribe(fullRecording.value)
    if (!recognition.ok) {
      storyDraft.value = { workId: fullRecording.value.workId, status: 'failed', error: recognition.error }
      statusMessage.value = '真实语音识别暂时未能完成。'
      return
    }
    realFullTranscript.value = {
      audioRef: fullRecording.value.audioRef,
      text: recognition.transcript.text
    }
    storyDraft.value = await realStoryProcessor.processTranscript({
      workId: fullRecording.value.workId,
      text: recognition.transcript.text,
      context: workContext
    })
    if (storyDraft.value.status === 'ready_for_review') {
      const editing = prepareStoryCardEditing(storyDraft.value)
      if (!editing.ok) throw new Error(editing.error.message)
      editingTitle.value = editing.payload.title
      editingStoryText.value = editing.payload.storyText
      statusMessage.value = '真实服务已生成临时候选故事，尚未确认或保存。'
      return
    }
    statusMessage.value = storyDraft.value.status === 'needs_more_input'
      ? '真实语音识别已完成，但内容还不够完整，请补充回答后再整理。'
      : '真实服务暂时未能生成候选故事。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function processManualTextWithRealServices(): Promise<void> {
  if (!pendingManualTextRequest.value) return
  const transcript = realFullTranscript.value
  if (!transcript || transcript.audioRef !== pendingManualTextRequest.value.baseOriginalAudioRef) {
    errorMessage.value = '请先对当前完整录音使用真实服务处理，才能把录音内容与文字补充一起整理。'
    return
  }

  busy.value = true
  errorMessage.value = ''
  statusMessage.value = '正在调用真实故事整理服务，请稍候。'
  try {
    storyDraft.value = await realStoryProcessor.process({
      input: {
        ...pendingManualTextRequest.value,
        text: `${transcript.text}\n${pendingManualTextRequest.value.text}`
      },
      context: workContext
    })
    if (storyDraft.value.status === 'ready_for_review') {
      const editing = prepareStoryCardEditing(storyDraft.value)
      if (!editing.ok) throw new Error(editing.error.message)
      editingTitle.value = editing.payload.title
      editingStoryText.value = editing.payload.storyText
      statusMessage.value = '真实服务已将完整录音转写与文字补充合并为临时候选故事，尚未确认或保存。'
      return
    }
    statusMessage.value = storyDraft.value.status === 'needs_more_input'
      ? '内容还不够完整，请补充回答后再用真实服务整理。'
      : '真实服务暂时未能生成候选故事。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function submitSupplement(): Promise<void> {
  errorMessage.value = ''
  const result = recordingFlow.createManualTextRequest(supplementText.value)
  if (!result.ok) {
    errorMessage.value = result.error.message
    return
  }

  pendingManualTextRequest.value = result.request
  await processManualText()
}

async function confirmEditedStoryCard(): Promise<void> {
  if (!fullRecording.value || storyDraft.value?.status !== 'ready_for_review') return

  busy.value = true
  errorMessage.value = ''
  try {
    const savedCard = await confirmStoryCard(
      {
        editPayload: {
          workId: workContext.workId,
          title: editingTitle.value,
          storyText: editingStoryText.value
        },
        workContext,
        confirmedAt: new Date().toISOString(),
        recording: fullRecording.value
      },
      storyCardStore,
      { promoteTemporaryFullRecording: confirmTemporaryFullStoryCardRecording }
    )
    confirmedCard.value = await getStoryCardDetail(savedCard.workId, storyCardStore)
    recordingFlow.releaseConfirmedRecording(fullRecording.value.audioRef)
    fullRecording.value = undefined
    resetAudioPlayback()
    statusMessage.value = '已确认这就是我的故事，并写入本地测试故事卡。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function loadConfirmedStoryCardDetail(): Promise<void> {
  busy.value = true
  errorMessage.value = ''
  try {
    confirmedCard.value = await getStoryCardDetail(workContext.workId, storyCardStore)
    resetAudioPlayback()
    statusMessage.value = '已读取本地测试故事卡详情。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function simulateArtworkUpdate(): Promise<void> {
  if (!confirmedCard.value) return

  busy.value = true
  errorMessage.value = ''
  try {
    await syncStoryCardArtworkImage(updatedWorkContext, storyCardStore)
    confirmedCard.value = await getStoryCardDetail(workContext.workId, storyCardStore)
    updateChoicesVisible.value = true
    updateDraft.value = undefined
    updateChoice.value = undefined
    audioElement.value?.pause()
    currentAudioTime.value = 0
    isAudioPlaying.value = false
    statusMessage.value = '作品图片已自动更新。请选择保持当前故事、完整重录或局部补录。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function chooseStoryContentUpdate(choice: StoryCardContentUpdateChoice): Promise<void> {
  if (!confirmedCard.value || !updateChoicesVisible.value) return

  busy.value = true
  errorMessage.value = ''
  updateDraft.value = undefined
  updateChoice.value = undefined
  try {
    const action = decideStoryCardContentUpdate(workContext.workId, choice)
    if (action.type === 'keep_current_story') {
      statusMessage.value = '已保持当前故事：图片已更新，故事正文和原始音频没有改变。'
      return
    }

    updateDraft.value = action.type === 'start_full_rerecording'
      ? await processFullRerecording(
        {
          recording: createTestFullRerecordingInput(action.workId),
          context: updatedWorkContext
        },
        storyCardStore,
        storyProcessor
      )
      : await processPartialSupplement(
        {
          supplement: createTestPartialSupplementInput(action.workId),
          context: updatedWorkContext
        },
        storyCardStore,
        storyProcessor
      )
    if (updateDraft.value.status === 'ready_for_review') {
      const editing = prepareStoryCardEditing(updateDraft.value)
      if (!editing.ok) throw new Error(editing.error.message)
      updateEditingTitle.value = editing.payload.title
      updateEditingStoryText.value = editing.payload.storyText
      updateChoice.value = action.type === 'start_full_rerecording' ? 'full_rerecording' : 'partial_supplement'
    }
    statusMessage.value = action.type === 'start_full_rerecording'
      ? '已生成完整重录的临时候选稿。请在上方重新录音后，再确认覆盖正式故事卡。'
      : '已生成局部补录的临时候选稿。确认后只会更新故事文字，原完整音频保持不变。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function confirmUpdatedStoryCard(): Promise<void> {
  if (updateDraft.value?.status !== 'ready_for_review' || !updateChoice.value) return

  busy.value = true
  errorMessage.value = ''
  try {
    const savedCard = updateChoice.value === 'full_rerecording'
      ? await confirmFullRerecording()
      : await confirmPartialSupplement(
        {
          editPayload: {
            workId: workContext.workId,
            title: updateEditingTitle.value,
            storyText: updateEditingStoryText.value
          },
          workContext: updatedWorkContext,
          confirmedAt: new Date().toISOString(),
          supplement: createTestPartialSupplementInput(workContext.workId)
        },
        storyCardStore
      )
    confirmedCard.value = await getStoryCardDetail(savedCard.workId, storyCardStore)
    updateDraft.value = undefined
    updateChoice.value = undefined
    resetAudioPlayback()
    statusMessage.value = '已确认更新后的故事卡，并重新读取正式详情。'
  } catch (error) {
    errorMessage.value = messageFor(error)
  } finally {
    busy.value = false
  }
}

async function confirmFullRerecording(): Promise<StoryCard> {
  const recording = fullRecording.value
  if (!recording || recording.kind !== 'full_rerecording') {
    throw new Error('请先在上方点击“重新录音”，录制并结束一段新的完整录音。')
  }

  const savedCard = await confirmStoryCard(
    {
      editPayload: {
        workId: workContext.workId,
        title: updateEditingTitle.value,
        storyText: updateEditingStoryText.value
      },
      workContext: updatedWorkContext,
      confirmedAt: new Date().toISOString(),
      recording
    },
    storyCardStore,
    { promoteTemporaryFullRecording: confirmTemporaryFullStoryCardRecording }
  )
  recordingFlow.releaseConfirmedRecording(recording.audioRef)
  fullRecording.value = undefined
  return savedCard
}

onMounted(() => {
  previousBodyOverflowY = document.body.style.overflowY
  previousDocumentOverflowY = document.documentElement.style.overflowY
  document.body.style.overflowY = 'auto'
  document.documentElement.style.overflowY = 'auto'
})

onUnmounted(() => {
  clearRecordingTimers()
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  resetAudioPlayback()
  releaseStream()
  document.body.style.overflowY = previousBodyOverflowY
  document.documentElement.style.overflowY = previousDocumentOverflowY
})
</script>

<template>
  <section class="story-card-test-page">
    <p class="eyebrow">Story Card · Test Flow</p>
    <h2>作品故事卡测试入口</h2>
    <p>此页面仅用于阶段 5 的功能验证，不代表正式界面设计。</p>

    <dl>
      <div><dt>作品 ID</dt><dd>{{ workContext.workId }}</dd></div>
      <div><dt>完成状态</dt><dd>{{ workContext.completionStatus }}</dd></div>
      <div><dt>背景</dt><dd>{{ workContext.background?.name }}</dd></div>
      <div><dt>主体</dt><dd>{{ workContext.subject.name }}</dd></div>
      <div><dt>贴纸</dt><dd>{{ workContext.stickers.map((sticker) => sticker.name).join('、') }}</dd></div>
    </dl>

    <button type="button" class="primary" @click="enterStoryCardTestFlow">进入故事卡测试流程</button>

    <p v-if="entered" class="entered" role="status">
      已进入测试流程：{{ workContext.workId }}。
    </p>

    <section v-if="entered" class="test-section" aria-labelledby="recording-title">
      <h3 id="recording-title">完整录音测试</h3>
      <p>当前状态：{{ recordingState }}；累计时长：{{ durationLabel }}</p>
      <div class="controls">
        <button v-if="recordingState === 'not_started'" type="button" class="primary" :disabled="busy" @click="startRecording">开始录音</button>
        <button v-if="recordingState === 'recording' || recordingState === 'rerecording'" type="button" :disabled="busy" @click="pauseRecording">暂停录音</button>
        <button v-if="recordingState === 'paused'" type="button" :disabled="busy" @click="resumeRecording">继续录音</button>
        <button v-if="recordingState === 'recording' || recordingState === 'paused' || recordingState === 'rerecording'" type="button" :disabled="busy" @click="endRecording">结束录音</button>
        <button v-if="recordingState !== 'not_started'" type="button" :disabled="busy" @click="rerecord">重新录音</button>
      </div>
      <p v-if="fullRecording" class="reference">临时完整录音：{{ fullRecording.audioRef }}</p>
    </section>

    <section v-if="entered" class="test-section" aria-labelledby="manual-text-title">
      <h3 id="manual-text-title">录制后文字补充测试</h3>
      <label for="manual-text">补充内容</label>
      <textarea id="manual-text" v-model="manualText" :disabled="!fullRecording || busy" rows="4" placeholder="结束完整录音后，可在这里补充文字。" />
      <button type="button" class="primary" :disabled="!fullRecording || busy" @click="submitManualText">提交文字补充测试</button>
      <p v-if="!fullRecording" class="hint">请先完成一段完整录音；手动文字不会替代原始音频。</p>
    </section>

    <section v-if="entered" class="test-section" aria-labelledby="candidate-title">
      <h3 id="candidate-title">候选故事与补充流程测试</h3>
      <p>本区域使用固定 Mock 的预设整理结果；不会识别或转写你本次录音。候选稿在确认前不会保存为正式故事卡。</p>
      <div class="controls">
        <button type="button" :disabled="!fullRecording || busy" @click="useCandidateExample">填入文字补充示例</button>
        <button type="button" :disabled="!fullRecording || busy" @click="useInsufficientExample">填入内容不足示例</button>
        <button type="button" class="primary" :disabled="!pendingManualTextRequest || busy" @click="processManualText">处理为候选故事</button>
        <button type="button" :disabled="busy" @click="loadConfirmedStoryCardDetail">读取已确认故事卡详情</button>
      </div>

      <p v-if="!pendingManualTextRequest" class="hint">先在上方提交文字补充测试，再处理为候选故事。</p>

      <section class="rule-example-test" aria-labelledby="rule-example-title">
        <h4 id="rule-example-title">故事整理规则 Mock 示例</h4>
        <p class="hint">以下固定样例仅用于 AC-05 至 AC-07 的人工查看，不关联录音，也不会保存故事卡。</p>
        <div class="controls">
          <button type="button" :disabled="busy" @click="showRuleExample('language-chinese')">验证中文语言结构</button>
          <button type="button" :disabled="busy" @click="showRuleExample('language-english')">验证英文语言结构</button>
          <button type="button" :disabled="busy" @click="showRuleExample('language-mixed')">验证中英混合结构</button>
          <button type="button" :disabled="busy" @click="showRuleExample('visual-boundary')">验证画面信息边界</button>
          <button type="button" :disabled="busy" @click="showRuleExample('child-friendly')">验证儿童友好措辞</button>
        </div>
        <article v-if="ruleExampleDraft?.status === 'ready_for_review'" class="draft-result">
          <p class="result-label">规则示例结果（未保存）</p>
          <h4>{{ ruleExampleDraft.suggestedTitle }}</h4>
          <p>{{ ruleExampleDraft.suggestedStoryText }}</p>
          <p class="hint">当前示例：{{ activeRuleExampleId }}</p>
        </article>
      </section>

      <section class="real-service-test" aria-labelledby="real-service-title">
        <h4 id="real-service-title">真实服务联调（会使用本机 AI 服务）</h4>
        <p class="hint">只有这里会读取当前临时完整录音并发起真实 AI 调用，用于验证实际录音的转写和语义保留；生成的仍是未确认候选稿，不会自动保存故事卡。</p>
        <div class="controls">
          <button type="button" class="primary" :disabled="!fullRecording || busy" @click="processFullRecordingWithRealServices">使用真实服务处理完整录音</button>
          <button type="button" class="primary" :disabled="!pendingManualTextRequest || !realFullTranscript || busy" @click="processManualTextWithRealServices">使用真实服务处理文字补充</button>
        </div>
        <p v-if="pendingManualTextRequest && !realFullTranscript" class="hint">请先用真实服务处理当前完整录音，文字补充才会与原转写一起整理。</p>
      </section>

      <article v-if="storyDraft?.status === 'ready_for_review' && !confirmedCard" class="draft-result">
        <p class="result-label">临时候选故事（未确认）</p>
        <label for="story-title">故事标题</label>
        <input id="story-title" v-model="editingTitle" :disabled="busy" />
        <label for="story-text">故事正文</label>
        <textarea id="story-text" v-model="editingStoryText" :disabled="busy" rows="6" />
        <button type="button" class="primary" :disabled="busy" @click="confirmEditedStoryCard">确认这就是我的故事</button>
      </article>

      <article v-else-if="storyDraft?.status === 'needs_more_input'" class="draft-result">
        <p class="result-label">还想多听一点</p>
        <ol>
          <li v-for="question in storyDraft.followUpQuestions" :key="question">{{ question }}</li>
        </ol>
        <label for="supplement-text">补充回答</label>
        <textarea id="supplement-text" v-model="supplementText" :disabled="busy" rows="4" />
        <button type="button" class="primary" :disabled="busy" @click="submitSupplement">提交补充并重新整理</button>
      </article>

      <p v-else-if="storyDraft?.status === 'failed'" class="error" role="alert">{{ storyDraft.error.message }}</p>

      <article v-if="confirmedCard" class="draft-result confirmed-result" aria-labelledby="story-card-detail-title">
        <p class="result-label">正式故事卡详情（已确认）</p>
        <img class="artwork-image" :src="confirmedCard.artworkImageRef" alt="这幅作品的图片" />
        <h4 id="story-card-detail-title">{{ confirmedCard.title }}</h4>
        <p class="detail-date">创作日期：{{ confirmedDateLabel }}</p>
        <p class="story-text-scroll" tabindex="0">{{ confirmedCard.storyText }}</p>
        <section class="audio-player" aria-label="原始音频播放器">
          <p class="detail-date">原始音频</p>
          <audio
            ref="audioElement"
            :src="confirmedCard.originalAudioRef"
            preload="auto"
            @loadedmetadata="updateAudioMetadata"
            @timeupdate="updateAudioProgress"
            @play="isAudioPlaying = true"
            @pause="isAudioPlaying = false"
            @ended="isAudioPlaying = false"
            @error="errorMessage = '原始音频暂时无法播放，请重试。'"
          ></audio>
          <div class="controls audio-controls">
            <button type="button" class="primary" @click="toggleAudioPlayback">
              {{ isAudioPlaying ? '暂停播放' : '播放原始音频' }}
            </button>
            <span>{{ currentAudioTimeLabel }} / {{ audioDurationLabel }}</span>
          </div>
          <input
            class="audio-progress"
            type="range"
            min="0"
            :max="audioDuration"
            step="0.1"
            :value="currentAudioTime"
            :disabled="audioDuration <= 0"
            aria-label="原始音频播放进度"
            @input="seekAudio"
          />
          <p class="reference">原始完整录音引用：{{ confirmedCard.originalAudioRef }}</p>
        </section>
      </article>

      <section v-if="confirmedCard" class="test-section" aria-labelledby="content-update-title">
        <h3 id="content-update-title">作品修改后的故事卡更新测试</h3>
        <p>使用固定 Mock 模拟作品图片更新；候选稿需由操作者再次确认后才会覆盖正式故事卡。</p>
        <div class="controls">
          <button type="button" class="primary" :disabled="busy" @click="simulateArtworkUpdate">模拟作品图片更新</button>
        </div>
        <div v-if="updateChoicesVisible" class="controls update-controls">
          <button type="button" :disabled="busy" @click="chooseStoryContentUpdate('keep_current_story')">保持当前故事</button>
          <button type="button" :disabled="busy" @click="chooseStoryContentUpdate('full_rerecording')">完整重录（Mock）</button>
          <button type="button" :disabled="busy" @click="chooseStoryContentUpdate('partial_supplement')">局部补录（Mock）</button>
        </div>
        <article v-if="updateDraft?.status === 'ready_for_review'" class="draft-result">
          <p class="result-label">更新临时候选故事（未确认）</p>
          <label for="update-story-title">故事标题</label>
          <input id="update-story-title" v-model="updateEditingTitle" :disabled="busy" />
          <label for="update-story-text">故事正文</label>
          <textarea id="update-story-text" v-model="updateEditingStoryText" :disabled="busy" rows="6" />
          <p v-if="updateChoice === 'full_rerecording'" class="hint">完整重录需要先在上方点击“重新录音”，录制并结束新的完整录音。</p>
          <button type="button" class="primary" :disabled="busy || (updateChoice === 'full_rerecording' && !canConfirmFullRerecording)" @click="confirmUpdatedStoryCard">
            {{ updateChoice === 'full_rerecording' ? '确认完整重录并覆盖故事卡' : '确认局部补录并更新故事卡' }}
          </button>
        </article>
        <p v-else-if="updateDraft?.status === 'needs_more_input'" class="hint">此次 Mock 输入仍需补充信息。</p>
        <p v-else-if="updateDraft?.status === 'failed'" class="error" role="alert">{{ updateDraft.error.message }}</p>
      </section>
    </section>

    <p v-if="statusMessage" class="entered" role="status">{{ statusMessage }}</p>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.story-card-test-page {
  max-width: 720px;
  padding: 24px;
  border: 1px solid var(--line);
  background: var(--panel);
}

h2 {
  margin: 4px 0 12px;
}

dl {
  display: grid;
  gap: 8px;
  margin: 20px 0;
}

dl div {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.entered {
  margin: 16px 0 0;
  color: var(--accent);
}

.test-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.test-section h3 {
  margin: 0 0 8px;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.update-controls {
  margin-top: 12px;
}

textarea {
  display: block;
  width: 100%;
  max-width: 560px;
  margin: 8px 0;
  padding: 8px;
  font: inherit;
}

input {
  display: block;
  width: 100%;
  max-width: 560px;
  margin: 8px 0;
  padding: 8px;
  font: inherit;
}

.reference,
.hint {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.error {
  margin: 16px 0 0;
  color: var(--danger);
}

.draft-result {
  max-width: 560px;
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--line);
}

.real-service-test {
  margin-top: 20px;
  padding: 16px;
  border: 1px dashed var(--accent);
}

.real-service-test h4 {
  margin: 0 0 8px;
}

.rule-example-test {
  margin-top: 20px;
  padding: 16px;
  border: 1px dashed var(--line);
}

.rule-example-test h4 {
  margin: 0 0 8px;
}

.draft-result h4 {
  margin: 4px 0 8px;
}

.result-label {
  margin: 0;
  color: var(--accent);
  font-weight: 600;
}

.confirmed-result {
  border-color: var(--accent);
}

.artwork-image {
  display: block;
  width: min(100%, 400px);
  aspect-ratio: 902 / 516;
  margin: 12px 0;
  border: 1px solid var(--line);
  object-fit: cover;
}

.detail-date {
  color: var(--muted);
}

.story-text-scroll {
  height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.audio-player {
  max-width: 320px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.audio-player audio {
  display: none;
}

.audio-controls {
  align-items: center;
}

.audio-progress {
  width: 100%;
  margin-top: 12px;
}
</style>
