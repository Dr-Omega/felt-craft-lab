import type { StoryCardDraft } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'

const FILLER_WORD = /(?:^|[\s，,])(?:嗯|呃|那个|就是|um|uh)(?=[\s，,。.!?！？]|$)/iu
const ENGLISH_WORD = /[A-Za-z]+/g

function childFriendlyText(text: string): string {
  return text.replaceAll('笨蛋', '').replaceAll('坏', '调皮')
}

function failed(workId: string, message: string): StoryCardDraft {
  return {
    workId,
    status: 'failed',
    error: toSharedError({ code: 'QA_BLOCKED', message, retryable: false }, 'QA_BLOCKED')
  }
}

function meaningfulEnglishWords(text: string): string[] {
  return (text.match(ENGLISH_WORD) ?? []).filter((word) => !/^(um|uh)$/iu.test(word))
}

/**
 * Guards deterministic rewrite output before it becomes a candidate draft.
 * Structural rewriting itself remains the responsibility of the rewrite adapter.
 */
export class StoryRewriteRuleValidator {
  validate(sourceText: string, draft: StoryCardDraft): StoryCardDraft {
    if (draft.status !== 'ready_for_review') return draft

    const storyText = childFriendlyText(draft.suggestedStoryText).trim()
    if (!storyText) return failed(draft.workId, '故事整理后没有可供确认的内容。')
    if (FILLER_WORD.test(storyText)) return failed(draft.workId, '故事整理结果仍包含不需要的口语停顿词。')

    const normalizedStoryText = storyText.toLocaleLowerCase()
    if (meaningfulEnglishWords(sourceText).some((word) => !normalizedStoryText.includes(word.toLocaleLowerCase()))) {
      return failed(draft.workId, '故事整理结果没有保留孩子表达中的英文词。')
    }

    return { ...draft, suggestedTitle: childFriendlyText(draft.suggestedTitle).trim(), suggestedStoryText: storyText }
  }
}
