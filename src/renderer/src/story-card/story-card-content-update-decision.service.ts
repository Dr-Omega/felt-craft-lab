import { persistenceError } from '../persistence/errors'

export type StoryCardContentUpdateChoice =
  | 'keep_current_story'
  | 'full_rerecording'
  | 'partial_supplement'

export type StoryCardContentUpdateAction =
  | { workId: string; type: 'keep_current_story' }
  | { workId: string; type: 'start_full_rerecording'; inputKind: 'full_rerecording' }
  | { workId: string; type: 'start_partial_supplement'; inputKind: 'partial_supplement' }

/**
 * Resolves the user's post-artwork-update choice without changing the card.
 * Artwork synchronization is already handled by SC-01-06.
 */
export function decideStoryCardContentUpdate(
  workId: string,
  choice: StoryCardContentUpdateChoice
): StoryCardContentUpdateAction {
  if (!workId.trim()) {
    throw persistenceError('INVALID_ARGUMENT', '作品不存在。')
  }

  switch (choice) {
    case 'keep_current_story':
      return { workId, type: 'keep_current_story' }
    case 'full_rerecording':
      return { workId, type: 'start_full_rerecording', inputKind: 'full_rerecording' }
    case 'partial_supplement':
      return { workId, type: 'start_partial_supplement', inputKind: 'partial_supplement' }
    default:
      throw persistenceError('INVALID_ARGUMENT', '不支持的故事内容更新方式。')
  }
}
