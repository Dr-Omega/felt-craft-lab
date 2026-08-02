import { describe, expect, it } from 'vitest'
import { validateAsrResult, validateQaResult, validateSharedError, validateTtsResult } from '../../src/shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '../../src/shared/resource/constants'

describe('AI gateway envelopes align with frozen contracts', () => {
  it('accepts AsrResult without latencyMs/empty', () => {
    const r = validateAsrResult({
      transcript: '小兔子',
      provider: 'qwen_cloud_http',
      durationMs: 320,
      audioDurationMs: 1100,
      requestId: 'req-1'
    })
    expect(r.ok).toBe(true)
  })

  it('rejects AsrResult with legacy empty/latencyMs', () => {
    const r = validateAsrResult({
      transcript: 'x',
      provider: 'qwen_cloud_http',
      durationMs: 1,
      latencyMs: 1,
      empty: false
    } as unknown)
    expect(r.ok).toBe(false)
  })

  it('accepts SharedError ASR_EMPTY_TRANSCRIPT', () => {
    const r = validateSharedError({
      code: 'ASR_EMPTY_TRANSCRIPT',
      message: '没有听清内容，请再说一次。',
      retryable: true
    })
    expect(r.ok).toBe(true)
  })

  it('accepts QaResult', () => {
    const r = validateQaResult({
      answer: '适合贴在草地上。',
      safetyAction: 'allow',
      requestId: 'qa-1'
    })
    expect(r.ok).toBe(true)
  })

  it('accepts TtsResult with felt-resource audioUrl', () => {
    const r = validateTtsResult(
      {
        audioUrl: 'felt-resource://audio/mock-name-zh.wav',
        cacheHit: false,
        requestId: 'tts-1'
      },
      FELT_RESOURCE_REF_POLICY
    )
    expect(r.ok).toBe(true)
  })
})
