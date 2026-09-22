import { describe, expect, it, vi } from 'vitest'
import type { StoryCard, StoryCardRepository } from '../../src/shared/contracts'
import { getStoryCardDetail } from '../../src/renderer/src/story-card/story-card-detail.service'

function card(): StoryCard {
  return {
    workId: 'work-001',
    artworkImageRef: 'felt-resource://preview/work-001.png',
    title: '小兔子的月夜花园',
    storyText: '小兔子在月夜花园里找朋友。',
    originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/original.webm',
    confirmedAt: '2026-09-22T00:00:00.000Z'
  }
}

function repository(value: StoryCard | undefined): StoryCardRepository & {
  getByWorkId: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async (value: StoryCard) => value),
    getByWorkId: vi.fn(async () => value),
    replace: vi.fn(async (value: StoryCard) => value)
  }
}

describe('getStoryCardDetail', () => {
  it('returns only the six confirmed story-card fields', async () => {
    const persisted = {
      ...card(),
      rawTranscript: '这段中间转写不应返回。',
      candidateDraft: { status: 'ready_for_review' },
      partialSupplementAudioRef: 'felt-resource://audio/dynamic/story-card/temp/partial.webm'
    } as StoryCard
    const store = repository(persisted)

    await expect(getStoryCardDetail(' work-001 ', store)).resolves.toEqual(card())
    expect(store.getByWorkId).toHaveBeenCalledWith('work-001')
  })

  it('rejects empty IDs and works without a confirmed card', async () => {
    const emptyStore = repository(card())
    await expect(getStoryCardDetail(' ', emptyStore)).rejects.toMatchObject({
      shared: { code: 'INVALID_ARGUMENT', retryable: false }
    })
    expect(emptyStore.getByWorkId).not.toHaveBeenCalled()

    await expect(getStoryCardDetail('work-001', repository(undefined))).rejects.toMatchObject({
      shared: { code: 'STORY_CARD_NOT_FOUND', retryable: false }
    })
  })
})
