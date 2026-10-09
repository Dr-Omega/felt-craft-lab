import { describe, expect, it } from 'vitest'
import type { StoryCardWorkContext } from '../../src/shared/contracts'
import { StoryVisualBoundaryValidator } from '../../src/renderer/src/story-card/story-visual-boundary.service'

const context: StoryCardWorkContext = {
  workId: 'work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/work-001.png',
  background: { name: '月夜花园', themeName: '中秋' },
  subject: { name: '小兔子' },
  stickers: [{ name: '灯笼', themeName: '中秋' }]
}

const readyDraft = {
  workId: 'work-001',
  status: 'ready_for_review' as const,
  suggestedTitle: '小兔子的故事',
  suggestedStoryText: '小兔子在月夜花园找朋友。'
}

describe('StoryVisualBoundaryValidator', () => {
  it('keeps a candidate draft when every named work element was mentioned by the child', () => {
    expect(
      new StoryVisualBoundaryValidator().validate('小兔子在月夜花园找朋友。', context, readyDraft)
    ).toEqual(readyDraft)
  })

  it('blocks an unmentioned sticker or background instead of adding it to the story', () => {
    expect(
      new StoryVisualBoundaryValidator().validate('小兔子在月夜花园找朋友。', context, {
        ...readyDraft,
        suggestedStoryText: '小兔子在月夜花园找朋友，灯笼亮亮的。'
      })
    ).toMatchObject({ status: 'failed', error: { code: 'QA_BLOCKED', retryable: false } })
    expect(
      new StoryVisualBoundaryValidator().validate('小兔子找朋友。', context, readyDraft)
    ).toMatchObject({ status: 'failed', error: { code: 'QA_BLOCKED', retryable: false } })
  })

  it('blocks an unmentioned work element in the candidate title', () => {
    expect(
      new StoryVisualBoundaryValidator().validate('小兔子在月夜花园找朋友。', context, {
        ...readyDraft,
        suggestedTitle: '灯笼和小兔子的故事'
      })
    ).toMatchObject({ status: 'failed', error: { code: 'QA_BLOCKED', retryable: false } })
    expect(
      new StoryVisualBoundaryValidator().validate('小兔子在月夜花园找朋友，灯笼亮亮的。', context, {
        ...readyDraft,
        suggestedTitle: '灯笼和小兔子的故事'
      })
    ).toEqual({ ...readyDraft, suggestedTitle: '灯笼和小兔子的故事' })
  })

  it('blocks an unmentioned core event while allowing an event the child already expressed', () => {
    const validator = new StoryVisualBoundaryValidator()
    const sourceText = '小兔子在月夜花园找朋友，后来和朋友一起玩。'

    expect(
      validator.validate(sourceText, context, {
        ...readyDraft,
        suggestedStoryText: '小兔子在月夜花园找朋友，后来和朋友开心地玩了起来。'
      })
    ).toMatchObject({ status: 'ready_for_review' })
    expect(
      validator.validate(sourceText, context, {
        ...readyDraft,
        suggestedStoryText: '小兔子在月夜花园找朋友，后来坐船去森林。'
      })
    ).toMatchObject({ status: 'failed', error: { code: 'QA_BLOCKED', retryable: false } })
  })
})
