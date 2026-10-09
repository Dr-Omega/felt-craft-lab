import type { StoryCardDraft } from '@shared/contracts'

export type ContentSufficiencyResult =
  | { sufficient: true }
  | { sufficient: false; draft: Extract<StoryCardDraft, { status: 'needs_more_input' }> }

export const MIN_MEANINGFUL_STORY_CHARACTER_COUNT = 12

const FOLLOW_UP_QUESTIONS: [string, string, string] = [
  '小兔子在做什么呢？',
  '你最喜欢这幅画里的哪里？',
  '你想让小兔子和谁一起玩？'
]

function meaningfulCharacterCount(text: string): number {
  return Array.from(text.replace(/[\s.,!?，。！？、；：'"“”‘’()（）]/g, '')).length
}

/**
 * Deterministic MVP guard before story rewrite. A future semantic service can
 * replace this rule without changing the `needs_more_input` candidate boundary.
 */
export class ContentSufficiencyService {
  assess(workId: string, text: string): ContentSufficiencyResult {
    if (meaningfulCharacterCount(text) >= MIN_MEANINGFUL_STORY_CHARACTER_COUNT) return { sufficient: true }

    return {
      sufficient: false,
      draft: {
        workId,
        status: 'needs_more_input',
        followUpQuestions: [...FOLLOW_UP_QUESTIONS] as [string, string, string]
      }
    }
  }
}
