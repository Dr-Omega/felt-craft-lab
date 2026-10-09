import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import type { ResourceRef, SharedError } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { buildFeltResourceRef, parseFeltResourceRef } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceRoots } from '@shared/resource'

export type TemporaryStoryCardAudioSaveResult =
  | { ok: true; ref: ResourceRef }
  | { ok: false; error: SharedError }

export type TemporaryStoryCardAudioDeleteResult = { ok: true } | { ok: false; error: SharedError }

export type TemporaryStoryCardAudioPromoteResult = TemporaryStoryCardAudioSaveResult

export type TemporaryStoryCardAudioReadResult =
  | { ok: true; audioBase64: string; mimeType: 'audio/webm' }
  | { ok: false; error: SharedError }

const TEMPORARY_RECORDING_PREFIX = 'dynamic/story-card/temp/'
const CONFIRMED_RECORDING_PREFIX = 'dynamic/story-card/confirmed/'
const MAX_TRANSCRIBABLE_AUDIO_BYTES = 5 * 1024 * 1024

function fail(code: SharedError['code'], message: string, retryable = false): TemporaryStoryCardAudioSaveResult {
  return { ok: false, error: toSharedError({ code, message, retryable }, code) }
}

function toAudioBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array && value.byteLength > 0) return value
  if (value instanceof ArrayBuffer && value.byteLength > 0) return new Uint8Array(value)
  return undefined
}

function atomicWrite(absolutePath: string, bytes: Uint8Array): void {
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, bytes)
    renameSync(temporaryPath, absolutePath)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // Best effort only; the primary write error is returned to the caller.
    }
    throw error
  }
}

/**
 * Writes an unconfirmed full recording to userData/audio/dynamic/story-card/temp.
 * The returned reference is renderer-safe and never exposes an OS path.
 */
export function saveTemporaryStoryCardAudio(
  rawBytes: unknown,
  mimeType: unknown,
  roots: ResourceRoots
): TemporaryStoryCardAudioSaveResult {
  const bytes = toAudioBytes(rawBytes)
  if (!bytes) return fail('INVALID_ARGUMENT', '临时录音必须包含有效的音频数据。')
  if (typeof mimeType !== 'string' || !mimeType.toLowerCase().startsWith('audio/webm')) {
    return fail('INVALID_ARGUMENT', '临时录音必须使用 audio/webm 格式。')
  }

  const fileName = `${randomUUID().replaceAll('-', '')}.webm`
  const ref = buildFeltResourceRef('audio', `${TEMPORARY_RECORDING_PREFIX}${fileName}`)
  if (!ref) return fail('UNKNOWN', '无法生成临时录音资源引用。', true)

  mkdirSync(`${roots.audioDynamicRoot}/dynamic/story-card/temp`, { recursive: true })
  const resolved = resolveFeltResourcePath(ref, roots, { requireExists: false })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.kind !== 'audio' || !resolved.relativePath.startsWith(TEMPORARY_RECORDING_PREFIX)) {
    return fail('INVALID_ARGUMENT', '临时录音只能写入故事卡音频资源空间。')
  }

  try {
    atomicWrite(resolved.absolutePath, bytes)
  } catch {
    return fail('UNKNOWN', '临时录音写入失败，请稍后重试。', true)
  }

  return { ok: true, ref }
}

/**
 * Reads only an unconfirmed story-card recording for the AI transcription bridge.
 * It accepts a renderer-safe resource ref and never exposes an OS file path.
 */
export function readTemporaryStoryCardAudio(
  rawRef: unknown,
  roots: ResourceRoots
): TemporaryStoryCardAudioReadResult {
  if (typeof rawRef !== 'string') {
    return { ok: false, error: toSharedError({ code: 'INVALID_ARGUMENT', message: '临时录音引用必须是字符串。', retryable: false }) }
  }

  const parsed = parseFeltResourceRef(rawRef)
  if (!parsed || parsed.kind !== 'audio' || !parsed.relativePath.startsWith(TEMPORARY_RECORDING_PREFIX)) {
    return { ok: false, error: toSharedError({ code: 'INVALID_ARGUMENT', message: '只能转写故事卡临时完整录音。', retryable: false }) }
  }

  const resolved = resolveFeltResourcePath(parsed.ref, roots, { requireExists: true })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  try {
    if (statSync(resolved.absolutePath).size > MAX_TRANSCRIBABLE_AUDIO_BYTES) {
      return { ok: false, error: toSharedError({ code: 'AUDIO_TOO_LONG', message: '录音数据过大，暂时无法转写。', retryable: false }) }
    }
    return { ok: true, audioBase64: readFileSync(resolved.absolutePath).toString('base64'), mimeType: 'audio/webm' }
  } catch {
    return { ok: false, error: toSharedError({ code: 'UNKNOWN', message: '临时录音读取失败，请稍后重试。', retryable: true }) }
  }
}

