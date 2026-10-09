import { describe, expect, it } from 'vitest'
import {
  ContentSufficiencyService,
  MIN_MEANINGFUL_STORY_CHARACTER_COUNT
} from '../../src/renderer/src/story-card/content-sufficiency.service'

describe('ContentSufficiencyService', () => {
  it('returns three child-friendly follow-up questions instead of a fabricated story for insufficient content', () => {
    const result = new ContentSufficiencyService().assess('work-needs-more-input', '小兔子。')

    expect(result).toEqual({
      sufficient: false,
      draft: {
        workId: 'work-needs-more-input',
        status: 'needs_more_input',
        followUpQuestions: ['小兔子在做什么呢？', '你最喜欢这幅画里的哪里？', '你想让小兔子和谁一起玩？']
      }
    })
    if (!result.sufficient) {
      expect(result.draft).not.toHaveProperty('suggestedTitle')
      expect(result.draft).not.toHaveProperty('suggestedStoryText')
      expect(result.draft).not.toHaveProperty('error')
    }
  })

  it('accepts text at the documented meaningful-character boundary', () => {
    const sufficientText = '小兔子在月夜花园里找朋友。'
    expect(Array.from(sufficientText.replace(/[\s.,!?，。！？、；：'"“”‘’()（）]/g, '')).length).toBe(MIN_MEANINGFUL_STORY_CHARACTER_COUNT)
    expect(new ContentSufficiencyService().assess('work-001', sufficientText)).toEqual({ sufficient: true })
  })
})
