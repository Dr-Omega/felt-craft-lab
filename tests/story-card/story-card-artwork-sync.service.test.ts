import { describe, expect, it } from 'vitest'
import type { StoryCard, StoryCardRepository, StoryCardWorkContext } from '../../src/shared/contracts'
import { syncStoryCardArtworkImage } from '../../src/renderer/src/story-card/story-card-artwork-sync.service'

function card(): StoryCard {
  return {
    workId: 'work-story-card-001',
    artworkImageRef: 'felt-resource://preview/original004111811111111111111.png',
    title: '小兔子的花园故事',
    storyText: '小兔子在花园里找朋友。',
    originalAudioRef: 'felt-resource://audio/original004111811111111111111.mp3',
    confirmedAt: '2026-09-21T00:00:00.000Z'
  }
}

function source(artworkImageRef: string): StoryCardWorkContext {
  return {
    workId: 'work-story-card-001',
    completionStatus: 'completed',
    artworkImageRef,
    background: { name: '月夜花园', themeName: '中秋' },
    subject: { name: '小兔子' },
    stickers: [{ name: '灯笼', themeName: '元宵' }]
  }
}

function repository(existing: StoryCard | undefined): {
  repository: StoryCardRepository
  replaced: () => StoryCard | undefined
} {
  let replacement: StoryCard | undefined
  return {
    repository: {
      create: async (value) => value,
      getByWorkId: async () => existing,
      replace: async (value) => {
        replacement = value
        return value
      }
    },
    replaced: () => replacement
  }
}

async function expectStoryCardError(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    expect(error).toMatchObject({ shared: { code, retryable: false } })
    return
  }
  throw new Error(`Expected ${code} error.`)
}

describe('syncStoryCardArtworkImage', () => {
  it('replaces only the artwork image with the newest work preview', async () => {
    const existing = card()
    const latestImage = 'felt-resource://preview/latest00411181111111111111111.png'
    const memory = repository(existing)

    const updated = await syncStoryCardArtworkImage(source(latestImage), memory.repository)

    expect(updated).toEqual({ ...existing, artworkImageRef: latestImage })
    expect(memory.replaced()).toEqual({ ...existing, artworkImageRef: latestImage })
    expect(existing).toEqual(card())
  })

  it('returns STORY_CARD_NOT_FOUND when the completed work has no formal card', async () => {
    const memory = repository(undefined)

    await expectStoryCardError(
      () => syncStoryCardArtworkImage(source('felt-resource://preview/latest00411181111111111111111.png'), memory.repository),
      'STORY_CARD_NOT_FOUND'
    )
    expect(memory.replaced()).toBeUndefined()
  })
})
