/**
 * V4.6 阶段 4: 素材「问问它」对话状态机
 *
 * 纯逻辑、不依赖 Vue/browser；UI 只负责派发。
 *
 * - history 始终保持 user / assistant 完整对
 * - 单调递增的 `generation` 标识当前 QA 请求；close / 切素材 / unmount 会 bump，
 *   让任何未完成的响应通过 `if (gen !== currentGeneration) return` 被丢弃
 * - 独立的 `voiceGeneration` 标识当前 voice 流程（getUserMedia 等待 + 录音 +
 *   ASR 等待）；同样的 bump 触发器，捕获期间任一阶段的 stale
 * - 失败不写入半轮 history，输入框文本保留
 * - 错误信息统一走 friendlyError：永不泄露 IPC / Gateway / HTTP / provider /
 *   requestId / Invalid AI response
 * - ASR 把 transcript 写入 input，但不调用 qaAsk
 * - 麦克风被拒：micAvailable 标记 + hint 文本
 * - releaseMic() 关闭 MediaStream tracks
 */
import type { QaHistoryMessage } from '@shared/qa-history'

export type MicAvailability = 'unknown' | 'available' | 'unavailable'

export interface AssetQaClient {
  qaAsk: (input: {
    question: string
    asset?: { assetId?: string; nameZh?: string; introZh?: string; themeId?: string }
    history?: readonly QaHistoryMessage[]
  }) => Promise<{ answer: string }>
  asrTranscribe: (input: { audioBase64: string; mimeType: string }) => Promise<{ transcript: string }>
}

export interface AssetQaSnapshot {
  history: QaHistoryMessage[]
  busy: boolean
  errorMessage: string
  micAvailability: MicAvailability
  micHint: string
  input: string
  isRecording: boolean
  isAsrBusy: boolean
  /**
   * True while the user has clicked "说一说" and the browser is still
   * resolving getUserMedia. Used by the UI to disable the voice button
   * (and to short-circuit any second click) so a kid can't spawn two
   * concurrent microphone prompts.
   */
  isMicStarting: boolean
}

export type AssetQaListener = (snapshot: AssetQaSnapshot) => void

const ASSET_QA_MAX_QUESTION = 500

// 错误文案统一为儿童版短句：2-4 字段、围绕素材说话、不暴露 IPC / Gateway / provider。
const QA_ERROR_TEXT = '刚刚没答出来，再试一次吧。'
const MIC_DENIED_TEXT = '现在不能用麦克风，可以打字问我。'
const MIC_UNAVAILABLE_TEXT = '现在不能用麦克风，可以打字问我。'
const TRANSCRIPT_FAIL_TEXT = '刚刚没听清，再说一次吧。'

function defaultSnapshot(partial: Partial<AssetQaSnapshot> = {}): AssetQaSnapshot {
  return {
    history: [],
    busy: false,
    errorMessage: '',
    micAvailability: 'unknown',
    micHint: '',
    input: '',
    isRecording: false,
    isAsrBusy: false,
    isMicStarting: false,
    ...partial
  }
}

/**
 * Map unknown failures to child-friendly text. We must not leak
 * any IPC / Gateway / HTTP / provider / requestId / "Invalid AI response" / etc.
 */
export function friendlyQaErrorMessage(err: unknown): string {
  if (isMissingService(err, '问答服务尚未配置，请联系管理员。')) return '问答服务尚未配置，请联系管理员。'
  if (errorCode(err) === 'QA_TIMEOUT') return '回答等得有点久，请稍后再试。你的问题还在。'
  return QA_ERROR_TEXT
}

function errorCode(err: unknown): unknown {
  return err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
}

// Only allow exact public messages produced by our error mapper. Never echo
// arbitrary upstream text, which may contain credentials or internal paths.
function isMissingService(err: unknown, message: string): boolean {
  if (!err || typeof err !== 'object') return false
  const value = err as { code?: unknown; retryable?: unknown; message?: unknown }
  return value.code === 'UNKNOWN' && value.retryable === false && value.message === message
}

/**
 * Map any ASR failure to a single, child-friendly text.
 */
export function friendlyAsrErrorMessage(err?: unknown): string {
  if (isMissingService(err, '语音识别服务尚未配置，请联系管理员；也可以先打字。')) return '语音识别服务尚未配置，请联系管理员；也可以先打字。'
  if (errorCode(err) === 'ASR_TIMEOUT') return '语音识别等得有点久，请稍后再试，也可以先打字。'
  return TRANSCRIPT_FAIL_TEXT
}

export class AssetQaController {
  private history: QaHistoryMessage[] = []
  private input = ''
  private busy = false
  private errorMessage = ''
  private micAvailability: MicAvailability = 'unknown'
  private micHint = ''
  private isRecording = false
  private isAsrBusy = false
  private isMicStarting = false
  private generation = 0
  private inflight: { generation: number; sentAt: string } | null = null
  private voiceGeneration = 0
  private listeners = new Set<AssetQaListener>()

