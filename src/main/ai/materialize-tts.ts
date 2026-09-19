import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { SharedError, TtsResult } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { buildFeltResourceRef, parseFeltResourceRef } from '@shared/resource'

export type MaterializedTts =
  | { ok: true; result: TtsResult }
  | { ok: false; error: SharedError }

const SAFE_HASH = /^[a-f0-9]{16,64}$/i

/** Single dynamic TTS payload cap (decoded bytes). */
export const MAX_DYNAMIC_TTS_BYTES = 2 * 1024 * 1024
/** Reject oversized base64 before Buffer.from allocates decoded memory (~4/3 + padding). */
export const MAX_DYNAMIC_TTS_BASE64_CHARS = Math.ceil((MAX_DYNAMIC_TTS_BYTES * 4) / 3) + 8
const MAX_DYNAMIC_FILES = 100
const MAX_DYNAMIC_TOTAL_BYTES = 80 * 1024 * 1024
const DYNAMIC_TTL_MS = 7 * 24 * 3600 * 1000

function fail(code: SharedError['code'], message: string, retryable = false): MaterializedTts {
  return {
    ok: false,
    error: toSharedError({ code, message, retryable }, code)
  }
}

function decodeAudioBase64(value: unknown): Buffer | 'too_large' | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  // Hard cap on encoded length before decoding.
  if (value.length > MAX_DYNAMIC_TTS_BASE64_CHARS) return 'too_large'
  try {
    const buf = Buffer.from(value, 'base64')
    if (buf.length === 0) return undefined
    if (buf.length > MAX_DYNAMIC_TTS_BYTES) return 'too_large'
    return buf
  } catch {
    return undefined
  }
}

function hashForBytes(bytes: Buffer, requestId: unknown): string {
  if (typeof requestId === 'string' && SAFE_HASH.test(requestId.trim())) {
    return requestId.trim().toLowerCase()
  }
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32)
}

export function pruneDynamicAudioCache(dynamicDir: string): void {
  // Eviction is oldest-mtime + TTL (not a true LRU: cache hits do not touch mtime).
  if (!existsSync(dynamicDir)) return
  const now = Date.now()
  type Entry = { path: string; mtimeMs: number; size: number }
  const entries: Entry[] = []
  for (const name of readdirSync(dynamicDir)) {
    if (!name.endsWith('.mp3')) continue
    const path = join(dynamicDir, name)
    try {
      const st = statSync(path)
      if (now - st.mtimeMs > DYNAMIC_TTL_MS) {
        unlinkSync(path)
        continue
      }
      entries.push({ path, mtimeMs: st.mtimeMs, size: st.size })
    } catch {
      // ignore
    }
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = entries.reduce((sum, e) => sum + e.size, 0)
  while (entries.length > MAX_DYNAMIC_FILES || total > MAX_DYNAMIC_TOTAL_BYTES) {
    const oldest = entries.shift()
    if (!oldest) break
    total -= oldest.size
    try {
      unlinkSync(oldest.path)
    } catch {
      // ignore
    }
  }
}

function atomicWriteFile(path: string, bytes: Buffer): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, bytes)
  renameSync(tmp, path)
}

/**
 * Convert Gateway TTS wire payload into frozen TtsResult for Renderer.
 * - Dynamic audio: Gateway returns audioBase64; Main writes userData/audio/dynamic/<hash>.mp3
 * - Packaged mock fixtures: Gateway may return felt-resource://audio/<file> (never dynamic/)
 * - Reject forged dynamic ResourceRefs and HTTP/relative audio URLs from Gateway
 */
export function materializeGatewayTts(body: unknown, dynamicAudioRoot: string): MaterializedTts {
  if (!body || typeof body !== 'object') {
    return fail('UNKNOWN', '语音合成响应无效。', true)
  }

  const envelope = body as { ok?: unknown; result?: unknown; error?: unknown }
  if (envelope.ok === false) {
    return {
      ok: false,
      error: toSharedError(envelope.error, 'UNKNOWN')
    }
  }

  if (envelope.ok !== true || !envelope.result || typeof envelope.result !== 'object') {
    return fail('UNKNOWN', '语音合成响应无效。', true)
  }

  const result = envelope.result as Record<string, unknown>
  const cacheHit = Boolean(result.cacheHit)
  const requestId = typeof result.requestId === 'string' ? result.requestId : undefined

  const audioUrl = result.audioUrl
  if (typeof audioUrl === 'string' && audioUrl.trim()) {
    const parsed = parseFeltResourceRef(audioUrl)
    if (!parsed || parsed.kind !== 'audio') {
      return fail('INVALID_ARGUMENT', '语音地址无效。')
    }
    if (parsed.relativePath.startsWith('dynamic/')) {
      return fail('INVALID_ARGUMENT', '语音地址无效。')
    }
    return {
      ok: true,
      result: {
        audioUrl: parsed.ref,
        cacheHit,
        ...(requestId ? { requestId } : {})
      }
    }
  }

  const bytes = decodeAudioBase64(result.audioBase64)
  if (bytes === 'too_large') {
    return fail('INVALID_ARGUMENT', '语音数据过大。')
  }
  if (!bytes) {
    return fail('UNKNOWN', '语音合成暂时不可用，请稍后重试。', true)
  }

  const hash = hashForBytes(bytes, requestId)
  const relativePath = `dynamic/${hash}.mp3`
  const ref = buildFeltResourceRef('audio', relativePath)
  if (!ref) {
    return fail('UNKNOWN', '语音合成暂时不可用，请稍后重试。', true)
  }

  try {
    const dir = join(dynamicAudioRoot, 'dynamic')
    mkdirSync(dir, { recursive: true })
    atomicWriteFile(join(dir, `${hash}.mp3`), bytes)
    pruneDynamicAudioCache(dir)
  } catch {
    return fail('UNKNOWN', '语音缓存写入失败，请稍后重试。', true)
  }

  return {
    ok: true,
    result: {
      audioUrl: ref,
      cacheHit,
      requestId: requestId || hash
    }
  }
}
