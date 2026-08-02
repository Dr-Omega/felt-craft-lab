import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SharedError, TtsResult } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { buildFeltResourceRef, parseFeltResourceRef } from '@shared/resource'

export type MaterializedTts =
  | { ok: true; result: TtsResult }
  | { ok: false; error: SharedError }

const SAFE_HASH = /^[a-f0-9]{16,64}$/i

function fail(code: SharedError['code'], message: string, retryable = false): MaterializedTts {
  return {
    ok: false,
    error: toSharedError({ code, message, retryable }, code)
  }
}

function decodeAudioBase64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const buf = Buffer.from(value, 'base64')
    return buf.length > 0 ? buf : undefined
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
    writeFileSync(join(dir, `${hash}.mp3`), bytes)
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
