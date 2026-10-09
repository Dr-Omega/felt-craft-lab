import type { StoryCard, StoryCardRepository } from '@shared/contracts'
import { persistenceError } from '../persistence/errors'

/**
 * Reads a confirmed card through an explicit field whitelist. Intermediate
 * transcripts, candidate drafts, and partial recordings never leave this boundary.
 */
export async function getStoryCardDetail(
  workId: string,
  repository: StoryCardRepository
): Promise<StoryCard> {
  const normalizedWorkId = workId.trim()
  if (!normalizedWorkId) {
    throw persistenceError('INVALID_ARGUMENT', '作品标识不能为空。')
  }

  const card = await repository.getByWorkId(normalizedWorkId)
  if (!card) {
    throw persistenceError('STORY_CARD_NOT_FOUND', '这件作品还没有已确认的故事卡。')
  }

  return {
    workId: card.workId,
    artworkImageRef: card.artworkImageRef,
    title: card.title,
    storyText: card.storyText,
    originalAudioRef: card.originalAudioRef,
    confirmedAt: card.confirmedAt
  }
}
