import { describe, expect, it } from 'vitest'
import { STORY_CARD_TEST_WORK_CONTEXT } from '../../src/renderer/src/story-card/story-card-test-fixtures'
import {
  STORY_CARD_TEST_INSUFFICIENT_TEXT,
  STORY_CARD_TEST_FULL_RECORDING_TRANSCRIPT,
  STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF,
  STORY_CARD_TEST_FULL_RERECORDING_TEXT,
  STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF,
  STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT,
  STORY_CARD_TEST_READY_TEXT,
  STORY_CARD_TEST_RULE_EXAMPLES,
  createStoryCardTestProcessor,
  createTestFullRerecordingInput,
  createTestPartialSupplementInput,
  createTestManualTextRequest,
  processTestRuleExample,
  processTestManualTextWithFullRecording
} from '../../src/renderer/src/story-card/story-card-test-processing-flow.service'

const audioRef = 'felt-resource://audio/dynamic/story-card/temp/test-recording.webm'

describe('story-card test processing flow', () => {
  it('returns follow-up questions instead of a candidate for insufficient text', async () => {
    const result = await createStoryCardTestProcessor(STORY_CARD_TEST_WORK_CONTEXT).process({
      input: createTestManualTextRequest(STORY_CARD_TEST_WORK_CONTEXT.workId, STORY_CARD_TEST_INSUFFICIENT_TEXT, audioRef),
      context: STORY_CARD_TEST_WORK_CONTEXT
    })

    expect(result).toMatchObject({
      workId: STORY_CARD_TEST_WORK_CONTEXT.workId,
      status: 'needs_more_input',
      followUpQuestions: [expect.any(String), expect.any(String), expect.any(String)]
    })
    expect(result).not.toHaveProperty('suggestedTitle')
    expect(result).not.toHaveProperty('suggestedStoryText')
  })

  it('preserves the fixed recording meaning and naturally joins a later text supplement', async () => {
    const recording = {
      workId: STORY_CARD_TEST_WORK_CONTEXT.workId,
      kind: 'initial_full_recording' as const,
      audioRef,
      durationMs: 3_000
    }

    const result = await processTestManualTextWithFullRecording(
      STORY_CARD_TEST_WORK_CONTEXT,
      recording,
      createTestManualTextRequest(STORY_CARD_TEST_WORK_CONTEXT.workId, STORY_CARD_TEST_READY_TEXT, audioRef)
    )

    expect(result).toMatchObject({
      status: 'ready_for_review',
      suggestedStoryText: `${STORY_CARD_TEST_FULL_RECORDING_TRANSCRIPT}${STORY_CARD_TEST_READY_TEXT}`
    })
  })

  it('processes fixed complete-rerecording and partial-supplement inputs through the same Mock', async () => {
    const processor = createStoryCardTestProcessor(STORY_CARD_TEST_WORK_CONTEXT)

    await expect(processor.process({
      input: createTestFullRerecordingInput(STORY_CARD_TEST_WORK_CONTEXT.workId),
      context: STORY_CARD_TEST_WORK_CONTEXT
    })).resolves.toMatchObject({
      status: 'ready_for_review',
      suggestedTitle: '小兔子重新讲月夜花园',
      suggestedStoryText: STORY_CARD_TEST_FULL_RERECORDING_TEXT
    })
    await expect(processor.process({
      input: createTestPartialSupplementInput(STORY_CARD_TEST_WORK_CONTEXT.workId),
      context: STORY_CARD_TEST_WORK_CONTEXT
    })).resolves.toMatchObject({
      status: 'ready_for_review',
      suggestedTitle: '小兔子的灯笼补充',
      suggestedStoryText: STORY_CARD_TEST_PARTIAL_SUPPLEMENT_TEXT
    })
    expect(STORY_CARD_TEST_FULL_RERECORDING_AUDIO_REF).toContain('/audio/')
    expect(STORY_CARD_TEST_PARTIAL_SUPPLEMENT_AUDIO_REF).toContain('/audio/')
  })

  it('provides inspectable Mock examples for language structure, visual boundaries, and child-friendly wording', async () => {
    for (const example of STORY_CARD_TEST_RULE_EXAMPLES) {
      await expect(processTestRuleExample(STORY_CARD_TEST_WORK_CONTEXT, example.id)).resolves.toMatchObject({
        status: 'ready_for_review',
        suggestedTitle: example.title,
        suggestedStoryText: example.storyText
      })
    }
  })
})
