import { MAX_CREATION_INTENT_TEXT_CHARS } from '@shared/creation-intent'

export type AsrParseResult =
  | { ok: true; transcript: string }
  | { ok: false; message: string; reason: AsrFailReason }

export type AsrFailReason = 'empty' | 'mic' | 'network' | 'unavailable' | 'cancelled' | 'unknown'

/** Child-facing copy for create-asset voice failures. */
export const ASR_EMPTY_VOICE_MESSAGE =
  '没有听清。请靠近麦克风再说一次，也可以在上面打字。'
export const ASR_FAIL_VOICE_MESSAGE =
  '语音识别暂时用不了。请稍后再试，或先在上面打字。'
export const ASR_MIC_VOICE_MESSAGE = '打不开麦克风。请允许使用麦克风，或先在上面打字。'

export function microphoneFailureMessage(error: unknown): string {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有找到麦克风，请连接麦克风，也可以先打字。'
  if (name === 'NotReadableError' || name === 'TrackStartError') return '麦克风正被其他应用占用或无法读取，请关闭占用它的应用后再试。'
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '麦克风权限未开启。请在系统隐私设置中允许 Felt Craft Lab 使用麦克风；也可以先打字。'
  }
  return ASR_MIC_VOICE_MESSAGE
}

export function parseAsrEnvelope(raw: unknown): AsrParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: ASR_FAIL_VOICE_MESSAGE, reason: 'unknown' }
  }
  const env = raw as {
    ok?: unknown
    result?: { transcript?: unknown; empty?: unknown }
    error?: { code?: unknown; message?: unknown; retryable?: unknown }
  }
  if (env.ok === false) {
    const code = env.error?.code
    if (code === 'ASR_EMPTY_TRANSCRIPT' || code === 'RECORDING_EMPTY') {
      return { ok: false, message: ASR_EMPTY_VOICE_MESSAGE, reason: 'empty' }
    }
    if (code === 'MIC_PERMISSION_DENIED') {
      return { ok: false, message: ASR_MIC_VOICE_MESSAGE, reason: 'mic' }
    }
    if (code === 'REQUEST_CANCELLED') return { ok: false, message: '语音识别已取消。', reason: 'cancelled' }
    // Configuration/authentication failures use the frozen UNKNOWN code too.
    // Preserve their safe gateway explanation instead of calling all UNKNOWN errors a network failure.
    if (env.error?.retryable === false) {
      const message = typeof env.error.message === 'string' ? env.error.message.trim() : ''
      return { ok: false, message: message || '语音服务尚未准备好，请联系管理员；也可以先打字。', reason: 'unavailable' }
    }
    if (
      code === 'ASR_TIMEOUT' ||
      code === 'ASR_NETWORK_ERROR' ||
      code === 'UNKNOWN'
    ) {
      return { ok: false, message: ASR_FAIL_VOICE_MESSAGE, reason: 'network' }
    }
    const message = typeof env.error?.message === 'string' ? env.error.message.trim() : ''
    return {
      ok: false,
      message: message || ASR_FAIL_VOICE_MESSAGE,
      reason: 'unknown'
    }
  }
  const transcript = typeof env.result?.transcript === 'string' ? env.result.transcript.trim() : ''
  if (!transcript || env.result?.empty === true) {
    return { ok: false, message: ASR_EMPTY_VOICE_MESSAGE, reason: 'empty' }
  }
  return { ok: true, transcript: transcript.slice(0, MAX_CREATION_INTENT_TEXT_CHARS) }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export class MicRecorder {
  private media: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private generation = 0

  get recording(): boolean {
    return this.media !== null && this.media.state !== 'inactive'
  }

  async start(): Promise<void> {
    if (this.media) await this.stop()
    const generation = ++this.generation
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); throw new Error('录音已取消。') }
      this.stream = stream
    } catch (error) {
      throw new Error(microphoneFailureMessage(error))
    }
    const mimeType = pickRecorderMime()
    const chunks: Blob[] = []
    this.chunks = chunks
    try { this.media = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream) }
    catch { this.cleanup(); throw new Error(ASR_FAIL_VOICE_MESSAGE) }
    this.media.ondataavailable = (event) => {
      if (generation === this.generation && event.data.size > 0) chunks.push(event.data)
    }
    try { this.media.start() } catch { this.cleanup(); throw new Error(ASR_FAIL_VOICE_MESSAGE) }
  }

  pause(): void { if (this.media?.state === 'recording') this.media.pause() }
  resume(): void { if (this.media?.state === 'paused') this.media.resume() }

  async stop(): Promise<{ blob: Blob; mimeType: string }> {
    const media = this.media
    if (!media) throw new Error('还没有开始说话。')
    const chunks = this.chunks
    const blob = await new Promise<Blob>((resolve, reject) => {
      media.onerror = () => reject(new Error(ASR_FAIL_VOICE_MESSAGE))
      media.onstop = () => {
        resolve(new Blob(chunks, { type: media.mimeType || 'audio/webm' }))
      }
      media.stop()
    }).finally(() => { if (this.media === media) this.cleanup() })
    if (blob.size === 0) throw new Error(ASR_EMPTY_VOICE_MESSAGE)
    return { blob, mimeType: blob.type || 'audio/webm' }
  }

  cancel(): void {
    this.generation++
    try {
      if (this.media && this.media.state !== 'inactive') this.media.stop()
    } catch {
      /* ignore */
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.media = null
    this.stream = null
    this.chunks = []
  }
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }
  for (const type of ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return type.split(';')[0]
  }
  return undefined
}
