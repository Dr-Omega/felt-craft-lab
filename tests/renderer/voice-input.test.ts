import { describe, expect, it } from 'vitest'
import {
  ASR_EMPTY_VOICE_MESSAGE,
  ASR_FAIL_VOICE_MESSAGE,
  ASR_MIC_VOICE_MESSAGE,
  parseAsrEnvelope
} from '../../src/renderer/src/services/voice-input'

describe('parseAsrEnvelope (create-asset voice copy)', () => {
  it('maps empty transcript errors to child-friendly empty copy', () => {
    const empty = parseAsrEnvelope({
      ok: false,
      error: { code: 'ASR_EMPTY_TRANSCRIPT', message: '没有听清内容，请再说一次。' }
    })
    expect(empty).toEqual({
      ok: false,
      message: ASR_EMPTY_VOICE_MESSAGE,
      reason: 'empty'
    })

    const blankOk = parseAsrEnvelope({ ok: true, result: { transcript: '   ', empty: true } })
    expect(blankOk.ok).toBe(false)
    if (blankOk.ok) return
    expect(blankOk.reason).toBe('empty')
    expect(blankOk.message).toContain('打字')
  })

  it('maps mic and network failures without leaking provider jargon', () => {
    expect(parseAsrEnvelope({ ok: false, error: { code: 'MIC_PERMISSION_DENIED' } })).toEqual({
      ok: false,
      message: ASR_MIC_VOICE_MESSAGE,
      reason: 'mic'
    })
    expect(parseAsrEnvelope({ ok: false, error: { code: 'ASR_TIMEOUT' } })).toEqual({
      ok: false,
      message: ASR_FAIL_VOICE_MESSAGE,
      reason: 'network'
    })
  })

  it('returns trimmed transcript on success', () => {
    const ok = parseAsrEnvelope({ ok: true, result: { transcript: '  黑白熊猫  ', empty: false } })
    expect(ok).toEqual({ ok: true, transcript: '黑白熊猫' })
  })
})
