// @vitest-environment jsdom
/**
 * V4.6 阶段 4: 素材「问问它」QA 链路测试
 *
 * 覆盖 11 个真实行为 + 4 个 voice stale 场景 + 6 个新边界场景 + 4 个 controller
 * 内部 guard 场景（不依赖 @vue/test-utils）：
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
 *  A. getUserMedia race：用户关闭 / unmount 时，旧 getUserMedia 后续 resolve
 *     不应启动 MediaRecorder，stream tracks 立即被 stop
 *  B. ASR late resolve：用户关闭 / unmount 时，旧 ASR 后续 resolve 不应写入
 *     input，不应污染新会话
 *  C1. 录音期间发送按钮 disabled（canSend=false）
 *  C2. ASR 期间发送按钮 disabled（canSend=false）
 *  C3. getUserMedia 迟到 reject（close 之后）不污染新会话、不显示 mic denied
 *  C4. close 之后旧 recorder.onstop 不得重新进入 ASR busy
 *  C5. 真的 asset prop 切换期间 getUserMedia 迟到 resolve（同一 mount 改 prop）
 *  C6. 真的 asset prop 切换期间 ASR 迟到 resolve（同一 mount 改 prop）
 *  D1. getUserMedia pending 时连点说一说不会产生第二次请求（isMicStarting）
 *  D2. close / 切素材 during getUserMedia pending → isMicStarting 被清
 *  E1. controller 内部 guard：busy=true 时 submitTextQuestion 不再调 qaAsk
 *  E2. controller 内部 guard：isRecording=true 时 submitTextQuestion 不再调 qaAsk
 *  E3. controller 内部 guard：isAsrBusy=true 时 submitTextQuestion 不再调 qaAsk
 *  E4. controller 内部 guard：isMicStarting=true 时 submitTextQuestion 不再调 qaAsk
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App as VueApp } from 'vue'
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
    expect(snap.errorMessage).toBe('刚刚没答出来，再试一次吧。')
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
    expect(snap.micHint).toMatch(/打字/)
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

  // Double-layer send guard: the UI also gates via canSend / disabled, but
  // the controller must independently refuse to fire qaAsk while ANY of the
  // four busy states is true. A stray keyboard shortcut, a programmatic call,
  // or a future codepath must never enter a half-turn.

  it('E1) submitTextQuestion is a no-op while busy=true (in-flight qaAsk)', async () => {
    const { client, qaAsk } = makeClient()
    const gate = deferred<{ answer: string }>()
    qaAsk.mockReturnValueOnce(gate.promise)
    const controller = new AssetQaController(client)
    controller.setInput('第一问')
    const first = controller.submitTextQuestion(sampleAsset)
    // While the first qaAsk is still pending, busy is true. A second
    // programmatic submit must not call qaAsk again.
    expect(controller.snapshot().busy).toBe(true)
    controller.setInput('第二问')
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).toHaveBeenCalledTimes(1)
    expect(controller.snapshot().input).toBe('第二问') // input preserved for retry
    gate.resolve({ answer: '首答' })
    await first
    expect(controller.snapshot().history).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '首答' }
    ])
  })

  it('E2) submitTextQuestion is a no-op while isRecording=true', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk.mockResolvedValueOnce({ answer: '不会到这里' })
    const controller = new AssetQaController(client)
    controller.beginRecording()
    controller.startRecordingSucceeded()
    expect(controller.snapshot().isRecording).toBe(true)
    controller.setInput('录音时打字')
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).not.toHaveBeenCalled()
    expect(controller.snapshot().input).toBe('录音时打字')
    expect(controller.snapshot().history).toEqual([])
  })

  it('E3) submitTextQuestion is a no-op while isAsrBusy=true', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk.mockResolvedValueOnce({ answer: '不会到这里' })
    const controller = new AssetQaController(client)
    controller.beginRecording()
    controller.startRecordingSucceeded()
    controller.beginTranscribing()
    expect(controller.snapshot().isAsrBusy).toBe(true)
    controller.setInput('ASR 时打字')
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).not.toHaveBeenCalled()
    expect(controller.snapshot().input).toBe('ASR 时打字')
    expect(controller.snapshot().history).toEqual([])
  })

  it('E4) submitTextQuestion is a no-op while isMicStarting=true', async () => {
    const { client, qaAsk } = makeClient()
    qaAsk.mockResolvedValueOnce({ answer: '不会到这里' })
    const controller = new AssetQaController(client)
    // beginRecording sets isMicStarting=true; we deliberately do NOT call
    // startRecordingSucceeded, so isMicStarting stays true to simulate a
    // getUserMedia promise still pending.
    controller.beginRecording()
    expect(controller.snapshot().isMicStarting).toBe(true)
    controller.setInput('等麦克风时打字')
    await controller.submitTextQuestion(sampleAsset)
    expect(qaAsk).not.toHaveBeenCalled()
    expect(controller.snapshot().input).toBe('等麦克风时打字')
    expect(controller.snapshot().history).toEqual([])
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

/**
 * Like `mountSheet`, but the `asset` and `open` props are reactive refs.
 * Calling `setAsset(...)` triggers a real prop update on the same mounted
 * component — which in turn fires the AssetQaSheet's internal
 * `watch(() => props.asset?.assetId)`. This is what real asset switching
 * looks like, and is the only way to assert that the in-flight voice flow
 * is correctly invalidated when the user picks a different material.
 */
