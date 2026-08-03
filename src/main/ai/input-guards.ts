import { toSharedError, type SharedError } from '@shared/contracts/error'

/** Keep in sync with backend guards (or more conservative). */
export const MAX_ASR_AUDIO_BYTES = 5 * 1024 * 1024
export const MAX_ASR_AUDIO_BASE64_CHARS = Math.ceil((MAX_ASR_AUDIO_BYTES * 4) / 3) + 8
export const MAX_QA_CHARS = 500
export const MAX_TTS_CHARS = 500

export const ALLOWED_ASR_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/flac',
  'application/octet-stream'
])

export type IpcGuardResult =
  | { ok: true }
  | { ok: false; error: SharedError }

function invalid(message: string): IpcGuardResult {
  return {
    ok: false,
    error: toSharedError(
      { code: 'INVALID_ARGUMENT', message, retryable: false },
      'INVALID_ARGUMENT'
    )
  }
}

/**
 * Hard limits before any Gateway network call.
 * Rejects oversized base64 before Buffer.from allocates decoded audio.
 */
export function validateAsrIpcInput(input: {
  audioBase64: string
  mimeType: string
}): IpcGuardResult {
  const audioBase64 = input.audioBase64 || ''
  if (!audioBase64.trim()) return invalid('录音数据无效。')
  if (audioBase64.length > MAX_ASR_AUDIO_BASE64_CHARS) return invalid('录音数据过大。')

  const mime = (input.mimeType || '').trim().toLowerCase().split(';')[0]?.trim() || ''
  if (!ALLOWED_ASR_MIME.has(mime)) return invalid('不支持的音频格式。')

  let bytes: Buffer
  try {
    bytes = Buffer.from(audioBase64, 'base64')
  } catch {
    return invalid('录音数据无效。')
  }
  if (!bytes.length) return invalid('录音数据无效。')
  if (bytes.length > MAX_ASR_AUDIO_BYTES) return invalid('录音数据过大。')
  return { ok: true }
}

export function validateQaIpcInput(question: string): IpcGuardResult {
  const text = question || ''
  if (!text.trim()) return invalid('问题不能为空。')
  if (text.length > MAX_QA_CHARS) return invalid('文本过长。')
  return { ok: true }
}

export function validateTtsIpcInput(text: string): IpcGuardResult {
  const value = text || ''
  if (!value.trim()) return invalid('合成文本不能为空。')
  if (value.length > MAX_TTS_CHARS) return invalid('文本过长。')
  return { ok: true }
}
