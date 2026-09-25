import { toSharedError, type SharedError } from '@shared/contracts/error'

/** Keep in sync with backend guards (or more conservative). */
export const MAX_ASR_AUDIO_BYTES = 5 * 1024 * 1024
export const MAX_ASR_AUDIO_BASE64_CHARS = Math.ceil((MAX_ASR_AUDIO_BYTES * 4) / 3) + 8
export const MAX_QA_CHARS = 500
export const MAX_TTS_CHARS = 500
export const MAX_STORY_REWRITE_CHARS = 3000
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8

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

export const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/bmp'])

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

export function validateStoryRewriteIpcInput(input: {
  workId: string
  text: string
  context: Record<string, unknown>
}): IpcGuardResult {
  if (!input.workId.trim() || input.workId.length > 128) return invalid('故事整理作品标识无效。')
  if (!input.text.trim() || input.text.length > MAX_STORY_REWRITE_CHARS) return invalid('故事整理文本无效。')
  const context = input.context
  const subject = context.subject
  const subjectName = subject && typeof subject === 'object'
    ? (subject as Record<string, unknown>).name
    : undefined
  if (
    context.workId !== input.workId ||
    context.completionStatus !== 'completed' ||
    typeof subjectName !== 'string' ||
    !subjectName.trim()
  ) {
    return invalid('故事整理必须使用当前已完成作品的上下文。')
  }
  return { ok: true }
}

export function validateTtsIpcInput(text: string): IpcGuardResult {
  const value = text || ''
  if (!value.trim()) return invalid('合成文本不能为空。')
  if (value.length > MAX_TTS_CHARS) return invalid('文本过长。')
  return { ok: true }
}

export function validateImageUploadIpcInput(input: {
  imageBase64: string
  mimeType: string
  fileName: string
}): IpcGuardResult {
  const imageBase64 = input.imageBase64 || ''
  if (!imageBase64.trim()) return invalid('请选择一张图片。')
  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) return invalid('图片不能超过 10 MB。')

  const mime = (input.mimeType || '').trim().toLowerCase().split(';')[0]?.trim() || ''
  if (!ALLOWED_IMAGE_MIME.has(mime)) return invalid('仅支持 PNG、JPG 和 BMP 图片。')
  if (!input.fileName?.trim() || input.fileName.length > 255) return invalid('图片文件名无效。')

  let bytes: Buffer
  try {
    bytes = Buffer.from(imageBase64, 'base64')
  } catch {
    return invalid('图片数据无效。')
  }
  if (!bytes.length) return invalid('请选择一张图片。')
  if (bytes.length > MAX_IMAGE_BYTES) return invalid('图片不能超过 10 MB。')
  return { ok: true }
}

/**
 * Run a Gateway network call only after IPC input validation succeeds.
 * Used by Main handlers and tests to prove invalid input never touches the network.
 */
export async function withValidatedIpcInput<T>(
  guard: IpcGuardResult,
  networkCall: () => Promise<T>
): Promise<T | { ok: false; error: SharedError }> {
  if (!guard.ok) return { ok: false, error: guard.error }
  return networkCall()
}