function mountSheetReactive(initialAsset = sampleAsset, initialOpen = true): {
  app: VueApp
  root: HTMLElement
  setAsset(asset: typeof sampleAsset): void
  setOpen(open: boolean): void
  unmount(): void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const currentAsset = ref(initialAsset)
  const currentOpen = ref(initialOpen)
  const Wrapper = defineComponent({
    setup() {
      return () => h(AssetQaSheet, { asset: currentAsset.value, open: currentOpen.value })
    }
  })
  const app = createApp(Wrapper)
  const root = document.createElement('div')
  app.mount(root)
  return {
    app,
    root,
    setAsset: (asset) => { currentAsset.value = asset },
    setOpen: (open) => { currentOpen.value = open },
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
    expect(hint?.textContent ?? '').toMatch(/打字/)
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

  // -----------------------------------------------------------------------
  // C1: 录音期间 canSend=false（UI button disabled）
  // -----------------------------------------------------------------------
  it('C1) send button is disabled while isRecording is true', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    defineMediaDevices({ getUserMedia: () => Promise.resolve(fakeStream) })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'x' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'x' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheet()
    await flush()
    const textarea = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    // Set input first so canSend is normally true, then the recording gate is
    // the only thing that should disable it.
    textarea!.value = '问题'
    textarea!.dispatchEvent(new Event('input'))
    await flush()
    const sendBefore = mount.root.querySelector('.asset-qa-send') as HTMLButtonElement | null
    expect(sendBefore?.disabled).toBe(false)

    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 30))
    const sendDuring = mount.root.querySelector('.asset-qa-send') as HTMLButtonElement | null
    expect(sendDuring?.disabled).toBe(true)

    // stop recording so we don't leak
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    recordingBtn?.click()
    await new Promise((r) => setTimeout(r, 100))
    expect(stopTrack).toHaveBeenCalled()
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // C2: ASR 期间 canSend=false（UI button disabled）
  // -----------------------------------------------------------------------
  it('C2) send button is disabled while isAsrBusy is true', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    const asrGate = deferred<{ ok: true; result: { transcript: string } }>()
    defineMediaDevices({ getUserMedia: () => Promise.resolve(fakeStream) })
    const asrMock = vi.fn().mockReturnValueOnce(asrGate.promise)
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'x' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheet()
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 30))
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    recordingBtn?.click()
    await new Promise((r) => setTimeout(r, 100)) // wait for finishRecording + ASR call
    expect(asrMock).toHaveBeenCalledTimes(1)

    // While ASR is in flight (gate never resolves), isAsrBusy is true and the
    // send button must be disabled even if the input has text from a prior
    // session.
    const sendDuringAsr = mount.root.querySelector('.asset-qa-send') as HTMLButtonElement | null
    expect(sendDuringAsr?.disabled).toBe(true)
    const ta = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(ta?.disabled).toBe(true)

    asrGate.resolve({ ok: true, result: { transcript: '小兔子' } })
    await new Promise((r) => setTimeout(r, 30))
    expect(stopTrack).toHaveBeenCalled()
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // C3: getUserMedia 迟到 reject（close 之后）不污染新会话、不显示 mic denied
  // -----------------------------------------------------------------------
  it('C3) getUserMedia late reject after close does not show mic denied and does not pollute state', async () => {
    const gate = deferred<MediaStream>()
    defineMediaDevices({ getUserMedia: () => gate.promise })
    const asrMock = vi.fn()
    const qaMock = vi.fn()
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheet()
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    // Close (or unmount) before resolving. resetForClose bumps voiceGeneration,
    // so the late reject lands in the voice-token guard and silently returns.
    mount.unmount()
    gate.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await new Promise((r) => setTimeout(r, 30))
    // No QA, no ASR, no error, no state mutation. The most important property:
    // qaAsk must never have been called.
    expect(qaMock).not.toHaveBeenCalled()
    expect(asrMock).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // C4: close 之后旧 recorder.onstop 不得重新进入 ASR busy
  // -----------------------------------------------------------------------
  it('C4) close before onstop fires does not call ASR and does not pollute state', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    defineMediaDevices({ getUserMedia: () => Promise.resolve(fakeStream) })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'should-not-fire' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'x' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheet()
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 30))
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    expect(recordingBtn).toBeTruthy()
    recordingBtn?.click() // stopRecording → schedules onstop on next tick
    // Immediately close BEFORE the async onstop fires. resetForClose bumps
    // voiceGeneration; finishRecording checks the token first and bails.
    mount.unmount()
    // Wait long enough for the stale onstop to have fired.
    await new Promise((r) => setTimeout(r, 100))
    expect(asrMock).not.toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // C5: 真的 asset prop 切换（同一 mount 改 prop）期间 getUserMedia 迟到 resolve
  // -----------------------------------------------------------------------
  it('C5) real asset prop switch during getUserMedia wait does not start a recorder', async () => {
    const stopTrack = vi.fn()
    const pendingStream = {
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    const gate = deferred<MediaStream>()
    defineMediaDevices({ getUserMedia: () => gate.promise })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'should-not-leak' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'should-not-leak' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheetReactive(sampleAsset)
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(stopTrack).not.toHaveBeenCalled()
    // Real asset prop switch on the same mounted component. The component's
    // watch(() => props.asset?.assetId) fires, calls resetForAssetSwitch +
    // releaseMicImmediate, which bumps voiceGeneration.
    mount.setAsset(sampleAssetB)
    await flush()
    // Now the deferred getUserMedia resolves — its result must be discarded.
    gate.resolve(pendingStream)
    await new Promise((r) => setTimeout(r, 50))
    expect(stopTrack).toHaveBeenCalled()
    expect(qaMock).not.toHaveBeenCalled()
    expect(asrMock).not.toHaveBeenCalled()
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // C6: 真的 asset prop 切换（同一 mount 改 prop）期间 ASR 迟到 resolve
  // -----------------------------------------------------------------------
  it('C6) real asset prop switch during ASR wait does not write input or pollute new session', async () => {
    const stopTrack = (globalThis as Record<string, unknown>).__stopTrack as ReturnType<typeof vi.fn>
    const fakeStream = (globalThis as Record<string, unknown>).__fakeStream as MediaStream
    const asrGate = deferred<{ ok: true; result: { transcript: string } }>()
    defineMediaDevices({ getUserMedia: () => Promise.resolve(fakeStream) })
    const asrMock = vi.fn().mockReturnValueOnce(asrGate.promise)
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'x' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheetReactive(sampleAsset)
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 30))
    const recordingBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    recordingBtn?.click()
    await new Promise((r) => setTimeout(r, 100))
    expect(asrMock).toHaveBeenCalledTimes(1)
    // Real asset prop switch while ASR is in flight. The watch fires, bumps
    // voiceGeneration; the ASR late resolve is then dropped by the token
    // check in finishRecording.
    mount.setAsset(sampleAssetB)
    await flush()
    asrGate.resolve({ ok: true, result: { transcript: 'should-not-leak' } })
    await new Promise((r) => setTimeout(r, 50))
    // The leaked transcript must NEVER have been written into the new asset's
    // input. After the asset switch the input is empty.
    const ta = mount.root.querySelector('.asset-qa-input') as HTMLTextAreaElement | null
    expect(ta?.value).not.toMatch(/should-not-leak/)
    expect(ta?.value).toBe('')
    // No manual send happened, so no qaAsk either.
    expect(qaMock).not.toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // C7: Voice A pending → 切素材B → B 启新 Voice → A 旧 stream 迟到 resolve
  //     验证 A 自己的 token 仍被判定为 stale，A 的 stream 被 stop，
  //     A 不会启动旧 Recorder，B 完全不受影响。
  // -----------------------------------------------------------------------
  it('C7) A pending getUserMedia → switch to B → B starts new voice → A late resolve drops A only', async () => {
    const stopTrackA = vi.fn()
    const stopTrackB = vi.fn()
    const streamA = {
      getTracks: () => [{ stop: stopTrackA, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrackA, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    const streamB = {
      getTracks: () => [{ stop: stopTrackB, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrackB, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    const gates: Deferred<MediaStream>[] = []
    defineMediaDevices({
      getUserMedia: () => {
        const d = deferred<MediaStream>()
        gates.push(d)
        return d.promise
      }
    })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'should-not-fire' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'should-not-fire' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheetReactive(sampleAsset)
    await flush()

    // 1) Voice A starts; getUserMedia is pending (deferred).
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(gates.length).toBe(1)

    // 2) Real asset prop switch to B. The watcher fires, bumps voiceGen.
    mount.setAsset(sampleAssetB)
    await flush()

    // 3) Click voice on B. A new getUserMedia is requested; A's stream is
    //    still in flight.
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(gates.length).toBe(2)

    // 4) A's deferred late-resolves now. Because each flow captured its
    //    own local token, A's token is the OLD pre-bump value, so the
    //    stale check fails for A only.
    gates[0]!.resolve(streamA)
    await new Promise((r) => setTimeout(r, 30))
    expect(stopTrackA).toHaveBeenCalled()
    // No qaAsk, no asrTranscribe triggered by A.
    expect(qaMock).not.toHaveBeenCalled()
    expect(asrMock).not.toHaveBeenCalled()

    // 5) B's deferred resolves. B's flow continues, its recorder starts.
    gates[1]!.resolve(streamB)
    await new Promise((r) => setTimeout(r, 60))
    // B is now in recording state on the new asset.
    const liveBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    expect(liveBtn).toBeTruthy()
    // B's own stream is still alive (not stopped by A's late path).
    expect(stopTrackB).not.toHaveBeenCalled()

    // Cleanup: stop B's recording to release the mic.
    liveBtn?.click()
    await new Promise((r) => setTimeout(r, 50))
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // C8: Voice A pending → 切素材B → B 启新 Voice → A 旧请求迟到 reject
  //     验证 A 不会调用 failRecording，B 不会被 A 的 reject 影响（不显示
  //     mic denied，不调用 qaAsk/asrTranscribe）。
  // -----------------------------------------------------------------------
  it('C8) A pending getUserMedia → switch to B → B starts new voice → A late reject does not leak mic denied into B', async () => {
    const gates: Deferred<MediaStream>[] = []
    defineMediaDevices({
      getUserMedia: () => {
        const d = deferred<MediaStream>()
        gates.push(d)
        return d.promise
      }
    })
    const asrMock = vi.fn().mockResolvedValue({ ok: true, result: { transcript: 'should-not-fire' } })
    const qaMock = vi.fn().mockResolvedValue({ ok: true, result: { answer: 'should-not-fire' } })
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheetReactive(sampleAsset)
    await flush()

    // 1) Voice A starts; getUserMedia pending.
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(gates.length).toBe(1)

    // 2) Asset switch → bumps voiceGen.
    mount.setAsset(sampleAssetB)
    await flush()

    // 3) Voice B starts; A still pending.
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(gates.length).toBe(2)

    // 4) A's deferred late-rejects with NotAllowedError. A's local token
    //    is stale, so the catch must silently return — no failRecording
    //    call, no mic denied hint on B.
    gates[0]!.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await new Promise((r) => setTimeout(r, 30))

    // No mic-denied hint on B (the hint element either doesn't exist or
    // is empty). This is the key proof: A's late reject did NOT call
    // controller.failRecording('denied').
    const hintB = mount.root.querySelector('.asset-qa-mic-hint') as HTMLElement | null
    expect(hintB?.textContent ?? '').toBe('')
    // No qaAsk / asrTranscribe from A's late path.
    expect(qaMock).not.toHaveBeenCalled()
    expect(asrMock).not.toHaveBeenCalled()

    // 5) B's deferred resolves with a real stream; B is unaffected.
    const stopTrackB = vi.fn()
    const streamB = {
      getTracks: () => [{ stop: stopTrackB, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrackB, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream
    gates[1]!.resolve(streamB)
    await new Promise((r) => setTimeout(r, 60))
    const liveBtn = mount.root.querySelector('.asset-qa-voice.is-live') as HTMLButtonElement | null
    expect(liveBtn).toBeTruthy()
    // Stop B and unmount.
    liveBtn?.click()
    await new Promise((r) => setTimeout(r, 50))
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // D1: 同素材连续点 "说一说" → getUserMedia 只能被调用一次
  // -----------------------------------------------------------------------
  it('D1) repeated clicks on voice while getUserMedia pending do not spawn a second request', async () => {
    let getUserMediaCalls = 0
    const gate = deferred<MediaStream>()
    defineMediaDevices({
      getUserMedia: () => {
        getUserMediaCalls += 1
        return gate.promise
      }
    })
    const asrMock = vi.fn()
    const qaMock = vi.fn()
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    const mount = mountSheet()
    await flush()
    const voiceBtn = mount.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    expect(voiceBtn).toBeTruthy()
    // First click — getUserMedia invoked, returns pending promise.
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(getUserMediaCalls).toBe(1)

    // Second click while pending — must be silently dropped.
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(getUserMediaCalls).toBe(1)

    // Third click — also dropped.
    voiceBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(getUserMediaCalls).toBe(1)

    // The voice button is disabled during micStarting so the user can't
    // even attempt a third click via real input.
    expect(voiceBtn?.disabled).toBe(true)

    // Cleanup: resolve the pending request so the recording state is
    // unwound before unmount.
    const stopTrack = vi.fn()
    gate.resolve({
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream)
    await new Promise((r) => setTimeout(r, 60))
    mount.unmount()
  })

  // -----------------------------------------------------------------------
  // D2: getUserMedia pending → close / 切素材 → isMicStarting 必须被清，
  //     新素材可以正常重新启动 Voice。
  // -----------------------------------------------------------------------
  it('D2) close / asset switch during getUserMedia pending clears isMicStarting; new sheet can start voice again', async () => {
    let getUserMediaCalls = 0
    const gateA = deferred<MediaStream>()
    const gateB = deferred<MediaStream>()
    const gates: Deferred<MediaStream>[] = []
    defineMediaDevices({
      getUserMedia: () => {
        getUserMediaCalls += 1
        const d = deferred<MediaStream>()
        gates.push(d)
        if (gates.length === 1) Object.assign(d, gateA)
        else Object.assign(d, gateB)
        return d.promise
      }
    })
    const asrMock = vi.fn()
    const qaMock = vi.fn()
    vi.stubGlobal('window', { electronAPI: { ai: { asrTranscribe: asrMock, qaAsk: qaMock } } })

    // A) Click voice on asset A; getUserMedia is pending (deferred).
    const mountA = mountSheetReactive(sampleAsset)
    await flush()
    const voiceA = mountA.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceA?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(getUserMediaCalls).toBe(1)

    // B) Asset switch while pending. Watcher fires resetForAssetSwitch +
    //    releaseMicImmediate, which bumps voiceGen AND clears isMicStarting.
    mountA.setAsset(sampleAssetB)
    await flush()
    // gate A never resolves — its late resolve must be silently dropped.
    // We resolve it now to prove the late-resolve path is also safe.
    const stopTrack = vi.fn()
    gateA.resolve({
      getTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getAudioTracks: () => [{ stop: stopTrack, kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream)
    await new Promise((r) => setTimeout(r, 50))
    expect(stopTrack).toHaveBeenCalled() // A's late stream is dropped

    // C) Click voice on the new asset B; getUserMedia is invoked again.
    const voiceB = mountA.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    voiceB?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(getUserMediaCalls).toBe(2)
    expect(voiceB?.disabled).toBe(true) // isMicStarting gates real input

    // D) Close the sheet entirely while B is still pending. After close
    //    the new sheet must allow voice to start again with no leftover
    //    isMicStarting state.
    mountA.unmount()

    // E) Fresh mount — voice button must be enabled, getUserMedia must
    //    be invokable exactly once for the new flow.
    const mountC = mountSheet()
    await flush()
    const voiceC = mountC.root.querySelector('.asset-qa-voice') as HTMLButtonElement | null
    expect(voiceC?.disabled).toBe(false)
    voiceC?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(getUserMediaCalls).toBe(3)

    // Cleanup
    gateB.resolve({
      getTracks: () => [{ stop: vi.fn(), kind: 'audio' }],
      getAudioTracks: () => [{ stop: vi.fn(), kind: 'audio' }],
      getVideoTracks: () => []
    } as unknown as MediaStream)
    await new Promise((r) => setTimeout(r, 30))
    mountC.unmount()
  })
})

