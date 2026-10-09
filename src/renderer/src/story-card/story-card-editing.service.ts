import type { SharedError, StoryCardDraft, StoryCardEditPayload } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'

export type StoryCardEditingResult =
  | { ok: true; payload: StoryCardEditPayload }
  | { ok: false; error: SharedError }

/**
 * Prepares a temporary payload for title and story editing.
 * It does not confirm, persist, or promote any story-card asset.
 */
export function prepareStoryCardEditing(draft: StoryCardDraft): StoryCardEditingResult {
  if (draft.status !== 'ready_for_review') {
    return {
      ok: false,
      error: toSharedError(
        {
          code: 'INVALID_ARGUMENT',
          message: '只有整理完成的候选故事可以编辑。',
          retryable: false
        },
        'INVALID_ARGUMENT'
      )
    }
  }

  return {
    ok: true,
    payload: {
      workId: draft.workId,
      title: draft.suggestedTitle,
      storyText: draft.suggestedStoryText
    }
  }
}
