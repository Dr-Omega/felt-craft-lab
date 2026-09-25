import mockDataset from '../../docs/story-card/phase-0/测试数据/SC-00-07_故事处理Mock数据集.json'
import { describe, expect, it } from 'vitest'
import type { StoryCardDraft, StoryCardWorkContext } from '../../src/shared/contracts'
import {
  GatewayStoryRewriteAdapter,
  MockStoryRewriteAdapter,
  type MockStoryRewriteFixture,
  type StoryRewriteInput
} from '../../src/renderer/src/story-card/story-rewrite.adapter'

type MockCase = {
  id: string
  input: { workId: string; text: string }
  context: StoryCardWorkContext
  expected: Omit<StoryCardDraft, 'workId'>
}

const cases = mockDataset.cases as MockCase[]
const fixtures: MockStoryRewriteFixture[] = cases.map((testCase) => ({
  workId: testCase.input.workId,
  text: testCase.input.text,
  draft: { workId: testCase.input.workId, ...testCase.expected } as StoryCardDraft
}))

function caseById(id: string): MockCase {
  const testCase = cases.find((candidate) => candidate.id === id)
  if (!testCase) throw new Error(`Missing mock case: ${id}`)
  return testCase
}

function rewriteInput(testCase: MockCase): StoryRewriteInput {
  return {
    workId: testCase.input.workId,
    text: testCase.input.text,
    context: testCase.context
  }
}

describe('MockStoryRewriteAdapter', () => {
  it('returns the Phase 0 ready-for-review Mock drafts without exposing intermediate input', async () => {
    const adapter = new MockStoryRewriteAdapter(fixtures)

    for (const id of ['zh-ready', 'en-ready', 'mixed-ready', 'child-friendly-rewrite']) {
      const testCase = caseById(id)
      await expect(adapter.rewrite(rewriteInput(testCase))).resolves.toEqual({ workId: testCase.input.workId, ...testCase.expected })
    }
  })

  it('returns the fixed needs-more-input and retryable story-rewrite failure drafts', async () => {
    const adapter = new MockStoryRewriteAdapter(fixtures)
    const incomplete = caseById('needs-more-input')
    const failed = caseById('story-rewrite-failed')

    await expect(adapter.rewrite(rewriteInput(incomplete))).resolves.toEqual({ workId: incomplete.input.workId, ...incomplete.expected })
    await expect(adapter.rewrite(rewriteInput(failed))).resolves.toEqual({ workId: failed.input.workId, ...failed.expected })
  })

  it('rejects mismatched work context and normalizes unconfigured Mock input as retryable failure', async () => {
    const adapter = new MockStoryRewriteAdapter(fixtures)
    const ready = caseById('zh-ready')

    await expect(adapter.rewrite({ ...rewriteInput(ready), context: { ...ready.context, workId: 'work-other' } })).resolves.toMatchObject({
      workId: ready.input.workId,
      status: 'failed',
      error: { code: 'INVALID_ARGUMENT', retryable: false }
    })
    await expect(adapter.rewrite({ ...rewriteInput(ready), text: '未配置的 Mock 文本。' })).resolves.toMatchObject({
      workId: ready.input.workId,
      status: 'failed',
      error: { code: 'QA_TIMEOUT', retryable: true }
    })
  })
})

describe('GatewayStoryRewriteAdapter', () => {
  it('matches the Mock adapter domain draft and retryable failure shape', async () => {
    const ready = caseById('zh-ready')
    const failed = caseById('story-rewrite-failed')
    const failureError = (failed.expected as Extract<StoryCardDraft, { status: 'failed' }>).error
    const mock = new MockStoryRewriteAdapter(fixtures)
    const gateway = new GatewayStoryRewriteAdapter({
      storyRewrite: async (input) => input.text === ready.input.text
        ? { ok: true, result: { workId: ready.input.workId, ...ready.expected } }
        : { ok: false, error: failureError }
    })

    await expect(gateway.rewrite(rewriteInput(ready))).resolves.toEqual(
      await mock.rewrite(rewriteInput(ready))
    )
    await expect(gateway.rewrite(rewriteInput(failed))).resolves.toEqual(
      await mock.rewrite(rewriteInput(failed))
    )
  })

  it('keeps real candidate drafts inside the existing rewrite and visual validation boundary', async () => {
    const ready = caseById('zh-ready')
    const adapter = new GatewayStoryRewriteAdapter({
      storyRewrite: async () => ({ ok: true, result: { workId: ready.input.workId, ...ready.expected } })
    })

    await expect(adapter.rewrite(rewriteInput(ready))).resolves.toEqual({ workId: ready.input.workId, ...ready.expected })
  })

  it('maps gateway failures and malformed candidates into temporary failed drafts', async () => {
    const ready = caseById('zh-ready')
    await expect(new GatewayStoryRewriteAdapter({
      storyRewrite: async () => ({ ok: false, error: { code: 'QA_TIMEOUT', message: '请稍后重试。', retryable: true } })
    }).rewrite(rewriteInput(ready))).resolves.toMatchObject({ status: 'failed', error: { code: 'QA_TIMEOUT' } })

    await expect(new GatewayStoryRewriteAdapter({
      storyRewrite: async () => ({ ok: true, result: { workId: ready.input.workId, status: 'ready_for_review' } })
    }).rewrite(rewriteInput(ready))).resolves.toMatchObject({ status: 'failed', error: { code: 'UNKNOWN', retryable: true } })
  })

  it('keeps a conservative semantic insufficiency result inside the existing candidate-draft contract', async () => {
    const ready = caseById('zh-ready')
    const adapter = new GatewayStoryRewriteAdapter({
      storyRewrite: async () => ({
        ok: true,
        result: {
          workId: ready.input.workId,
          status: 'needs_more_input',
          followUpQuestions: ['小兔子在做什么呢？', '后来发生了什么呢？']
        }
      })
    })

    await expect(adapter.rewrite(rewriteInput(ready))).resolves.toEqual({
      workId: ready.input.workId,
      status: 'needs_more_input',
      followUpQuestions: ['小兔子在做什么呢？', '后来发生了什么呢？']
    })
  })
})
