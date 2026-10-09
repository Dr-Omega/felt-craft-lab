import { describe, expect, it, vi } from 'vitest'
import type { StoryCardDraft, TemporaryFullRecordingInput } from '../../src/shared/contracts'
import {
  processFullRerecording,
  type FullRerecordingStoryProcessor
} from '../../src/renderer/src/story-card/full-rerecording-flow.service'
import { confirmStoryCard } from '../../src/renderer/src/story-card/story-card-confirmation.service'
import { confirmedStoryCard, storyCardRepository, storyCardWorkContext } from './fixtures'

const context = storyCardWorkContext()

const rerecording: TemporaryFullRecordingInput = {
  workId: 'work-001',
  kind: 'full_rerecording',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/rerecording.webm',
  durationMs: 10_000
}

function processor(draft: StoryCardDraft): FullRerecordingStoryProcessor & {
  process: ReturnType<typeof vi.fn>
} {
  return { process: vi.fn(async () => draft) }
}

describe('processFullRerecording', () => {
  it('sends a new complete recording through processing without replacing the formal card', async () => {
    const store = storyCardRepository(confirmedStoryCard())
    const draft: StoryCardDraft = {
      workId: 'work-001',
      status: 'ready_for_review',
      suggestedTitle: '小兔子的新月夜故事',
      suggestedStoryText: '小兔子在月夜花园里又遇见了朋友。'
    }
    const storyProcessor = processor(draft)

    await expect(processFullRerecording({ recording: rerecording, context }, store, storyProcessor)).resolves.toEqual(draft)
    expect(storyProcessor.process).toHaveBeenCalledWith({ input: rerecording, context })
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
  })

  it('requires an existing formal card and a matching complete re-recording before processing', async () => {
    const storyProcessor = processor({ workId: 'work-001', status: 'processing' })
    const noCardStore = storyCardRepository(undefined)

    await expect(processFullRerecording({ recording: rerecording, context }, noCardStore, storyProcessor)).rejects.toMatchObject({
      shared: { code: 'STORY_CARD_NOT_FOUND', retryable: false }
    })
    await expect(
      processFullRerecording(
        { recording: { ...rerecording, kind: 'initial_full_recording' }, context },
        storyCardRepository(confirmedStoryCard()),
        storyProcessor
      )
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    await expect(
      processFullRerecording(
        { recording: rerecording, context: { ...context, workId: 'work-002' } },
        storyCardRepository(confirmedStoryCard()),
        storyProcessor
      )
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    expect(storyProcessor.process).not.toHaveBeenCalled()
  })

  it('replaces the old audio and story only after the re-recorded candidate is explicitly confirmed', async () => {
    const store = storyCardRepository(confirmedStoryCard())
    const draft: StoryCardDraft = {
      workId: 'work-001',
      status: 'ready_for_review',
      suggestedTitle: '小兔子的新月夜故事',
      suggestedStoryText: '小兔子在月夜花园里又遇见了朋友。'
    }
    const storyProcessor = processor(draft)

    await processFullRerecording({ recording: rerecording, context }, store, storyProcessor)
    expect(store.replace).not.toHaveBeenCalled()

    await confirmStoryCard(
      {
        editPayload: {
          workId: draft.workId,
          title: draft.suggestedTitle,
          storyText: draft.suggestedStoryText
        },
        workContext: context,
        confirmedAt: '2026-09-22T00:00:00.000Z',
        recording: rerecording
      },
      store,
      {
        promoteTemporaryFullRecording: async () =>
          'felt-resource://audio/dynamic/story-card/confirmed/rerecording.webm'
      }
    )

    expect(store.replace).toHaveBeenCalledWith({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的新月夜故事',
      storyText: '小兔子在月夜花园里又遇见了朋友。',
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/rerecording.webm',
      confirmedAt: '2026-09-22T00:00:00.000Z'
    })
  })
})
