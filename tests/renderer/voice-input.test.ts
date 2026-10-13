import { describe, expect, it } from 'vitest'
import {
  ASR_EMPTY_VOICE_MESSAGE,
  ASR_FAIL_VOICE_MESSAGE,
  ASR_MIC_VOICE_MESSAGE,
  parseAsrEnvelope,
  microphoneFailureMessage
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

  it('preserves actionable non-retryable setup failures rather than calling them network failures', () => {
    expect(parseAsrEnvelope({ ok: false, error: { code: 'UNKNOWN', retryable: false, message: '语音识别服务尚未配置，请联系管理员。' } }))
      .toEqual({ ok: false, reason: 'unavailable', message: '语音识别服务尚未配置，请联系管理员。' })
    expect(parseAsrEnvelope({ ok: false, error: { code: 'REQUEST_CANCELLED', retryable: false } }))
      .toMatchObject({ ok: false, reason: 'cancelled' })
  })

  it('distinguishes microphone permission, missing device and occupied device without exposing raw errors', () => {
    expect(microphoneFailureMessage({ name: 'NotAllowedError', message: 'private details' })).toContain('系统隐私设置')
    expect(microphoneFailureMessage({ name: 'NotFoundError' })).toContain('没有找到麦克风')
    expect(microphoneFailureMessage({ name: 'NotReadableError' })).toContain('占用')
    expect(microphoneFailureMessage(new Error('private details'))).not.toContain('private details')
  })
})
