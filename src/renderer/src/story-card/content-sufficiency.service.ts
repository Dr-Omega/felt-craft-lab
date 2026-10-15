import type { StoryCardDraft } from '@shared/contracts'

export type ContentSufficiencyResult =
  | { sufficient: true }
  | { sufficient: false; draft: Extract<StoryCardDraft, { status: 'failed' }> }

function meaningfulCharacterCount(text: string): number {
  return Array.from(text.replace(/[\s.,!?，。！？、；：'"“”‘’()（）]/g, '')).length
}

/** Reject empty input only; a child's short expression is valid story input. */
export class ContentSufficiencyService {
  assess(workId: string, text: string): ContentSufficiencyResult {
    if (typeof text === 'string' && meaningfulCharacterCount(text) > 0) return { sufficient: true }

    return {
      sufficient: false,
      draft: {
        workId,
        status: 'failed',
        error: { code: 'INVALID_ARGUMENT', message: '请先录音或写下故事内容。', retryable: false }
      }
    }
  }
}
