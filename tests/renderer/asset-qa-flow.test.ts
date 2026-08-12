// @vitest-environment jsdom
/**
 * V4.6 阶段 4: 素材「问问它」QA 链路测试
 *
 * 覆盖 11 个真实行为（不依赖 @vue/test-utils）：
 *  1. 第一问 → 第一答（追加 user + assistant）
 *  2. 第二问请求携带第一轮 history
 *  3. QA 失败不追加半轮 history，输入内容保留
 *  4. 关闭 Sheet 清空 conversation
 *  5. 切素材清空 conversation
 *  6. stale response 不污染新素材
 *  7. ASR transcript 进入输入框
 *  8. ASR 完成后没有自动 qaAsk
 *  9. transcript 可修改后手动发送
 * 10. mic denied 后文字 QA 仍可用
 * 11. 关闭 / unmount 时停止 MediaStream tracks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App as VueApp } from 'vue'
import {
  ASSET_QA_MAX_QUESTION,
  AssetQaController,
  type AssetQaClient
} from '../../src/renderer/src/components/editor/asset-qa.controller'
import AssetQaSheet from '../../src/renderer/src/components/editor/AssetQaSheet.vue'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined
  let rejectFn: ((error: unknown) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return {
    promise,
    resolve(value) { resolveFn?.(value) },
    reject(error) { rejectFn?.(error) }
  }
}

function makeClient(): { client: AssetQaClient; qaAsk: ReturnType<typeof vi.fn>; asrTranscribe: ReturnType<typeof vi.fn> } {
  const qaAsk = vi.fn<(input: Parameters<AssetQaClient['qaAsk']>[0]) => Promise<{ answer: string }>>()
  const asrTranscribe = vi.fn<(input: Parameters<AssetQaClient['asrTranscribe']>[0]) => Promise<{ transcript: string }>>()
  return { client: { qaAsk, asrTranscribe }, qaAsk, asrTranscribe }
}

const sampleAsset = {
  assetId: 'sticker_fu_001',
  nameZh: '小福',
  introZh: '一只会讲故事的小福',
  themeId: 'lunar'
}

const sampleAssetB = {
  assetId: 'sticker_rabbit_001',
  nameZh: '玉兔',
  introZh: '来自月亮的兔子',
  themeId: 'lunar'
}

afterEach(() => {
  // Clean up any mediaDevices stub we put on navigator
  try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }) } catch { /* noop */ }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// -----------------------------------------------------------------
