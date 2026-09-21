import { describe, expect, it } from 'vitest'
import type { TemporaryFullRecordingInput } from '../../src/shared/contracts'
import { adaptManualTextSupplement } from '../../src/renderer/src/story-card/manual-text-input.adapter'

const fullRecording: TemporaryFullRecordingInput = {
  workId: 'work-001',
  kind: 'initial_full_recording',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/recording.webm',
  durationMs: 10_000
}

describe('adaptManualTextSupplement', () => {
  it('creates a text-only story processing request linked to an existing full recording', () => {
    const result = adaptManualTextSupplement({
      workId: ' work-001 ',
      text: '  小兔子在花园里找朋友。  ',
      fullRecording
    })

    expect(result).toEqual({
      ok: true,
      request: {
        workId: 'work-001',
        kind: 'manual_text',
        text: '小兔子在花园里找朋友。',
        baseOriginalAudioRef: fullRecording.audioRef
      }
    })
    if (result.ok) {
      expect(result.request).not.toHaveProperty('audioRef')
      expect(result.request).not.toHaveProperty('durationMs')
    }
  })

  it('rejects empty text with the shared EMPTY_INPUT error', () => {
    expect(
      adaptManualTextSupplement({ workId: 'work-001', text: '  ', fullRecording })
    ).toMatchObject({
      ok: false,
      error: { code: 'EMPTY_INPUT', retryable: false }
    })
  })

  it('also accepts a full re-recording', () => {
    expect(
      adaptManualTextSupplement({
        workId: 'work-001',
        text: '我重新录了一遍，还想补充一点内容。',
        fullRecording: { ...fullRecording, kind: 'full_rerecording' }
      })
    ).toMatchObject({ ok: true, request: { kind: 'manual_text', baseOriginalAudioRef: fullRecording.audioRef } })
  })

  it('requires an application-managed audio ref for the existing full recording', () => {
    expect(
      adaptManualTextSupplement({
        workId: 'work-001',
        text: '我想补充一点内容。',
        fullRecording: { ...fullRecording, audioRef: 'blob:temporary-recording' }
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', retryable: false }
    })
  })

  it('rejects partial recordings and full recordings from another work', () => {
    expect(
      adaptManualTextSupplement({
        workId: 'work-001',
        text: '我想补充一点内容。',
        fullRecording: { ...fullRecording, kind: 'partial_supplement' } as unknown as TemporaryFullRecordingInput
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', retryable: false } })

    expect(
      adaptManualTextSupplement({
        workId: 'work-001',
        text: '我想补充一点内容。',
        fullRecording: { ...fullRecording, workId: 'work-002' }
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', retryable: false } })
  })
})
