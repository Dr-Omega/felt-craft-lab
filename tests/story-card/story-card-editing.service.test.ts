import { describe, expect, it } from 'vitest'
import type { StoryCardDraft } from '../../src/shared/contracts'
import { prepareStoryCardEditing } from '../../src/renderer/src/story-card/story-card-editing.service'

const readyDraft: StoryCardDraft = {
  workId: 'work-001',
  status: 'ready_for_review',
  suggestedTitle: '小兔子的月夜花园',
  suggestedStoryText: '小兔子在月夜花园里找朋友。'
}

describe('prepareStoryCardEditing', () => {
  it('creates an editable title and story payload from a ready candidate draft', () => {
    const result = prepareStoryCardEditing(readyDraft)

    expect(result).toEqual({
      ok: true,
      payload: {
        workId: 'work-001',
        title: '小兔子的月夜花园',
        storyText: '小兔子在月夜花园里找朋友。'
      }
    })
    if (result.ok) {
      result.payload.title = '小兔子的新故事'
      result.payload.storyText = '小兔子和朋友一起玩。'
      expect(readyDraft).toEqual({
        workId: 'work-001',
        status: 'ready_for_review',
        suggestedTitle: '小兔子的月夜花园',
        suggestedStoryText: '小兔子在月夜花园里找朋友。'
      })
    }
  })

  it('rejects candidate drafts that are not ready for review', () => {
    const draft: StoryCardDraft = {
      workId: 'work-001',
      status: 'needs_more_input',
      followUpQuestions: ['小兔子在做什么呢？', '你最喜欢哪里？']
    }

    expect(prepareStoryCardEditing(draft)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', retryable: false }
    })
  })
})
