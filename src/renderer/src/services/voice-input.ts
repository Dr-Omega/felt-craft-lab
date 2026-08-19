import { MAX_CREATION_INTENT_TEXT_CHARS } from '@shared/creation-intent'

export type AsrParseResult =
  | { ok: true; transcript: string }
  | { ok: false; message: string }

const EMPTY_VOICE_MESSAGE = '请再说一次。'
const FAIL_VOICE_MESSAGE = '语音识别暂时无法完成，请稍后重试。'

export function parseAsrEnvelope(raw: unknown): AsrParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, message: FAIL_VOICE_MESSAGE }
  const env = raw as {
    ok?: unknown
    result?: { transcript?: unknown }
    error?: { code?: unknown; message?: unknown }
  }
  if (env.ok === false) {
    const code = env.error?.code
    if (code === 'ASR_EMPTY_TRANSCRIPT' || code === 'RECORDING_EMPTY') {
      return { ok: false, message: EMPTY_VOICE_MESSAGE }
    }
    if (code === 'MIC_PERMISSION_DENIED') {
      return { ok: false, message: '打不开麦克风，请允许后重试。' }
    }
    const message = typeof env.error?.message === 'string' ? env.error.message.trim() : ''
    return { ok: false, message: message || FAIL_VOICE_MESSAGE }
  }
  const transcript = typeof env.result?.transcript === 'string' ? env.result.transcript.trim() : ''
  if (!transcript) return { ok: false, message: EMPTY_VOICE_MESSAGE }
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

  get recording(): boolean {
    return this.media !== null && this.media.state !== 'inactive'
  }

  async start(): Promise<void> {
    if (this.media) await this.stop()
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      throw new Error('打不开麦克风，请允许后重试。')
    }
    const mimeType = pickRecorderMime()
    this.chunks = []
    this.media = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream)
    this.media.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.media.start()
  }

  async stop(): Promise<{ blob: Blob; mimeType: string }> {
    const media = this.media
    if (!media) throw new Error('还没有开始说话。')
    const blob = await new Promise<Blob>((resolve, reject) => {
      media.onerror = () => reject(new Error(FAIL_VOICE_MESSAGE))
      media.onstop = () => {
        resolve(new Blob(this.chunks, { type: media.mimeType || 'audio/webm' }))
      }
      media.stop()
    })
    this.cleanup()
    if (blob.size === 0) throw new Error(EMPTY_VOICE_MESSAGE)
    return { blob, mimeType: blob.type || 'audio/webm' }
  }

  cancel(): void {
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
