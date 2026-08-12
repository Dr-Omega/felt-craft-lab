/**
 * V4.6 阶段 4: 素材「问问它」对话状态机
 *
 * 纯逻辑、不依赖 Vue/browser；UI 只负责派发。
 *
 * - history 始终保持 user / assistant 完整对
 * - 单调递增的 `generation` 标识当前素材；close / 切素材 / unmount 会 bump，
 *   让任何未完成的响应通过 `if (gen !== currentGeneration) return` 被丢弃
 * - 失败不写入半轮 history，输入框文本保留
 * - ASR 把 transcript 写入 input，但不调用 qaAsk
 * - 麦克风被拒：micAvailable 标记 + hint 文本
 * - releaseMic() 关闭 MediaStream tracks
 */
import type { QaHistoryMessage } from '@shared/contracts/ai'

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
}

export type AssetQaListener = (snapshot: AssetQaSnapshot) => void

const ASSET_QA_MAX_QUESTION = 500

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
    ...partial
  }
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
  private generation = 0
  private inflight: { generation: number; sentAt: string } | null = null
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
      isAsrBusy: this.isAsrBusy
    }
  }

  setInput(value: string): void {
    this.input = value
    this.emit()
  }

  resetForClose(): void {
    this.generation += 1
    this.inflight = null
    this.busy = false
    this.history = []
    this.input = ''
    this.errorMessage = ''
    this.emit()
  }

  resetForAssetSwitch(): void {
    // Identical to close: no per-asset persistence in v1.
    this.resetForClose()
  }

  releaseMic(): void {
    this.isRecording = false
    this.isAsrBusy = false
    this.emit()
  }

  beginRecording(): void {
    this.micHint = ''
    this.emit()
  }

  failRecording(reason: 'denied' | 'unavailable'): void {
    this.micAvailability = 'unavailable'
    this.micHint =
      reason === 'denied'
        ? '暂时不能使用麦克风，可以直接打字问我。'
        : '暂时不能使用麦克风，可以直接打字问我。'
    this.isRecording = false
    this.emit()
  }

  startRecordingSucceeded(): void {
    this.micAvailability = 'available'
    this.isRecording = true
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
      this.micHint = '刚刚没有听清楚，再说一次试试。'
    }
    this.isAsrBusy = false
    this.emit()
  }

  failTranscription(): void {
    this.micHint = '刚刚没有听清楚，再说一次试试。'
    this.isAsrBusy = false
    this.emit()
  }

  async submitTextQuestion(asset: {
    assetId: string
    nameZh: string
    introZh: string
    themeId: string
  }): Promise<void> {
    const text = this.input.trim()
    if (!text) return
    if (text.length > ASSET_QA_MAX_QUESTION) {
      this.errorMessage = '问题太长啦，简化一下吧。'
      this.emit()
      return
    }
    if (this.busy) return
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
      this.errorMessage = friendlyError(err)
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

function friendlyError(err: unknown): string {
  if (err instanceof Error && err.message) {
    const msg = err.message
    if (/网络|network|timeout|timed out|offline/i.test(msg)) {
      return '刚刚没有回答成功，再试一次吧。'
    }
    return msg.length < 80 ? msg : '刚刚没有回答成功，再试一次吧。'
  }
  return '刚刚没有回答成功，再试一次吧。'
}

export { ASSET_QA_MAX_QUESTION }
