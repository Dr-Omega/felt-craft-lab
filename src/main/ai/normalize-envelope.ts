import type { AsrResult, QaResult, SharedError, StoryCardDraft, TtsResult } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import {
  validateAsrResult,
  validateQaResult,
  validateSharedError,
  validateTtsResult
} from '@shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource/constants'

export type NormalizedAi<T> = { ok: true; result: T } | { ok: false; error: SharedError }

function safeUnknown(message = 'AI 响应无效，请稍后重试。'): SharedError {
  return toSharedError({ code: 'UNKNOWN', message, retryable: true }, 'UNKNOWN')
}

function readEnvelope(body: unknown): { ok: boolean; result?: unknown; error?: unknown } | null {
  if (!body || typeof body !== 'object') return null
  const env = body as { ok?: unknown; result?: unknown; error?: unknown }
  if (env.ok === true) return { ok: true, result: env.result }
  if (env.ok === false) return { ok: false, error: env.error }
  return null
}

function normalizeError(error: unknown): SharedError {
  const validated = validateSharedError(error)
  if (validated.ok) return validated.value
  // Soft normalize via toSharedError when shape is close; else UNKNOWN.
  return toSharedError(error, 'UNKNOWN')
}

export function normalizeAsrEnvelope(body: unknown): NormalizedAi<AsrResult> {
  const env = readEnvelope(body)
  if (!env) return { ok: false, error: safeUnknown() }
  if (!env.ok) return { ok: false, error: normalizeError(env.error) }
  const validated = validateAsrResult(env.result)
  if (!validated.ok) return { ok: false, error: safeUnknown('语音识别结果无效。') }
  return { ok: true, result: validated.value }
}

export function normalizeQaEnvelope(body: unknown): NormalizedAi<QaResult> {
  const env = readEnvelope(body)
  if (!env) return { ok: false, error: safeUnknown() }
  if (!env.ok) return { ok: false, error: normalizeError(env.error) }
  const validated = validateQaResult(env.result)
  if (!validated.ok) return { ok: false, error: safeUnknown('问答结果无效。') }
  return { ok: true, result: validated.value }
}

export function normalizeTtsResult(result: TtsResult): NormalizedAi<TtsResult> {
  const validated = validateTtsResult(result, FELT_RESOURCE_REF_POLICY)
  if (!validated.ok) return { ok: false, error: safeUnknown('语音合成结果无效。') }
  return { ok: true, result: validated.value }
}

export function normalizeGatewayFailure(error: SharedError): { ok: false; error: SharedError } {
  const validated = validateSharedError(error)
  if (validated.ok) return { ok: false, error: validated.value }
  return { ok: false, error: toSharedError(error, 'UNKNOWN') }
}

export function normalizeStoryRewriteEnvelope(body: unknown, expectedWorkId: string): NormalizedAi<StoryCardDraft> {
  const env = readEnvelope(body)
  if (!env) return { ok: false, error: safeUnknown('故事整理结果无效，请稍后重试。') }
  if (!env.ok) return { ok: false, error: normalizeError(env.error) }
  if (!env.result || typeof env.result !== 'object') {
    return { ok: false, error: safeUnknown('故事整理结果无效，请稍后重试。') }
  }
  const draft = env.result as Record<string, unknown>
  if (draft.workId !== expectedWorkId) {
    return { ok: false, error: safeUnknown('故事整理结果无效，请稍后重试。') }
  }
  if (draft.status === 'needs_more_input') {
    const questions = Array.isArray(draft.followUpQuestions)
      ? draft.followUpQuestions.map((question) => typeof question === 'string' ? question.trim() : '')
      : []
    if (questions.length < 2 || questions.length > 3 || questions.some((question) => !question || question.length > 160)) {
      return { ok: false, error: safeUnknown('故事整理结果无效，请稍后重试。') }
    }
    return {
      ok: true,
      result: {
        workId: expectedWorkId,
        status: 'needs_more_input',
        followUpQuestions: questions as [string, string, ...string[]]
      }
    }
  }
  const title = typeof draft.suggestedTitle === 'string' ? draft.suggestedTitle.trim() : ''
  const storyText = typeof draft.suggestedStoryText === 'string' ? draft.suggestedStoryText.trim() : ''
  if (
    draft.status !== 'ready_for_review' ||
    !title ||
    title.length > 80 ||
    !storyText ||
    storyText.length > 2000
  ) {
    return { ok: false, error: safeUnknown('故事整理结果无效，请稍后重试。') }
  }
  return {
    ok: true,
    result: { workId: expectedWorkId, status: 'ready_for_review', suggestedTitle: title, suggestedStoryText: storyText }
  }
}