  constructor(private readonly client: AssetQaClient) {}

  subscribe(listener: AssetQaListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): AssetQaSnapshot {
    return {
      history: this.history.slice(),
      busy: this.busy,
      errorMessage: this.errorMessage,
      micAvailability: this.micAvailability,
      micHint: this.micHint,
      input: this.input,
      isRecording: this.isRecording,
      isAsrBusy: this.isAsrBusy,
      isMicStarting: this.isMicStarting
    }
  }

  setInput(value: string): void {
    this.input = value
    this.emit()
  }

  resetForClose(): void {
    this.generation += 1
    this.voiceGeneration += 1
    this.inflight = null
    this.busy = false
    this.history = []
    this.input = ''
    this.errorMessage = ''
    this.isRecording = false
    this.isAsrBusy = false
    this.isMicStarting = false
    this.emit()
  }

  resetForAssetSwitch(): void {
    // Identical to close: no per-asset persistence in v1.
    this.resetForClose()
  }

  /** Returns the current voice-generation token. UI captures it before any await. */
  captureVoiceGeneration(): number {
    return this.voiceGeneration
  }

  /** Bump the voice generation so any in-flight voice step becomes stale. */
  bumpVoiceGeneration(): void {
    this.voiceGeneration += 1
    if (this.isRecording || this.isAsrBusy) {
      this.isRecording = false
      this.isAsrBusy = false
    }
    this.isMicStarting = false
    this.emit()
  }

  /** True when the captured voice token is still current. */
  isVoiceTokenCurrent(token: number): boolean {
    return token === this.voiceGeneration
  }

  releaseMic(): void {
    this.isRecording = false
    this.isAsrBusy = false
    this.isMicStarting = false
    this.emit()
  }

  beginRecording(): void {
    this.micHint = ''
    this.isMicStarting = true
    this.emit()
  }

  failRecording(reason: 'denied' | 'unavailable'): void {
    this.micAvailability = 'unavailable'
    this.micHint = reason === 'denied' ? MIC_DENIED_TEXT : MIC_UNAVAILABLE_TEXT
    this.isRecording = false
    this.isMicStarting = false
    this.emit()
  }

  startRecordingSucceeded(): void {
    this.micAvailability = 'available'
    this.isRecording = true
    this.isMicStarting = false
    this.errorMessage = ''
    this.emit()
  }

  beginTranscribing(): void {
    this.isRecording = false
    this.isAsrBusy = true
    this.emit()
  }

  applyTranscript(transcript: string): void {
    const text = transcript.trim()
    if (text) {
      const previous = this.input.trim()
      this.input = previous ? `${previous} ${text}` : text
    } else {
      this.micHint = TRANSCRIPT_FAIL_TEXT
    }
    this.isAsrBusy = false
    this.emit()
  }

  failTranscription(error?: unknown): void {
    this.micHint = friendlyAsrErrorMessage(error)
    this.isAsrBusy = false
    this.emit()
  }

  async submitTextQuestion(asset: {
    assetId: string
    nameZh: string
    introZh: string
    themeId: string
  }): Promise<void> {
    // Double-layer guard: the UI also gates on these via canSend / the
    // disabled attribute, but if a programmatic call slips through (a stray
    // keyboard shortcut, a future codepath, a component bug) we still must
    // never enter a half-turn or fire qaAsk while the voice flow is busy.
    if (this.busy) return
    if (this.isRecording) return
    if (this.isAsrBusy) return
    if (this.isMicStarting) return
    const text = this.input.trim()
    if (!text) return
    if (text.length > ASSET_QA_MAX_QUESTION) {
      this.errorMessage = '问题太长啦，短一点再问吧。'
      this.emit()
      return
    }
    this.errorMessage = ''
    const myGen = ++this.generation
    this.inflight = { generation: myGen, sentAt: text }
    this.busy = true
    this.emit()
    try {
      const result = await this.client.qaAsk({
        question: text,
        asset: {
          assetId: asset.assetId,
          nameZh: asset.nameZh,
          introZh: asset.introZh,
          themeId: asset.themeId
        },
        history: this.history.slice()
      })
      if (myGen !== this.generation) return // stale: do not touch current state
      this.history = [
        ...this.history,
        { role: 'user', content: this.inflight?.sentAt ?? text },
        { role: 'assistant', content: result.answer }
      ]
      this.input = ''
      this.errorMessage = ''
    } catch (err) {
      if (myGen !== this.generation) return
      this.errorMessage = friendlyQaErrorMessage(err)
      // input stays as the user typed it so they can retry.
    } finally {
      if (myGen === this.generation) {
        this.inflight = null
        this.busy = false
        this.emit()
      }
    }
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const listener of this.listeners) listener(snap)
  }
}

export { ASSET_QA_MAX_QUESTION, MIC_DENIED_TEXT, MIC_UNAVAILABLE_TEXT, TRANSCRIPT_FAIL_TEXT }
