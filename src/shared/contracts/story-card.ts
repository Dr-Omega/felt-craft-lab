import type { ResourceRef, UtcIso8601 } from './common'

export interface StoryCardWorkElement {
  name: string
  themeName?: string
}

export interface StoryCardWorkContext {
  workId: string
  completionStatus: 'completed'
  artworkImageRef: ResourceRef
  background: StoryCardWorkElement | null
  subject: StoryCardWorkElement
  stickers: StoryCardWorkElement[]
}

/**
 * A confirmed story card associated with one completed work.
 * Intermediate transcriptions, drafts, and partial recordings do not belong here.
 */
export interface StoryCard {
  workId: string
  artworkImageRef: ResourceRef
  title: string
  storyText: string
  originalAudioRef: ResourceRef
  confirmedAt: UtcIso8601
}

/**
 * Persistence boundary for confirmed story cards.
 * Uniqueness enforcement and storage implementation are introduced by later tasks.
 */
export interface StoryCardRepository {
  create(card: StoryCard): Promise<StoryCard>
  getByWorkId(workId: string): Promise<StoryCard | undefined>
  replace(card: StoryCard): Promise<StoryCard>
}
