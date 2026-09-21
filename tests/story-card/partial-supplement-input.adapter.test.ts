import { describe, expect, it } from 'vitest'
import { MAX_RECORDING_DURATION_MS } from '../../src/renderer/src/story-card/recording-session.service'
import { adaptPartialSupplementInput } from '../../src/renderer/src/story-card/partial-supplement-input.adapter'

const partialAudioRef = 'felt-resource://audio/dynamic/story-card/partial-recording.webm'

describe('adaptPartialSupplementInput', () => {
  it('creates a distinct partial_supplement input without full-recording fields', () => {
    const result = adaptPartialSupplementInput({
      workId: ' work-001 ',
      audioRef: partialAudioRef,
      durationMs: 12_000
    })

    expect(result).toEqual({
      ok: true,
      request: {
        workId: 'work-001',
        kind: 'partial_supplement',
        audioRef: partialAudioRef,
        durationMs: 12_000
      }
    })
    if (result.ok) {
      expect(result.request.kind).not.toBe('initial_full_recording')
      expect(result.request.kind).not.toBe('full_rerecording')
      expect(result.request).not.toHaveProperty('baseOriginalAudioRef')
    }
  })

  it('rejects invalid audio refs and durations', () => {
    expect(
      adaptPartialSupplementInput({ workId: 'work-001', audioRef: 'blob:partial', durationMs: 1 })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(
      adaptPartialSupplementInput({ workId: 'work-001', audioRef: partialAudioRef, durationMs: 0 })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
  })

  it('rejects a partial recording longer than five minutes', () => {
    expect(
      adaptPartialSupplementInput({
        workId: 'work-001',
        audioRef: partialAudioRef,
        durationMs: MAX_RECORDING_DURATION_MS + 1
      })
    ).toMatchObject({ ok: false, error: { code: 'AUDIO_TOO_LONG', retryable: false } })
  })
})
