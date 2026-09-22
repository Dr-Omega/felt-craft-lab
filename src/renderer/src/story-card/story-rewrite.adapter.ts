import type { SharedError, StoryCardDraft, StoryCardWorkContext } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { StoryRewriteRuleValidator } from './story-rewrite-rules.service'
import { StoryVisualBoundaryValidator } from './story-visual-boundary.service'

export interface StoryRewriteInput {
  workId: string
  text: string
  context: StoryCardWorkContext
}

export interface StoryRewriteAdapter {
  rewrite(input: StoryRewriteInput): Promise<StoryCardDraft>
}

export interface MockStoryRewriteFixture {
  workId: string
  text: string
  draft: StoryCardDraft
}

function failed(workId: string, error: SharedError): StoryCardDraft {
  return { workId, status: 'failed', error: toSharedError(error, 'UNKNOWN') }
}

function invalid(workId: string): StoryCardDraft {
  return failed(workId, {
    code: 'INVALID_ARGUMENT',
    message: '故事整理必须使用当前已完成作品的有效文本。',
    retryable: false
  })
}

function isValidInput(input: StoryRewriteInput): boolean {
  return (
    typeof input.workId === 'string' &&
    input.workId.trim().length > 0 &&
    typeof input.text === 'string' &&
    input.text.trim().length > 0 &&
    input.context?.workId === input.workId.trim() &&
    input.context.completionStatus === 'completed'
  )
}

function normalizeDraft(workId: string, draft: StoryCardDraft): StoryCardDraft {
  switch (draft.status) {
    case 'processing':
      return { workId, status: 'processing' }
    case 'ready_for_review':
      return {
        workId,
        status: 'ready_for_review',
        suggestedTitle: draft.suggestedTitle,
        suggestedStoryText: draft.suggestedStoryText
      }
    case 'needs_more_input':
      return { workId, status: 'needs_more_input', followUpQuestions: [...draft.followUpQuestions] as [string, string, ...string[]] }
    case 'failed':
      return failed(workId, draft.error)
  }
}

/**
 * Deterministic Phase 3 mock. Fixtures supply the expected candidate draft for
 * each known input; the adapter never persists a transcript, draft, or audio reference.
 */
export class MockStoryRewriteAdapter implements StoryRewriteAdapter {
  constructor(
    private readonly fixtures: readonly MockStoryRewriteFixture[],
    private readonly ruleValidator = new StoryRewriteRuleValidator(),
    private readonly visualBoundaryValidator = new StoryVisualBoundaryValidator()
  ) {}

  async rewrite(input: StoryRewriteInput): Promise<StoryCardDraft> {
    const workId = typeof input?.workId === 'string' ? input.workId.trim() : ''
    if (!isValidInput(input)) return invalid(workId)

    const fixture = this.fixtures.find((candidate) => candidate.workId === workId && candidate.text === input.text.trim())
    if (!fixture) {
      return failed(workId, {
        code: 'QA_TIMEOUT',
        message: '故事暂时没有整理好，请稍后再试。',
        retryable: true
      })
    }

    return this.visualBoundaryValidator.validate(
      input.text,
      input.context,
      this.ruleValidator.validate(input.text, normalizeDraft(workId, fixture.draft))
    )
  }
}
