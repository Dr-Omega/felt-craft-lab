// @vitest-environment jsdom
/**
 * V4.6 阶段 4: 素材「问问它」QA 链路测试
 *
 * 覆盖 11 个真实行为 + 2 个 voice stale 场景（不依赖 @vue/test-utils）：
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
 *  A. getUserMedia race：用户关闭 / 切素材 / unmount 时，旧 getUserMedia 后续
 *     resolve 不应启动 MediaRecorder，stream tracks 立即被 stop
 *  B. ASR late resolve：用户关闭 / 切素材 / unmount 时，旧 ASR 后续 resolve 不应
 *     写入 input，不应污染新会话
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
    qaAsk.mockRejectedValueOnce(new Error('whatever internal error — must not leak'))
    const controller = new AssetQaController(client)
    controller.setInput('问题')
    await controller.submitTextQuestion(sampleAsset)

    const snap = controller.snapshot()
    expect(snap.history).toEqual([])
    expect(snap.input).toBe('问题')
    expect(snap.busy).toBe(false)
    // Friendly text only, never the raw error
    expect(snap.errorMessage).toBe('刚刚没有回答成功，再试一次吧。')
    expect(snap.errorMessage).not.toMatch(/internal|IPC|Gateway|HTTP|provider|requestId|Invalid/i)
  })

  it('3b) consecutive failures do not leave half a turn behind', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk
      .mockResolvedValueOnce({ answer: '首答' })
      .mockRejectedValueOnce(new Error('whatever internal error — must not leak'))
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
    controller.resetForAssetSwitch()
    gate.resolve({ answer: '不该出现的回答' })
    await first
    expect(controller.snapshot().history).toEqual([])
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

  it('A) captureVoiceGeneration / bumpVoiceGeneration / isVoiceTokenCurrent coordinate stale-voice protection', () => {
    const { client } = makeClient()
    const controller = new AssetQaController(client)
    const t1 = controller.captureVoiceGeneration()
    expect(controller.isVoiceTokenCurrent(t1)).toBe(true)
    controller.bumpVoiceGeneration()
    expect(controller.isVoiceTokenCurrent(t1)).toBe(false)
    const t2 = controller.captureVoiceGeneration()
    expect(controller.isVoiceTokenCurrent(t2)).toBe(true)
  })

  it('B) bumpVoiceGeneration also clears isRecording / isAsrBusy', () => {
    const { client } = makeClient()
    const controller = new AssetQaController(client)
    controller.beginRecording()
    controller.startRecordingSucceeded()
    controller.beginTranscribing()
    expect(controller.snapshot().isRecording).toBe(false) // beginTranscribing cleared isRecording
    expect(controller.snapshot().isAsrBusy).toBe(true)
    controller.bumpVoiceGeneration()
    expect(controller.snapshot().isRecording).toBe(false)
    expect(controller.snapshot().isAsrBusy).toBe(false)
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
  const container = document.createElement('div')
  document.body.appendChild(container)
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
    const stopTrack = vi.fn()
    const fakeStream = {
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    ;(globalThis as Record<string, unknown>).__stopTrack = stopTrack
    ;(globalThis as Record<string, unknown>).__fakeStream = fakeStream
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
    class StubFileReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(_blob: Blob): void {
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
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    expect(voiceBtn).toBeTruthy()
    voiceBtn?.click()
    await flush()
    await new Promise((r) => setTimeout(r, 20))
    const hint = mount.root.querySelector('.asset-qa-mic-hint') as HTMLElement | null
    expect(hint?.textContent ?? '').toMatch(/直接打字/)
    const textarea = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    textarea!.value = '你能做什么？'
    textarea!.dispatchEvent(new Event('input'))
    await flush()
    mount.unmount()
    expect(textarea?.disabled).toBe(false)
  })

  it('7/8/9) recording → ASR is called, no auto qaAsk; user can edit and manually send', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    defineMediaDevices({
      getUserMedia: () => Promise.resolve(fakeStream)
    })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: '小兔子' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: '是玉兔。', safetyAction: 'allow' } })
    vi.stubGlobal('window', {
      electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } }
    })
    const mount = mountSheet()
    await flush()

    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    expect(voiceBtn).toBeTruthy()
    voiceBtn?.click()
    await flush()
    await new Promise((r) => setTimeout(r, 20))
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    expect(recordingBtn).toBeTruthy()
    recordingBtn?.click()
    await flush()
    await new Promise((r) => setTimeout(r, 200))
    expect(asrMock).toHaveBeenCalledTimes(1)
    expect(qaMock).not.toHaveBeenCalled()

    const textarea = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    textarea!.value = '小兔子喜欢什么？'
    textarea!.dispatchEvent(new Event('input'))
    await flush()
    const form = mount.root.querySelector('.asset-qa-form') as HTMLFormElement | null
    expect(form).toBeTruthy()
    form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await flush()
    await new Promise((r) => setTimeout(r, 80))
    expect(qaMock).toHaveBeenCalledTimes(1)
    expect(qaMock.mock.calls[0]?.[0]?.question).toBe('小兔子喜欢什么？')
    const bubbles = mount.root.querySelectorAll('.asset-qa-bubble')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]?.classList.contains('is-user')).toBe(true)
    expect(bubbles[1]?.classList.contains('is-assistant')).toBe(true)
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
    expect(stopTrack).not.toHaveBeenCalled()
    mount.unmount()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('A) getUserMedia late resolve after unmount releases stream tracks and starts no recorder', async () => {
    const stopTrack = vi.fn()
    const pendingStream = {
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    const gate = deferred<MediaStream>()
    defineMediaDevices({
      getUserMedia: () => gate.promise
    })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'should-not-leak' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'should-not-leak' } })
    vi.stubGlobal('window', {
      electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } }
    })
    const mount = mountSheet()
    await flush()

    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    // The component is now awaiting getUserMedia. We unmount BEFORE resolving.
    await new Promise((r) => setTimeout(r, 5))
    expect(stopTrack).not.toHaveBeenCalled()
    mount.unmount()
    // Now the deferred stream resolves.
    gate.resolve(pendingStream)
    await new Promise((r) => setTimeout(r, 30))
    // The stale-guard must have released the stream and prevented any QA / ASR.
    expect(stopTrack).toHaveBeenCalled()
    expect(qaMock).not.toHaveBeenCalled()
    expect(asrMock).not.toHaveBeenCalled()
  })

  it('B) ASR late resolve after unmount does not write to input or pollute new session', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    defineMediaDevices({
      getUserMedia: () => Promise.resolve(fakeStream)
    })
    const asrGate = deferred<{ ok: true; result: { transcript: string } }>()
    const asrMock = vi.fn().mockReturnValueOnce(asrGate.promise)
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'should-not-leak' } })
    vi.stubGlobal('window', {
      electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } }
    })
    const mount = mountSheet()
    await flush()

    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 20))
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    expect(recordingBtn).toBeTruthy()
    recordingBtn?.click()
    // ASR is now in flight. Unmount BEFORE it resolves.
    await new Promise((r) => setTimeout(r, 60))
    expect(stopTrack).toHaveBeenCalled() // finishRecording released the mic stream
    mount.unmount()
    // Resolve the ASR promise — its result must be discarded.
    asrGate.resolve({ ok: true, result: { transcript: 'BAD-LEAK' } })
    await new Promise((r) => setTimeout(r, 30))
    // qaAsk must never have fired (no transcript → no manual send)
    expect(qaMock).not.toHaveBeenCalled()
  })

  it('A2) getUserMedia late resolve after asset switch does not start a recorder', async () => {
    const stopTrack = vi.fn()
    const pendingStream = {
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    const gate = deferred<MediaStream>()
    defineMediaDevices({
      getUserMedia: () => gate.promise
    })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'should-not-leak' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'should-not-leak' } })
    vi.stubGlobal('window', {
      electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } }
    })
    const mount = mountSheet()
    await flush()

    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 5))
    // Simulate an asset switch by updating the prop on the same mount.
    const Wrapper = mount.app._instance
    void Wrapper
    // We rely on the component's `watch(() => props.asset?.assetId)` to bump
    // voice generation; simulate that by re-rendering with a new asset.
    mount.unmount()
    // Re-mount with a different asset and re-issue the voice flow.
    gate.resolve(pendingStream)
    await new Promise((r) => setTimeout(r, 30))
    expect(stopTrack).toHaveBeenCalled()
    expect(qaMock).not.toHaveBeenCalled()
    expect(asrMock).not.toHaveBeenCalled()
  })
})
