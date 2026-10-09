import { describe, expect, it } from 'vitest'
import type { StoryCardAudioInputRequest } from '../../src/shared/contracts'
import {
  GatewaySpeechRecognitionAdapter,
  MockSpeechRecognitionAdapter,
  type MockSpeechRecognitionFixture
} from '../../src/renderer/src/story-card/speech-recognition.adapter'

function audioInput(overrides: Partial<StoryCardAudioInputRequest> = {}): StoryCardAudioInputRequest {
  return {
    workId: 'work-001',
    kind: 'initial_full_recording',
    audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-zh.webm',
    durationMs: 10_000,
    ...overrides
  }
}

describe('MockSpeechRecognitionAdapter', () => {
  it('returns an intermediate transcript for Chinese, English, and mixed-language recordings', async () => {
    const adapter = new MockSpeechRecognitionAdapter()

    await expect(adapter.transcribe(audioInput())).resolves.toEqual({
      ok: true,
      transcript: {
        workId: 'work-001',
        text: '嗯，我把小兔子放在月夜花园，因为它要去找朋友，然后灯笼亮亮的，它们一起玩。'
      }
    })
    await expect(
      adapter.transcribe(audioInput({ audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-en.webm' }))
    ).resolves.toMatchObject({ ok: true, transcript: { text: expect.stringContaining('My bunny') } })
    await expect(
      adapter.transcribe(audioInput({ audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-mixed.webm' }))
    ).resolves.toMatchObject({ ok: true, transcript: { text: expect.stringContaining('night garden') } })
  })

  it('returns normalized timeout and empty-transcript errors without exposing the audio reference', async () => {
    const adapter = new MockSpeechRecognitionAdapter()
    const emptyFixture: MockSpeechRecognitionFixture = {
      audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-empty.webm',
      transcript: '  '
    }

    await expect(
      adapter.transcribe(audioInput({ audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-timeout.webm' }))
    ).resolves.toMatchObject({ ok: false, error: { code: 'ASR_TIMEOUT', retryable: true } })
    await expect(new MockSpeechRecognitionAdapter([emptyFixture]).transcribe(audioInput({ audioRef: emptyFixture.audioRef }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASR_EMPTY_TRANSCRIPT', retryable: false }
    })
  })

  it('rejects non-audio input at the adapter boundary', async () => {
    const adapter = new MockSpeechRecognitionAdapter()
    const manualInput = {
      workId: 'work-001',
      kind: 'manual_text',
      text: '我想补充一点内容。',
      baseOriginalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/mock.webm'
    }

    await expect(adapter.transcribe(manualInput as unknown as StoryCardAudioInputRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', retryable: false }
    })
  })
})

describe('GatewaySpeechRecognitionAdapter', () => {
  it('matches the Mock adapter domain result and timeout error shape', async () => {
    const readyFixture: MockSpeechRecognitionFixture = {
      audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-contract-ready.webm',
      transcript: '小兔子在月夜花园玩。'
    }
    const timeoutFixture: MockSpeechRecognitionFixture = {
      audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-contract-timeout.webm',
      error: { code: 'ASR_TIMEOUT', message: '请稍后重试。', retryable: true }
    }
    const mock = new MockSpeechRecognitionAdapter([readyFixture, timeoutFixture])
    const reader = { readTemporaryStoryCardAudio: async () => ({ audioBase64: 'dGVzdA==', mimeType: 'audio/webm' as const }) }

    const gatewayReady = new GatewaySpeechRecognitionAdapter(reader, {
      asrTranscribe: async () => ({ ok: true, result: { transcript: readyFixture.transcript } })
    })
    await expect(gatewayReady.transcribe(audioInput({ audioRef: readyFixture.audioRef }))).resolves.toEqual(
      await mock.transcribe(audioInput({ audioRef: readyFixture.audioRef }))
    )

    const gatewayTimeout = new GatewaySpeechRecognitionAdapter(reader, {
      asrTranscribe: async () => ({ ok: false, error: timeoutFixture.error })
    })
    await expect(gatewayTimeout.transcribe(audioInput({ audioRef: timeoutFixture.audioRef }))).resolves.toEqual(
      await mock.transcribe(audioInput({ audioRef: timeoutFixture.audioRef }))
    )
  })

  it('reads a temporary recording and maps the real ASR envelope into an intermediate transcript', async () => {
    let receivedInput: unknown
    const adapter = new GatewaySpeechRecognitionAdapter(
      {
        readTemporaryStoryCardAudio: async () => ({ audioBase64: 'dGVzdA==', mimeType: 'audio/webm' })
      },
      {
        asrTranscribe: async (input) => {
          receivedInput = input
          return { ok: true, result: { transcript: '  小兔子在月夜花园玩。  ' } }
        }
      }
    )

    await expect(adapter.transcribe(audioInput())).resolves.toEqual({
      ok: true,
      transcript: { workId: 'work-001', text: '小兔子在月夜花园玩。' }
    })
    expect(receivedInput).toEqual({ audioBase64: 'dGVzdA==', mimeType: 'audio/webm' })
  })

  it('keeps gateway failures and empty transcripts out of the story processing flow', async () => {
    const reader = { readTemporaryStoryCardAudio: async () => ({ audioBase64: 'dGVzdA==', mimeType: 'audio/webm' as const }) }
    await expect(new GatewaySpeechRecognitionAdapter(reader, {
      asrTranscribe: async () => ({ ok: false, error: { code: 'ASR_TIMEOUT', message: '请稍后重试。', retryable: true } })
    }).transcribe(audioInput())).resolves.toMatchObject({ ok: false, error: { code: 'ASR_TIMEOUT' } })

    await expect(new GatewaySpeechRecognitionAdapter(reader, {
      asrTranscribe: async () => ({ ok: true, result: { transcript: ' ' } })
    }).transcribe(audioInput())).resolves.toMatchObject({ ok: false, error: { code: 'ASR_EMPTY_TRANSCRIPT' } })
  })
})