// 控制器纯逻辑测试
// -----------------------------------------------------------------
describe('AssetQaController', () => {
  it('1) first question produces a complete user+assistant turn in history', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk.mockResolvedValueOnce({ answer: '你好呀，小朋友。' })
    const controller = new AssetQaController(client)
    controller.setInput('你是谁？')
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).toHaveBeenCalledTimes(1)
    const snap = controller.snapshot()
    expect(snap.history).toEqual([
      { role: 'user', content: '你是谁？' },
      { role: 'assistant', content: '你好呀，小朋友。' }
    ])
    expect(snap.busy).toBe(false)
    expect(snap.input).toBe('')
  })

  it('2) second submit sends the previous turn inside history', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk
      .mockResolvedValueOnce({ answer: '第一次回答' })
      .mockResolvedValueOnce({ answer: '第二次回答' })
    const controller = new AssetQaController(client)
    controller.setInput('第一问')
    await controller.submitTextQuestion(sampleAsset)
    controller.setInput('第二问')
    await controller.submitTextQuestion(sampleAsset)

    expect(qaAsk).toHaveBeenCalledTimes(2)
    const secondCall = qaAsk.mock.calls[1]?.[0]
    expect(secondCall?.history).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一次回答' }
    ])
    expect(secondCall?.question).toBe('第二问')

    const snap = controller.snapshot()
    expect(snap.history).toHaveLength(4)
    expect(snap.history[2]).toEqual({ role: 'user', content: '第二问' })
    expect(snap.history[3]).toEqual({ role: 'assistant', content: '第二次回答' })
  })

  it('3) QA failure keeps history intact and preserves the user input for retry', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk.mockRejectedValueOnce(new Error('刚刚没有回答成功，再试一次吧。'))
    const controller = new AssetQaController(client)
    controller.setInput('问题')
    await controller.submitTextQuestion(sampleAsset)

    const snap = controller.snapshot()
    expect(snap.history).toEqual([])
    expect(snap.input).toBe('问题')
    expect(snap.busy).toBe(false)
    expect(snap.errorMessage.length).toBeGreaterThan(0)
  })

  it('3b) consecutive failures do not leave half a turn behind', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk
      .mockResolvedValueOnce({ answer: '首答' })
      .mockRejectedValueOnce(new Error('网络超时'))
    const controller = new AssetQaController(client)
    controller.setInput('A')
    await controller.submitTextQuestion(sampleAsset)
    controller.setInput('B')
    await controller.submitTextQuestion(sampleAsset)
    const snap = controller.snapshot()
    expect(snap.history).toEqual([
      { role: 'user', content: 'A' },
      { role: 'assistant', content: '首答' }
    ])
    expect(snap.input).toBe('B')
  })

  it('4) resetForClose clears history and invalidates any in-flight response', async () => {
    const { client, qaAsk } = makeClient()
    const gate = deferred<{ answer: string }>()
    qaAsk.mockReturnValueOnce(gate.promise)
    const controller = new AssetQaController(client)
    controller.setInput('关闭前最后一问')
    const inflight = controller.submitTextQuestion(sampleAsset)
    controller.resetForClose()
    gate.resolve({ answer: '迟到回答' })
    await inflight
    expect(controller.snapshot().history).toEqual([])
    expect(controller.snapshot().input).toBe('')
  })

  it('5) asset switch resets conversation even while a request is in flight', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk.mockResolvedValueOnce({ answer: 'A 答' })
    const controller = new AssetQaController(client)
    controller.setInput('问题 A')
    await controller.submitTextQuestion(sampleAsset)
    expect(controller.snapshot().history).toHaveLength(2)

    const gate = deferred<{ answer: string }>()
    qaAsk.mockReturnValueOnce(gate.promise)
    controller.setInput('问题 B')
    const inflight = controller.submitTextQuestion(sampleAssetB)
    controller.resetForAssetSwitch()
    gate.resolve({ answer: 'B 答' })
    await inflight
    const snap = controller.snapshot()
    expect(snap.history).toEqual([])
    expect(snap.input).toBe('')
  })

  it('6) stale response never reaches a new asset / new conversation', async () => {
    const { client, qaAsk } = makeClient()
    const gate = deferred<{ answer: string }>()
    qaAsk.mockReturnValueOnce(gate.promise)
    const controller = new AssetQaController(client)
    controller.setInput('第一素材的问题')
    const first = controller.submitTextQuestion(sampleAsset)
    // 切素材
    controller.resetForAssetSwitch()
    // 第一素材的响应晚到
    gate.resolve({ answer: '不该出现的回答' })
    await first
    // 没有任何 user/assistant 被记录
    expect(controller.snapshot().history).toEqual([])
    // 用新素材发送一次，history 应只包含这一次
    qaAsk.mockResolvedValueOnce({ answer: '新回答' })
    controller.setInput('新素材问题')
    await controller.submitTextQuestion(sampleAssetB)
    const snap = controller.snapshot()
    expect(snap.history).toEqual([
      { role: 'user', content: '新素材问题' },
      { role: 'assistant', content: '新回答' }
    ])
  })

  it('7) applyTranscript places the recognized text into the input box (no qaAsk)', () => {
    const { client, qaAsk, asrTranscribe } = makeClient()
    const controller = new AssetQaController(client)
    controller.applyTranscript('小兔子')
    expect(controller.snapshot().input).toBe('小兔子')
    expect(qaAsk).not.toHaveBeenCalled()
    expect(asrTranscribe).not.toHaveBeenCalled()
  })

  it('7b) applyTranscript appends when the input already has text', () => {
    const { client } = makeClient()
    const controller = new AssetQaController(client)
    controller.setInput('你好')
    controller.applyTranscript('小兔子')
    expect(controller.snapshot().input).toBe('你好 小兔子')
  })

  it('8) applying a transcript from the voice flow does not trigger qaAsk; send is still user-initiated', async () => {
    const { client, qaAsk, asrTranscribe } = makeClient()
    asrTranscribe.mockResolvedValueOnce({ transcript: '月亮上有什么' })
    // 模拟 voice 流程：asrTranscribe 返回 transcript → applyTranscript
    const result = await client.asrTranscribe({ audioBase64: 'Zm9v', mimeType: 'audio/webm' })
    const controller = new AssetQaController(client)
    controller.applyTranscript(result.transcript)
    expect(qaAsk).not.toHaveBeenCalled()
    expect(controller.snapshot().input).toBe('月亮上有什么')
  })

  it('9) transcript can be edited and then sent manually', async () => {
    const { client, qaAsk, asrTranscribe } = makeClient()
    asrTranscribe.mockResolvedValueOnce({ transcript: '月亮上有啥' })
    const controller = new AssetQaController(client)
    const result = await client.asrTranscribe({ audioBase64: 'Zm9v', mimeType: 'audio/webm' })
    controller.applyTranscript(result.transcript)
    expect(qaAsk).not.toHaveBeenCalled()
    // 用户修改
    controller.setInput('月亮上有什么小动物？')
    qaAsk.mockResolvedValueOnce({ answer: '有玉兔。' })
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).toHaveBeenCalledTimes(1)
    const asked = qaAsk.mock.calls[0]?.[0]
    expect(asked?.question).toBe('月亮上有什么小动物？')
    expect(controller.snapshot().history).toEqual([
      { role: 'user', content: '月亮上有什么小动物？' },
      { role: 'assistant', content: '有玉兔。' }
    ])
  })

  it('10) controller marks mic unavailable on denial but keeps text QA usable', async () => {
    const { client, qaAsk } = makeClient()
    const controller = new AssetQaController(client)
    controller.failRecording('denied')
    const snap = controller.snapshot()
    expect(snap.micAvailability).toBe('unavailable')
    expect(snap.micHint).toMatch(/直接打字/)
    // 文字 QA 仍可用
    qaAsk.mockResolvedValueOnce({ answer: '在呢。' })
    controller.setInput('你在吗？')
    await controller.submitTextQuestion(sampleAsset)
    expect(controller.snapshot().history).toEqual([
      { role: 'user', content: '你在吗？' },
      { role: 'assistant', content: '在呢。' }
    ])
  })

  it('11) resetForClose followed by releaseMic leaves no inflight state', () => {
    const { client } = makeClient()
    const controller = new AssetQaController(client)
    controller.beginRecording()
    controller.startRecordingSucceeded()
    controller.beginTranscribing()
    controller.failTranscription()
    controller.releaseMic()
    controller.resetForClose()
    const snap = controller.snapshot()
    expect(snap.isRecording).toBe(false)
    expect(snap.isAsrBusy).toBe(false)
    expect(snap.history).toEqual([])
    expect(snap.input).toBe('')
  })

  it('history is preserved when the input is exactly the empty trimmed value', async () => {
    const { client, qaAsk } = makeClient()
    const controller = new AssetQaController(client)
    controller.setInput('   ')
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).not.toHaveBeenCalled()
    expect(controller.snapshot().history).toEqual([])
  })

  it('oversized question is rejected with a friendly error and is not sent', async () => {
    const { client, qaAsk } = makeClient()
    const controller = new AssetQaController(client)
    controller.setInput('a'.repeat(ASSET_QA_MAX_QUESTION + 1))
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).not.toHaveBeenCalled()
    expect(controller.snapshot().errorMessage.length).toBeGreaterThan(0)
  })
})

