import type { ResourceRef, SharedError, StoryCardAudioInputRequest } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { parseFeltResourceRef } from '@shared/resource'

export interface IntermediateTranscript {
  workId: string
  text: string
}

export type SpeechRecognitionResult =
  | { ok: true; transcript: IntermediateTranscript }
  | { ok: false; error: SharedError }

export interface SpeechRecognitionAdapter {
  transcribe(input: StoryCardAudioInputRequest): Promise<SpeechRecognitionResult>
}

export interface MockSpeechRecognitionFixture {
  audioRef: ResourceRef
  transcript?: string
  error?: SharedError
}

/** Fixed Phase 3 fixtures cover Chinese, English, mixed-language, and timeout recognition paths. */
export const DEFAULT_SPEECH_RECOGNITION_FIXTURES: readonly MockSpeechRecognitionFixture[] = [
  {
    audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-zh.webm',
    transcript: '嗯，我把小兔子放在月夜花园，因为它要去找朋友，然后灯笼亮亮的，它们一起玩。'
  },
  {
    audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-en.webm',
    transcript: 'My bunny is in the garden because it wants to find a friend. The light is bright and they play together.'
  },
  {
    audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-mixed.webm',
    transcript: '我的小兔子在 night garden 里面找朋友，灯笼像 little stars 一样亮。'
  },
  {
    audioRef: 'felt-resource://audio/dynamic/story-card/temp/mock-timeout.webm',
    error: toSharedError({ code: 'ASR_TIMEOUT', message: '语音识别暂时没有完成，请稍后再试。', retryable: true }, 'ASR_TIMEOUT')
  }
]

function invalid(message: string): SpeechRecognitionResult {
  return { ok: false, error: toSharedError({ code: 'INVALID_ARGUMENT', message, retryable: false }, 'INVALID_ARGUMENT') }
}

function isAudioInput(value: unknown): value is StoryCardAudioInputRequest {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  const parsedAudioRef = parseFeltResourceRef(input.audioRef)
  return (
    typeof input.workId === 'string' &&
    input.workId.trim().length > 0 &&
    (input.kind === 'initial_full_recording' || input.kind === 'full_rerecording' || input.kind === 'partial_supplement') &&
    Boolean(parsedAudioRef && parsedAudioRef.kind === 'audio') &&
    Number.isInteger(input.durationMs) &&
    (input.durationMs as number) > 0
  )
}

/**
 * Deterministic adapter for Phase 3 development. Its result is an intermediate
 * transcript only; it never persists the transcript or returns the audio reference.
 */
export class MockSpeechRecognitionAdapter implements SpeechRecognitionAdapter {
  constructor(private readonly fixtures: readonly MockSpeechRecognitionFixture[] = DEFAULT_SPEECH_RECOGNITION_FIXTURES) {}

  async transcribe(input: StoryCardAudioInputRequest): Promise<SpeechRecognitionResult> {
    if (!isAudioInput(input)) return invalid('语音识别必须接收有效的故事卡音频输入。')

    const fixture = this.fixtures.find((candidate) => candidate.audioRef === input.audioRef)
    if (fixture?.error) return { ok: false, error: toSharedError(fixture.error, 'UNKNOWN') }

    const text = fixture?.transcript?.trim()
    if (!text) {
      return {
        ok: false,
        error: toSharedError({ code: 'ASR_EMPTY_TRANSCRIPT', message: '没有识别到清楚的语音内容，请重新录制。', retryable: false }, 'ASR_EMPTY_TRANSCRIPT')
      }
    }

    return { ok: true, transcript: { workId: input.workId.trim(), text } }
  }
}
