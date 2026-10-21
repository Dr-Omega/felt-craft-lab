import { describe, expect, it } from 'vitest'
import { StoryRewriteRuleValidator } from '../../src/renderer/src/story-card/story-rewrite-rules.service'

describe('StoryRewriteRuleValidator', () => {
  it('does not impose English word retention as a hard gate to reviewing a story', () => {
    const validator = new StoryRewriteRuleValidator()
    const draft = { workId: 'work-zh', status: 'ready_for_review' as const,
      suggestedTitle: '月饼', suggestedStoryText: '我想吃月饼，和妈妈一起过中秋节。' }
    expect(validator.validate('我想吃月饼，和妈妈一起过中秋节。', draft).status).toBe('ready_for_review')
    expect(validator.validate('I like mooncake.\n我想吃月饼，和妈妈一起过中秋节。', draft)).toMatchObject({
      status: 'ready_for_review'
    })
  })
  it('accepts cleaned Chinese, English, and mixed-language candidate drafts without translating English words', () => {
    const validator = new StoryRewriteRuleValidator()

    expect(
      validator.validate('嗯，我的兔子在 night garden 找朋友。', {
        workId: 'work-mixed',
        status: 'ready_for_review',
        suggestedTitle: '兔子的 Night Garden',
        suggestedStoryText: '我的兔子在 night garden 找朋友。'
      })
    ).toEqual({
      workId: 'work-mixed',
      status: 'ready_for_review',
      suggestedTitle: '兔子的 Night Garden',
      suggestedStoryText: '我的兔子在 night garden 找朋友。'
    })
  })

  it('blocks oral fillers but leaves language fidelity for the editable candidate review', () => {
    const validator = new StoryRewriteRuleValidator()

    expect(
      validator.validate('嗯，小兔子找朋友。', {
        workId: 'work-zh',
        status: 'ready_for_review',
        suggestedTitle: '小兔子的故事',
        suggestedStoryText: '嗯，小兔子找朋友。'
      })
    ).toMatchObject({ status: 'failed', error: { code: 'QA_BLOCKED', retryable: false } })
    expect(
      validator.validate('我的兔子在 night garden 找朋友。', {
        workId: 'work-mixed',
        status: 'ready_for_review',
        suggestedTitle: '兔子的花园',
        suggestedStoryText: '我的兔子在花园找朋友。'
      })
    ).toMatchObject({ status: 'ready_for_review' })
  })

  it('replaces the confirmed child-unfriendly person labels without adding new story facts', () => {
    const validator = new StoryRewriteRuleValidator()

    expect(
      validator.validate('这个笨蛋、傻瓜小兔子遇到了坏蛋和讨厌鬼，它有点坏，也讨厌他。', {
        workId: 'work-child-friendly',
        status: 'ready_for_review',
        suggestedTitle: '笨蛋小兔子的故事',
        suggestedStoryText: '这个笨蛋、傻瓜小兔子遇到了坏蛋和讨厌鬼，它有点坏，也讨厌他。'
      })
    ).toEqual({
      workId: 'work-child-friendly',
      status: 'ready_for_review',
      suggestedTitle: '小迷糊小兔子的故事',
      suggestedStoryText: '这个小迷糊、小迷糊小兔子遇到了不太友好的家伙和不太友好的小伙伴，它调皮，也不喜欢他。'
    })
  })

  it('does not change non-person facts that happen to use the selected words', () => {
    expect(
      new StoryRewriteRuleValidator().validate('小兔子发现玩具坏了，也不喜欢下雨。', {
        workId: 'work-facts-stay',
        status: 'ready_for_review',
        suggestedTitle: '小兔子的发现',
        suggestedStoryText: '小兔子发现玩具坏了，也不喜欢下雨。'
      })
    ).toEqual({
      workId: 'work-facts-stay',
      status: 'ready_for_review',
      suggestedTitle: '小兔子的发现',
      suggestedStoryText: '小兔子发现玩具坏了，也不喜欢下雨。'
    })
  })
})
