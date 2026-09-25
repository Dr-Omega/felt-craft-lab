import type {
  StoryCardManualTextInputRequest,
  StoryCardWorkContext,
  TemporaryFullRecordingInput,
  TemporaryPartialSupplementInput
} from '@shared/contracts'
import { MockSpeechRecognitionAdapter } from './speech-recognition.adapter'
import { MockStoryRewriteAdapter, type MockStoryRewriteFixture } from './story-rewrite.adapter'
import { StoryProcessingService } from './story-processing.service'

export const STORY_CARD_TEST_READY_TEXT = '我把小兔子放在月夜花园，因为它要去找朋友。灯笼亮亮的，它们一起玩。'
export const STORY_CARD_TEST_INSUFFICIENT_TEXT = '小兔子。'
export const STORY_CARD_TEST_FULL_RERECORDING_TEXT = '小兔子重新讲了月夜花园的故事。灯笼亮亮的，它们一起玩。'
export const STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT = '小兔子想补充说，灯笼亮亮的，它要和朋友一起玩。'
export const STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF = 'felt-resource://audio/dynamic/story-card/temp/mock-full-rerecording.webm'
export const STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF = 'felt-resource://audio/dynamic/story-card/temp/mock-partial-supplement.webm'

export function createTestFullRerecordingInput(workId: string): TemporaryFullRecordingInput {
  return {
    workId,
    kind: 'full_rerecording',
    audioRef: STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF,
    durationMs: 10_000
  }
}

export function createTestPartialSupplementInput(workId: string): TemporaryPartialSupplementInput {
  return {
    workId,
    kind: 'partial_supplement',
    audioRef: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF,
    durationMs: 3_000
  }
}

/** Creates the fixed Phase 5 Mock processor used to display temporary candidate drafts. */
export function createStoryCardTestProcessor(context: StoryCardWorkContext): StoryProcessingService {
  const fixtures: MockStoryRewriteFixture[] = [
    {
      workId: context.workId,
      text: STORY_CARD_TEST_READY_TEXT,
      draft: {
        workId: context.workId,
        status: 'ready_for_review',
        suggestedTitle: '小兔子的月夜花园',
        suggestedStoryText: STORY_CARD_TEST_READY_TEXT
      }
    },
    {
      workId: context.workId,
      text: STORY_CARD_TEST_FULL_RERECORDING_TEXT,
      draft: {
        workId: context.workId,
        status: 'ready_for_review',
        suggestedTitle: '小兔子重新讲月夜花园',
        suggestedStoryText: STORY_CARD_TEST_FULL_RERECORDING_TEXT
      }
    },
    {
      workId: context.workId,
      text: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT,
      draft: {
        workId: context.workId,
        status: 'ready_for_review',
        suggestedTitle: '小兔子的灯笼补充',
        suggestedStoryText: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT
      }
    }
  ]

  return new StoryProcessingService(
    new MockSpeechRecognitionAdapter([
      { audioRef: STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF, transcript: STORY_CARD_TEST_FULL_RERECORDING_TEXT },
      { audioRef: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF, transcript: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT }
    ]),
    new MockStoryRewriteAdapter(fixtures)
  )
}

export function createTestManualTextRequest(
  workId: string,
  text: string,
  originalAudioRef: string
): StoryCardManualTextInputRequest {
  return { workId, kind: 'manual_text', text, baseOriginalAudioRef: originalAudioRef }
}
