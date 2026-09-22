import { describe, expect, it, vi } from 'vitest'
import type {
  StoryCard,
  StoryCardDraft,
  StoryCardRepository,
  StoryCardWorkContext,
  TemporaryPartialSupplementInput
} from '../../src/shared/contracts'
import {
  confirmPartialSupplement,
  processPartialSupplement,
  type PartialSupplementStoryProcessor
} from '../../src/renderer/src/story-card/partial-supplement-flow.service'

const context: StoryCardWorkContext = {
  workId: 'work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/latest-work-001.png',
  background: { name: '月夜花园' },
  subject: { name: '小兔子' },
  stickers: []
}

const supplement: TemporaryPartialSupplementInput = {
  workId: 'work-001',
  kind: 'partial_supplement',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/partial-supplement.webm',
  durationMs: 3_000
}

function formalCard(): StoryCard {
  return {
    workId: 'work-001',
    artworkImageRef: 'felt-resource://preview/previous-work-001.png',
    title: '旧故事标题',
    storyText: '这是之前确认的故事。',
    originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/original-full-recording.webm',
    confirmedAt: '2026-09-21T00:00:00.000Z'
  }
}

function repository(existing: StoryCard | undefined): StoryCardRepository & {
  create: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async (card: StoryCard) => card),
    getByWorkId: vi.fn(async () => existing),
    replace: vi.fn(async (card: StoryCard) => card)
  }
}

function processor(draft: StoryCardDraft): PartialSupplementStoryProcessor & {
  process: ReturnType<typeof vi.fn>
} {
  return { process: vi.fn(async () => draft) }
}

describe('partial supplement flow', () => {
  it('processes a partial supplement into a candidate without changing the formal card', async () => {
    const store = repository(formalCard())
    const draft: StoryCardDraft = {
      workId: 'work-001',
      status: 'ready_for_review',
      suggestedTitle: '小兔子的更新故事',
      suggestedStoryText: '小兔子后来和朋友一起看灯笼。'
    }
    const storyProcessor = processor(draft)

    await expect(processPartialSupplement({ supplement, context }, store, storyProcessor)).resolves.toEqual(draft)
    expect(storyProcessor.process).toHaveBeenCalledWith({ input: supplement, context })
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
  })

  it('updates text after confirmation while preserving the existing original full recording', async () => {
    const original = formalCard()
    const store = repository(original)

    await expect(
      confirmPartialSupplement(
        {
          editPayload: {
            workId: 'work-001',
            title: '小兔子的更新故事',
            storyText: '小兔子后来和朋友一起看灯笼。'
          },
          workContext: context,
          confirmedAt: '2026-09-22T00:00:00.000Z',
          supplement
        },
        store
      )
    ).resolves.toEqual({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的更新故事',
      storyText: '小兔子后来和朋友一起看灯笼。',
      originalAudioRef: original.originalAudioRef,
      confirmedAt: '2026-09-22T00:00:00.000Z'
    })
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).toHaveBeenCalledWith({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的更新故事',
      storyText: '小兔子后来和朋友一起看灯笼。',
      originalAudioRef: original.originalAudioRef,
      confirmedAt: '2026-09-22T00:00:00.000Z'
    })
  })

  it('rejects missing cards, mismatched works, and non-partial inputs without processing or writing', async () => {
    const storyProcessor = processor({ workId: 'work-001', status: 'processing' })

    await expect(processPartialSupplement({ supplement, context }, repository(undefined), storyProcessor)).rejects.toMatchObject({
      shared: { code: 'STORY_CARD_NOT_FOUND', retryable: false }
    })
    await expect(
      processPartialSupplement(
        { supplement: { ...supplement, workId: 'work-002' }, context },
        repository(formalCard()),
        storyProcessor
      )
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    await expect(
      confirmPartialSupplement(
        {
          editPayload: { workId: 'work-001', title: '新标题', storyText: '新故事。' },
          workContext: context,
          confirmedAt: '2026-09-22T00:00:00.000Z',
          supplement: { ...supplement, kind: 'full_rerecording' } as unknown as TemporaryPartialSupplementInput
        },
        repository(formalCard())
      )
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    expect(storyProcessor.process).not.toHaveBeenCalled()
  })
})