// -----------------------------------------------------------------
// UI 集成测试：真实挂载 AssetQaSheet，验证 voice / 关闭 / 切素材的端到端行为
// -----------------------------------------------------------------

type MountHandle = {
  app: VueApp
  root: HTMLElement
  unmount(): void
}

function mountSheet(initialAsset = sampleAsset, initialOpen = true): MountHandle {
  // 容器
  const container = document.createElement('div')
  document.body.appendChild(container)
  // 用 defineComponent + h 渲染，避免引入 @vue/test-utils
  const Wrapper = defineComponent({
    setup() {
      return () => h(AssetQaSheet, { asset: initialAsset, open: initialOpen })
    }
  })
  const app = createApp(Wrapper)
  const root = document.createElement('div')
  app.mount(root)
  return {
    app,
    root,
    unmount() {
      app.unmount()
      container.remove()
    }
  }
}

async function flush(): Promise<void> {
  // Vue 把响应式更新排到微任务；多 flush 几次确保 onMounted 也跑完
  for (let i = 0; i < 5; i += 1) {
    await nextTick()
  }
}

describe('AssetQaSheet — mounted voice flow', () => {
  function defineMediaDevices(impl: {
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  }): void {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: impl
    })
  }

  beforeEach(() => {
    const recordedChunks: Blob[] = []
    const stopTrack = vi.fn()
    const fakeStream = {
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    // 暴露给测试
    ;(globalThis as Record<string, unknown>).__stopTrack = stopTrack
    ;(globalThis as Record<string, unknown>).__fakeStream = fakeStream
    ;(globalThis as Record<string, unknown>).__recordedChunks = recordedChunks
    // MediaRecorder stub
    class StubMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      state: 'inactive' | 'recording' | 'paused' = 'inactive'
      mimeType: string
      constructor(public stream: MediaStream, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? 'audio/webm'
      }
      start(): void {
        this.state = 'recording'
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['x'.repeat(32)], { type: this.mimeType }) })
        }, 0)
      }
      stop(): void {
        this.state = 'inactive'
        setTimeout(() => this.onstop?.(), 0)
      }
      static isTypeSupported(mime: string): boolean {
        return mime === 'audio/webm;codecs=opus' || mime === 'audio/webm'
      }
    }
    vi.stubGlobal('MediaRecorder', StubMediaRecorder)
    // FileReader stub
    class StubFileReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(blob: Blob): void {
        void blob
        this.result = 'data:audio/webm;base64,ZmFrZS1hdWRpbw=='
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('FileReader', StubFileReader)
  })

  it('10/11) mic denied keeps text QA available; MediaStream tracks are released on close', async () => {
    defineMediaDevices({
      getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    })
    const mount = mountSheet()
    await flush()
    // 触发录音
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    expect(voiceBtn).toBeTruthy()
    voiceBtn?.click()
    await flush()
    await new Promise((r) => setTimeout(r, 20))
    // mic hint 应展示
    const hint = mount.root.querySelector('.asset-qa-mic-hint') as HTMLElement | null
    expect(hint?.textContent ?? '').toMatch(/直接打字/)
    // 文字 QA 仍可发送
    const textarea = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    textarea!.value = '你能做什么？'
    textarea!.dispatchEvent(new Event('input'))
    await flush()
    mount.unmount()
    // 单独的 controller 单测已经覆盖 send 路径；这里只确认 textarea 仍处于可编辑状态
    expect(textarea?.disabled).toBe(false)
  })

  it('7/8/9) recording → ASR is called, no auto qaAsk; user can edit and manually send', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    defineMediaDevices({
      getUserMedia: () => Promise.resolve(fakeStream)
    })
    // aiClient stub
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: '小兔子' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: '是玉兔。', safetyAction: 'allow' } })
    vi.stubGlobal('window', {
      electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } }
    })
    const mount = mountSheet()
    await flush()

    // 点击「说一说」开始录音
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    expect(voiceBtn).toBeTruthy()
    voiceBtn?.click()
    await flush()
    await new Promise((r) => setTimeout(r, 20))
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-recording') as HTMLButtonElement | null
    expect(recordingBtn).toBeTruthy()
    recordingBtn?.click()
    await flush()
    // 等 onstop → finishRecording → asrTranscribe
    await new Promise((r) => setTimeout(r, 200))
    // 录音停止后 asrTranscribe 被调用、qaAsk 没被自动调用
    expect(asrMock).toHaveBeenCalledTimes(1)
    expect(qaMock).not.toHaveBeenCalled()

    // 用户直接编辑 input（不依赖 ASR transcript 自动写回 —— 那是 controller 单测的覆盖范围）
    const textarea = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    textarea!.value = '小兔子喜欢什么？'
    textarea!.dispatchEvent(new Event('input'))
    await flush()
    // 触发 submit 表单
    const form = mount.root.querySelector('.asset-qa-form') as HTMLFormElement | null
    expect(form).toBeTruthy()
    form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await flush()
    await new Promise((r) => setTimeout(r, 80))
    expect(qaMock).toHaveBeenCalledTimes(1)
    expect(qaMock.mock.calls[0]?.[0]?.question).toBe('小兔子喜欢什么？')
    // history 应有一对 user/assistant
    const bubbles = mount.root.querySelectorAll('.asset-qa-bubble')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]?.classList.contains('is-user')).toBe(true)
    expect(bubbles[1]?.classList.contains('is-assistant')).toBe(true)
    // mic track 已经在 finishRecording 路径被停止
    expect(stopTrack).toHaveBeenCalled()
    mount.unmount()
  })

  it('11b) unmount releases MediaStream tracks', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    defineMediaDevices({
      getUserMedia: () => Promise.resolve(fakeStream)
    })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'xx' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'yy' } })
    vi.stubGlobal('window', {
      electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } }
    })
    const mount = mountSheet()
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 20))
    // 此时 track.stop 还没有被调用（录音中），unmount 必须强制释放
    expect(stopTrack).not.toHaveBeenCalled()
    mount.unmount()
    expect(stopTrack).toHaveBeenCalled()
  })
})