/** Moves a saved temporary full recording into the protected confirmed namespace. */
export function promoteTemporaryStoryCardAudio(
  rawRef: unknown,
  roots: ResourceRoots
): TemporaryStoryCardAudioPromoteResult {
  if (typeof rawRef !== 'string') return fail('INVALID_ARGUMENT', '临时录音引用必须是字符串。')

  const parsed = parseFeltResourceRef(rawRef)
  if (!parsed || parsed.kind !== 'audio' || !parsed.relativePath.startsWith(TEMPORARY_RECORDING_PREFIX)) {
    return fail('INVALID_ARGUMENT', '只有未确认的故事卡完整录音可以确认。')
  }

  const fileName = parsed.relativePath.slice(TEMPORARY_RECORDING_PREFIX.length)
  if (!/^[a-f0-9]+\.webm$/.test(fileName)) {
    return fail('INVALID_ARGUMENT', '临时录音引用格式无效。')
  }

  const confirmedRef = buildFeltResourceRef('audio', `${CONFIRMED_RECORDING_PREFIX}${fileName}`)
  if (!confirmedRef) return fail('UNKNOWN', '无法生成正式原始音频引用。', true)

  const source = resolveFeltResourcePath(parsed.ref, roots, { requireExists: false })
  if (!source.ok) return { ok: false, error: source.error }
  const destination = resolveFeltResourcePath(confirmedRef, roots, { requireExists: false })
  if (!destination.ok) return { ok: false, error: destination.error }
  if (destination.kind !== 'audio' || !destination.relativePath.startsWith(CONFIRMED_RECORDING_PREFIX)) {
    return fail('INVALID_ARGUMENT', '正式原始音频只能写入受保护的故事卡音频空间。')
  }

  try {
    // A DB write may fail after the file move. Retrying confirmation must reuse
    // the exact promoted recording, not lose the child's recording.
    if (!source.exists && destination.exists) return { ok: true, ref: confirmedRef }
    if (!source.exists) return fail('AUDIO_LOAD_FAILED', '待确认的录音不存在。')
    mkdirSync(`${roots.audioDynamicRoot}/dynamic/story-card/confirmed`, { recursive: true })
    renameSync(source.absolutePath, destination.absolutePath)
    return { ok: true, ref: confirmedRef }
  } catch {
    return fail('UNKNOWN', '完整录音确认失败，请稍后重试。', true)
  }
}

/** Deletes only unconfirmed story-card audio resources; it never accepts OS paths or other audio refs. */
export function deleteTemporaryStoryCardAudio(
  rawRef: unknown,
  roots: ResourceRoots
): TemporaryStoryCardAudioDeleteResult {
  if (typeof rawRef !== 'string') {
    return { ok: false, error: toSharedError({ code: 'INVALID_ARGUMENT', message: '临时录音引用必须是字符串。', retryable: false }) }
  }

  const parsed = parseFeltResourceRef(rawRef)
  if (!parsed || parsed.kind !== 'audio' || !parsed.relativePath.startsWith(TEMPORARY_RECORDING_PREFIX)) {
    return { ok: false, error: toSharedError({ code: 'INVALID_ARGUMENT', message: '只能删除故事卡临时录音。', retryable: false }) }
  }

  const resolved = resolveFeltResourcePath(parsed.ref, roots, { requireExists: false })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  try {
    if (!resolved.exists) return { ok: true }
    unlinkSync(resolved.absolutePath)
    return { ok: true }
  } catch {
    return { ok: false, error: toSharedError({ code: 'UNKNOWN', message: '临时录音删除失败，请稍后重试。', retryable: true }) }
  }
}
