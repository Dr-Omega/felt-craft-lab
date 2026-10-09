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

export interface GatewayStoryRewriteClient {
  storyRewrite(input: { workId: string; text: string; context: Record<string, unknown> }): Promise<unknown>
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

/**
 * Electron IPC cannot clone Vue's reactive Proxy objects. The gateway only
 * needs these story facts, so send a fresh plain-data copy across the bridge.
 */
function toGatewayContext(context: StoryCardWorkContext): Record<string, unknown> {
  return {
    workId: context.workId,
    completionStatus: context.completionStatus,
    background: context.background
      ? { name: context.background.name, ...(context.background.themeName ? { themeName: context.background.themeName } : {}) }
      : null,
    subject: { name: context.subject.name, ...(context.subject.themeName ? { themeName: context.subject.themeName } : {}) },
    stickers: context.stickers.map((sticker) => ({
      name: sticker.name,
      ...(sticker.themeName ? { themeName: sticker.themeName } : {})
    }))
  }
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

function asGatewayDraft(value: unknown): StoryCardDraft | undefined {
  if (!value || typeof value !== 'object') return undefined
  const envelope = value as { ok?: unknown; result?: unknown }
  if (envelope.ok !== true || !envelope.result || typeof envelope.result !== 'object') return undefined
  const draft = envelope.result as Record<string, unknown>
  if (typeof draft.workId !== 'string') return undefined
  if (draft.status === 'needs_more_input') {
    if (!Array.isArray(draft.followUpQuestions) || draft.followUpQuestions.length < 2 || !draft.followUpQuestions.every((question) => typeof question === 'string')) {
      return undefined
    }
    return {
      workId: draft.workId,
      status: 'needs_more_input',
      followUpQuestions: [...draft.followUpQuestions] as [string, string, ...string[]]
    }
  }
  if (draft.status !== 'ready_for_review' || typeof draft.suggestedTitle !== 'string' || typeof draft.suggestedStoryText !== 'string') {
    return undefined
  }
  return { workId: draft.workId, status: 'ready_for_review', suggestedTitle: draft.suggestedTitle, suggestedStoryText: draft.suggestedStoryText }
}

/**
 * Real service adapter. The gateway returns only a temporary candidate draft;
 * the existing content and visual validators remain the final client boundary.
 */
export class GatewayStoryRewriteAdapter implements StoryRewriteAdapter {
  constructor(
    private readonly client: GatewayStoryRewriteClient,
    private readonly ruleValidator = new StoryRewriteRuleValidator(),
    private readonly visualBoundaryValidator = new StoryVisualBoundaryValidator()
  ) {}

  async rewrite(input: StoryRewriteInput): Promise<StoryCardDraft> {
    const workId = typeof input?.workId === 'string' ? input.workId.trim() : ''
    if (!isValidInput(input)) return invalid(workId)
    try {
      const response = await this.client.storyRewrite({
        workId,
        text: input.text.trim(),
        context: toGatewayContext(input.context)
      })
      if (response && typeof response === 'object' && (response as { ok?: unknown }).ok === false) {
        return failed(workId, (response as { error?: unknown }).error as SharedError)
      }
      const draft = asGatewayDraft(response)
      if (!draft || draft.workId !== workId) {
        return failed(workId, { code: 'UNKNOWN', message: '故事整理结果无效，请稍后重试。', retryable: true })
      }
      return this.visualBoundaryValidator.validate(
        input.text,
        input.context,
        this.ruleValidator.validate(input.text, normalizeDraft(workId, draft))
      )
    } catch (error) {
      return failed(workId, toSharedError(error, 'UNKNOWN'))
    }
  }
}
