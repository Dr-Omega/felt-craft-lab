import type {
  StoryCardManualTextInputRequest,
  StoryCardDraft,
  StoryCardWorkContext,
  TemporaryFullRecordingInput,
  TemporaryPartialSupplementInput
} from '@shared/contracts'
import { MockSpeechRecognitionAdapter } from './speech-recognition.adapter'
import { MockStoryRewriteAdapter, type MockStoryRewriteFixture } from './story-rewrite.adapter'
import { StoryProcessingService } from './story-processing.service'

export const STORY_CARD_TEST_READY_TEXT = '他们都很开心。'
export const STORY_CARD_TEST_INSUFFICIENT_TEXT = '小兔子。'
export const STORY_CARD_TEST_FULL_RECORDING_TRANSCRIPT = '小兔子和朋友们在月夜花园里游玩。'
export const STORY_CARD_TEST_FULL_RERECORDING_TEXT = '小兔子重新讲了月夜花园的故事。灯笼亮亮的，它们一起玩。'
export const STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT = '小兔子想补充说，灯笼亮亮的，它要和朋友一起玩。'
export const STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF = 'felt-resource://audio/dynamic/story-card/temp/mock-full-rerecording.webm'
export const STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF = 'felt-resource://audio/dynamic/story-card/temp/mock-partial-supplement.webm'

export const STORY_CARD_TEST_RULE_EXAMPLES = [
  {
    id: 'language-chinese',
    text: '嗯，小兔子在月夜花园里找朋友，然后和朋友一起玩。',
    title: '小兔子的月夜花园',
    storyText: '小兔子在月夜花园里找朋友，然后和朋友一起玩。'
  },
  {
    id: 'language-english',
    text: 'My bunny is in the garden and plays with a friend.',
    title: "Bunny's Garden Story",
    storyText: 'My bunny is in the garden and plays with a friend.'
  },
  {
    id: 'language-mixed',
    text: '我的小兔子在 night garden 里和 friend 一起玩。',
    title: "小兔子的 Night Garden",
    storyText: '我的小兔子在 night garden 里和 friend 一起玩。'
  },
  {
    id: 'visual-boundary',
    text: '小兔子在月夜花园里找朋友。',
    title: '小兔子的月夜花园',
    storyText: '小兔子在月夜花园里找朋友。'
  },
  {
    id: 'child-friendly',
    text: '这个笨蛋小兔子在花园里找朋友，它有点坏，可是后来它一起玩了。',
    title: '花园里的小兔子',
    storyText: '这个小兔子在花园里找朋友。它有点调皮，后来开心地玩了起来。'
  }
] as const

export type StoryCardTestRuleExampleId = typeof STORY_CARD_TEST_RULE_EXAMPLES[number]['id']

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
    },
    ...STORY_CARD_TEST_RULE_EXAMPLES.map((example) => ({
      workId: context.workId,
      text: example.text,
      draft: {
        workId: context.workId,
        status: 'ready_for_review' as const,
        suggestedTitle: example.title,
        suggestedStoryText: example.storyText
      }
    }))
  ]

  return new StoryProcessingService(
    new MockSpeechRecognitionAdapter([
      { audioRef: STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF, transcript: STORY_CARD_TEST_FULL_RERECORDING_TEXT },
      { audioRef: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF, transcript: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT }
    ]),
    new MockStoryRewriteAdapter(fixtures)
  )
}

/** Processes one fixed language, visual-boundary, or child-friendly Mock sample without saving a story card. */
export async function processTestRuleExample(
  context: StoryCardWorkContext,
  id: StoryCardTestRuleExampleId
): Promise<StoryCardDraft> {
  const example = STORY_CARD_TEST_RULE_EXAMPLES.find((candidate) => candidate.id === id)
  if (!example) throw new Error('未找到故事整理规则 Mock 示例。')

  return createStoryCardTestProcessor(context).process({
    input: createTestManualTextRequest(
      context.workId,
      example.text,
      'felt-resource://audio/dynamic/story-card/temp/mock-rule-example.webm'
    ),
    context
  })
}

export function createTestManualTextRequest(
  workId: string,
  text: string,
  originalAudioRef: string
): StoryCardManualTextInputRequest {
  return { workId, kind: 'manual_text', text, baseOriginalAudioRef: originalAudioRef }
}

function joinStoryText(transcript: string, supplement: string): string {
  const first = transcript.trim()
  const next = supplement.trim()
  return `${first}${/[。！？.!?]$/.test(first) ? '' : '。'}${next}`
}

/** Combines the current full-recording Mock transcript with a later text supplement. */
export async function processTestManualTextWithFullRecording(
  context: StoryCardWorkContext,
  recording: TemporaryFullRecordingInput,
  input: StoryCardManualTextInputRequest
): Promise<StoryCardDraft> {
  if (input.text === STORY_CARD_TEST_INSUFFICIENT_TEXT) {
    return createStoryCardTestProcessor(context).process({ input, context })
  }

  const recognition = await new MockSpeechRecognitionAdapter([
    { audioRef: recording.audioRef, transcript: STORY_CARD_TEST_FULL_RECORDING_TRANSCRIPT }
  ]).transcribe(recording)
  if (!recognition.ok) return { workId: input.workId, status: 'failed', error: recognition.error }

  const combinedText = joinStoryText(recognition.transcript.text, input.text)
  return new StoryProcessingService(
    new MockSpeechRecognitionAdapter(),
    new MockStoryRewriteAdapter([
      {
        workId: context.workId,
        text: combinedText,
        draft: {
          workId: context.workId,
          status: 'ready_for_review',
          suggestedTitle: '小兔子的月夜花园',
          suggestedStoryText: combinedText
        }
      }
    ])
  ).processTranscript({ workId: context.workId, text: combinedText, context })
}
