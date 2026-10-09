import { vi } from 'vitest'
import type { StoryCard, StoryCardRepository, StoryCardWorkContext } from '../../src/shared/contracts'

export function storyCardWorkContext(): StoryCardWorkContext {
  return {
    workId: 'work-001',
    completionStatus: 'completed',
    artworkImageRef: 'felt-resource://preview/latest-work-001.png',
    background: { name: '月夜花园' },
    subject: { name: '小兔子' },
    stickers: []
  }
}

export function confirmedStoryCard(overrides: Partial<StoryCard> = {}): StoryCard {
  return {
    workId: 'work-001',
    artworkImageRef: 'felt-resource://preview/previous-work-001.png',
    title: '旧故事标题',
    storyText: '这是之前确认的故事。',
    originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/previous.webm',
    confirmedAt: '2026-09-21T00:00:00.000Z',
    ...overrides
  }
}

export function storyCardRepository(existing: StoryCard | undefined): StoryCardRepository & {
  create: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async (card: StoryCard) => card),
    getByWorkId: vi.fn(async () => existing),
    replace: vi.fn(async (card: StoryCard) => card)
  }
}
