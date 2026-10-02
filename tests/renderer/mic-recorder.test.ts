import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicRecorder } from '../../src/renderer/src/services/voice-input'

class Recorder {
  static isTypeSupported = () => true
  static last: Recorder
  state = 'inactive'
  mimeType = 'audio/webm'
  onstop?: () => void
  onerror?: () => void
  ondataavailable?: (e: { data: Blob }) => void
  constructor() { Recorder.last = this }
  start() { this.state = 'recording' }
  pause() { this.state = 'paused' }
  resume() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice']) }); this.onstop?.() }
}
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const stop = vi.fn(), stream = { getTracks: () => [{ stop }] }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
  vi.stubGlobal('MediaRecorder', Recorder)
  return { stop, stream }
}
describe('Recorder lifetime', () => {
  it('pauses/resumes the same recording and releases microphone on completion', async () => {
    const { stop } = setup(); const mic = new MicRecorder(); await mic.start()
    mic.pause(); expect(Recorder.last.state).toBe('paused')
    mic.resume(); expect(Recorder.last.state).toBe('recording')
    expect((await mic.stop()).blob.size).toBeGreaterThan(0)
    expect(stop).toHaveBeenCalledOnce(); expect(mic.recording).toBe(false)
  })
  it('releases stream on recording error', async () => {
    const { stop } = setup(); const mic = new MicRecorder(); await mic.start()
    Recorder.last.stop = () => Recorder.last.onerror?.()
    await expect(mic.stop()).rejects.toThrow('语音识别')
    expect(stop).toHaveBeenCalledOnce()
  })
  it('cancels a pending permission request without leaving microphone open', async () => {
    const { stop, stream } = setup(); let resolve!: (s: unknown) => void
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r }) } })
    const mic = new MicRecorder(); const pending = mic.start(); mic.cancel(); resolve(stream)
    await expect(pending).rejects.toThrow(); expect(stop).toHaveBeenCalledOnce(); expect(mic.recording).toBe(false)
  })
  it('cancel and restart do not reuse old audio', async () => {
    const { stop } = setup(); const mic = new MicRecorder(); await mic.start(); mic.cancel(); await mic.start()
    expect((await mic.stop()).blob.size).toBe(5); expect(stop).toHaveBeenCalledTimes(2)
  })
  it('ignores late data from a cancelled recorder after a new session begins', async () => {
    setup(); const mic = new MicRecorder(); await mic.start(); const old = Recorder.last
    mic.cancel(); await mic.start()
    old.ondataavailable?.({ data:new Blob(['stale audio']) })
    expect(await (await mic.stop()).blob.text()).toBe('voice')
  })
})
