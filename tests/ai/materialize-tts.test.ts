import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_DYNAMIC_TTS_BASE64_CHARS,
  materializeGatewayTts,
  pruneDynamicAudioCache
} from '../../src/main/ai/materialize-tts'
import { resolveAiGatewayBaseUrl } from '../../src/main/ai/gateway-client'
import { resolveAiGatewayBaseUrlResult } from '../../src/main/ai/gateway-config'
import {
  normalizeAsrEnvelope,
  normalizeQaEnvelope,
  normalizeTtsResult
} from '../../src/main/ai/normalize-envelope'
import { validateTtsResult } from '../../src/shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '../../src/shared/resource/constants'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('materializeGatewayTts', () => {
  it('writes audioBase64 to userData dynamic path and returns ResourceRef TtsResult', () => {
    const root = mkdtempSync(join(tmpdir(), 'felt-tts-'))
    tempDirs.push(root)
    const bytes = Buffer.from('fake-mp3-bytes')
    const body = {
      ok: true,
      result: {
        audioBase64: bytes.toString('base64'),
        cacheHit: false,
        requestId: 'abcd1234abcd1234abcd1234abcd1234'
      }
    }
    const out = materializeGatewayTts(body, root)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.audioUrl).toBe(
      'felt-resource://audio/dynamic/abcd1234abcd1234abcd1234abcd1234.mp3'
    )
    const written = readFileSync(
      join(root, 'dynamic', 'abcd1234abcd1234abcd1234abcd1234.mp3')
    )
    expect(Buffer.compare(written, bytes)).toBe(0)
    expect(validateTtsResult(out.result, FELT_RESOURCE_REF_POLICY).ok).toBe(true)
  })

  it('rejects oversized audioBase64 payloads before decode', () => {
    const root = mkdtempSync(join(tmpdir(), 'felt-tts-'))
    tempDirs.push(root)
    // Encoded length over hard cap (do not allocate MAX_DYNAMIC_TTS_BYTES+ decoded buffer).
    const tooLong = 'A'.repeat(MAX_DYNAMIC_TTS_BASE64_CHARS + 1)
    const out = materializeGatewayTts(
      {
        ok: true,
        result: { audioBase64: tooLong, cacheHit: false }
      },
      root
    )
    expect(out.ok).toBe(false)
  })

  it('prunes dynamic cache by oldest mtime + TTL (not true LRU)', () => {
    const root = mkdtempSync(join(tmpdir(), 'felt-tts-'))
    tempDirs.push(root)
    const dir = join(root, 'dynamic')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 105; i += 1) {
      const path = join(dir, `${i.toString().padStart(3, '0')}.mp3`)
      writeFileSync(path, Buffer.from(`x${i}`))
      const past = new Date(Date.now() - (105 - i) * 1000)
      utimesSync(path, past, past)
    }
    pruneDynamicAudioCache(dir)
    expect(readdirSync(dir).filter((n) => n.endsWith('.mp3')).length).toBeLessThanOrEqual(100)
  })

  it('passes through packaged mock ResourceRef but rejects forged dynamic refs from Gateway', () => {
    const root = mkdtempSync(join(tmpdir(), 'felt-tts-'))
    tempDirs.push(root)
    const okMock = materializeGatewayTts(
      {
        ok: true,
        result: {
          audioUrl: 'felt-resource://audio/mock-name-zh.wav',
          cacheHit: true,
          requestId: 'mock-tts'
        }
      },
      root
    )
    expect(okMock.ok).toBe(true)

    const forged = materializeGatewayTts(
      {
        ok: true,
        result: {
          audioUrl: 'felt-resource://audio/dynamic/forged.mp3',
          cacheHit: false
        }
      },
      root
    )
    expect(forged.ok).toBe(false)

    const httpUrl = materializeGatewayTts(
      {
        ok: true,
        result: { audioUrl: '/api/tts/audio/x.mp3', cacheHit: false }
      },
      root
    )
    expect(httpUrl.ok).toBe(false)
  })
})

describe('resolveAiGatewayBaseUrl / config', () => {
  it('defaults to localhost in non-packaged mode', () => {
    const prev = process.env.AI_GATEWAY_BASE_URL
    delete process.env.AI_GATEWAY_BASE_URL
    expect(resolveAiGatewayBaseUrl({ isPackaged: false })).toBe('http://127.0.0.1:8788')
    expect(resolveAiGatewayBaseUrl({ isPackaged: true })).toBe('')
    process.env.AI_GATEWAY_BASE_URL = 'https://ai.example.com/'
    expect(resolveAiGatewayBaseUrl({ isPackaged: true })).toBe('https://ai.example.com')
    if (prev === undefined) delete process.env.AI_GATEWAY_BASE_URL
    else process.env.AI_GATEWAY_BASE_URL = prev
  })

  it('rejects packaged remote http and accepts https / loopback http', () => {
    expect(
      resolveAiGatewayBaseUrlResult({
        isPackaged: true,
        envUrl: 'http://ai.example.com',
        buildTimeUrl: ''
      }).ok
    ).toBe(false)

    expect(
      resolveAiGatewayBaseUrlResult({
        isPackaged: true,
        envUrl: 'https://ai.example.com',
        buildTimeUrl: ''
      })
    ).toEqual({ ok: true, baseUrl: 'https://ai.example.com' })

    expect(
      resolveAiGatewayBaseUrlResult({
        isPackaged: true,
        envUrl: 'http://127.0.0.1:8788',
        buildTimeUrl: ''
      }).ok
    ).toBe(true)

    const missing = resolveAiGatewayBaseUrlResult({
      isPackaged: true,
      envUrl: '',
      buildTimeUrl: ''
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe('unconfigured')
  })
})

describe('normalize envelopes', () => {
  it('accepts valid AsrResult and rejects extra fields / bad shapes', () => {
    const ok = normalizeAsrEnvelope({
      ok: true,
      result: {
        transcript: '你好',
        provider: 'qwen_cloud_http',
        durationMs: 12
      }
    })
    expect(ok.ok).toBe(true)

    const extra = normalizeAsrEnvelope({
      ok: true,
      result: {
        transcript: '你好',
        provider: 'qwen_cloud_http',
        durationMs: 12,
        latencyMs: 99
      }
    })
    expect(extra.ok).toBe(false)

    const badErr = normalizeAsrEnvelope({
      ok: false,
      error: { code: 'NOT_A_REAL_CODE', message: 'x', retryable: false, nested: { a: 1 } }
    })
    expect(badErr.ok).toBe(false)
    if (!badErr.ok) expect(badErr.error.code).toBe('UNKNOWN')
  })

  it('normalizes Qa and Tts results', () => {
    const qa = normalizeQaEnvelope({
      ok: true,
      result: { answer: '可以贴在草地上', safetyAction: 'allow' }
    })
    expect(qa.ok).toBe(true)

    const tts = normalizeTtsResult({
      audioUrl: 'felt-resource://audio/dynamic/abcd1234abcd1234abcd1234abcd1234.mp3',
      cacheHit: false
    })
    expect(tts.ok).toBe(true)
  })
})
