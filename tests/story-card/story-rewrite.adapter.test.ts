import mockDataset from '../../docs/story-card/phase-0/测试数据/SC-00-07_故事处理Mock数据集.json'
import { describe, expect, it } from 'vitest'
import type { StoryCardDraft, StoryCardWorkContext } from '../../src/shared/contracts'
import {
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
