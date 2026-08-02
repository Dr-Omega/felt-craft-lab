import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeGatewayTts } from '../../src/main/ai/materialize-tts'
import { resolveAiGatewayBaseUrl } from '../../src/main/ai/gateway-client'
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

describe('resolveAiGatewayBaseUrl', () => {
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
})
