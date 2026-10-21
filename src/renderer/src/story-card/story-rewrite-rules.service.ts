import type { StoryCardDraft } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'

const FILLER_WORD = /(?:^|[\s，,])(?:嗯|呃|那个|就是|um|uh)(?=[\s，,。.!?！？]|$)/iu

function childFriendlyText(text: string): string {
  return text
    .replaceAll('笨蛋', '小迷糊')
    .replaceAll('傻瓜', '小迷糊')
    .replaceAll('坏蛋', '不太友好的家伙')
    .replaceAll('讨厌鬼', '不太友好的小伙伴')
    .replace(/(你|他|她|它)(?:很|真|太|有点)?坏/gu, '$1调皮')
    .replace(/坏(?=小(?:兔子|猫|狗|熊)|朋友|家伙|人)/gu, '调皮的')
    .replace(/我(?:很|真|太|有点)?讨厌(?=你|他|她|它|这位|那位|这个|那个)/gu, '我不喜欢')
    .replace(/讨厌(?=你|他|她|它|这位|那位|这个|那个)/gu, '不喜欢')
    .replace(/(你|他|她|它)(?:很|真|太|有点)?讨厌/gu, '$1不太友好')
}

function failed(workId: string, message: string): StoryCardDraft {
  return {
    workId,
    status: 'failed',
    error: toSharedError({ code: 'QA_BLOCKED', message, retryable: false }, 'QA_BLOCKED')
  }
}

/**
 * Guards deterministic rewrite output before it becomes a candidate draft.
 * Structural rewriting itself remains the responsibility of the rewrite adapter.
 */
export class StoryRewriteRuleValidator {
  validate(_sourceText: string, draft: StoryCardDraft): StoryCardDraft {
    if (draft.status !== 'ready_for_review') return draft

    const storyText = childFriendlyText(draft.suggestedStoryText).trim()
    if (!storyText) return failed(draft.workId, '故事整理后没有可供确认的内容。')
    if (FILLER_WORD.test(storyText)) return failed(draft.workId, '故事整理结果仍包含不需要的口语停顿词。')

    return { ...draft, suggestedTitle: childFriendlyText(draft.suggestedTitle).trim(), suggestedStoryText: storyText }
  }
}
