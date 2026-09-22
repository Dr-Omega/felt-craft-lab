import { describe, expect, it } from 'vitest'
import {
  decideStoryCardContentUpdate,
  type StoryCardContentUpdateChoice
} from '../../src/renderer/src/story-card/story-card-content-update-decision.service'

describe('decideStoryCardContentUpdate', () => {
  it('returns the keep-story action without starting a follow-up flow', () => {
    expect(decideStoryCardContentUpdate('work-001', 'keep_current_story')).toEqual({
      workId: 'work-001',
      type: 'keep_current_story'
    })
  })

  it('returns distinct follow-up actions for full re-recording and partial supplement', () => {
    expect(decideStoryCardContentUpdate('work-001', 'full_rerecording')).toEqual({
      workId: 'work-001',
      type: 'start_full_rerecording',
      inputKind: 'full_rerecording'
    })
    expect(decideStoryCardContentUpdate('work-001', 'partial_supplement')).toEqual({
      workId: 'work-001',
      type: 'start_partial_supplement',
      inputKind: 'partial_supplement'
    })
  })

  it('rejects missing work IDs and unsupported choices', () => {
    expect(() => decideStoryCardContentUpdate(' ', 'keep_current_story')).toThrow(/作品不存在/)
    expect(() =>
      decideStoryCardContentUpdate('work-001', 'unexpected' as StoryCardContentUpdateChoice)
    ).toThrow(/不支持的故事内容更新方式/)
  })
})
