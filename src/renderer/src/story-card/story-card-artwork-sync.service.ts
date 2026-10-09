import type { StoryCard, StoryCardRepository, StoryCardWorkContext } from '@shared/contracts'
import { persistenceError } from '../persistence/errors'

export type StoryCardArtworkSource = Pick<StoryCardWorkContext, 'workId' | 'artworkImageRef'>

/**
 * Updates only a confirmed story card's artwork when its completed work gets
 * a newer preview. Story content and the original recording stay unchanged.
 */
export async function syncStoryCardArtworkImage(
  source: StoryCardArtworkSource,
  repository: StoryCardRepository
): Promise<StoryCard> {
  const existing = await repository.getByWorkId(source.workId)
  if (!existing) {
    throw persistenceError('STORY_CARD_NOT_FOUND', '这件作品还没有故事卡。')
  }
  return repository.replace({
    ...existing,
    artworkImageRef: source.artworkImageRef
  })
}
