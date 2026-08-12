/** Renderer AI client; all calls go through the trusted Preload/Main proxy. */

import {
  QA_MAX_HISTORY_MESSAGES,
  type AsrResult,
  type QaAskInput,
  type QaHistoryMessage,
  type QaResult
} from '@shared/contracts/ai'
import { toSharedError, type SharedError } from '@shared/contracts/error'
import { validateAsrResult, validateQaAskInput, validateQaResult, validateSharedError } from '@shared/contracts/validation'

export type AiAsrTranscribeInput = {
  audioBase64: string
  mimeType: string
  language?: string
  sessionId?: string
  provider?: string
}

export type AiQaAskInput = QaAskInput

export type AiTtsSynthesizeInput = {
  text: string
  voicePurpose?: string
  provider?: string
}

function requireAiApi(): NonNullable<Window['electronAPI']>['ai'] {
  const api = window.electronAPI?.ai
  if (!api) throw toSharedError({ code: 'UNKNOWN', message: 'AI IPC unavailable', retryable: false }, 'UNKNOWN')
  return api
}

function normalizeError(error: unknown): SharedError {
  const validated = validateSharedError(error)
  return validated.ok ? validated.value : toSharedError(error, 'UNKNOWN')
}

function unwrap<T>(raw: unknown, validate: (value: unknown) => { ok: true; value: T } | { ok: false }): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw toSharedError({ code: 'UNKNOWN', message: 'Invalid AI response', retryable: true }, 'UNKNOWN')
  }
  const envelope = raw as { ok?: unknown; result?: unknown; error?: unknown }
  if (envelope.ok === false) throw normalizeError(envelope.error)
  if (envelope.ok !== true) throw toSharedError({ code: 'UNKNOWN', message: 'Invalid AI response', retryable: true }, 'UNKNOWN')
  const result = validate(envelope.result)
  if (!result.ok) throw toSharedError({ code: 'UNKNOWN', message: 'Invalid AI result', retryable: true }, 'UNKNOWN')
  return result.value
}

/** Preserve only recent complete turns without mutating the caller's array. */
export function prepareQaHistoryForRequest(history: readonly QaHistoryMessage[] | undefined): QaHistoryMessage[] | undefined {
  if (history === undefined) return undefined
  if (!Array.isArray(history) || history.length % 2 !== 0) {
    throw toSharedError({ code: 'INVALID_ARGUMENT', message: 'QA history must contain complete turns', retryable: false }, 'INVALID_ARGUMENT')
  }
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index]
    const expected = index % 2 === 0 ? 'user' : 'assistant'
    if (!entry || entry.role !== expected || typeof entry.content !== 'string' || !entry.content.trim()) {
      throw toSharedError({ code: 'INVALID_ARGUMENT', message: 'QA history is malformed', retryable: false }, 'INVALID_ARGUMENT')
    }
  }
  const start = Math.max(0, history.length - QA_MAX_HISTORY_MESSAGES)
  return history.slice(start).map((entry) => ({ role: entry.role, content: entry.content }))
}

function prepareQaInput(input: AiQaAskInput): QaAskInput {
  const history = prepareQaHistoryForRequest(input.history)
  const candidate: QaAskInput = { ...input }
  if (history?.length) candidate.history = history
  else delete (candidate as { history?: readonly QaHistoryMessage[] }).history
  const validated = validateQaAskInput(candidate)
  if (!validated.ok) {
    throw toSharedError({ code: 'INVALID_ARGUMENT', message: 'Invalid QA input', retryable: false }, 'INVALID_ARGUMENT')
  }
  return validated.value
}

export const aiClient = {
  health: (): Promise<unknown> => requireAiApi().health(),
  asrTranscribe: async (input: AiAsrTranscribeInput): Promise<AsrResult> =>
    unwrap(await requireAiApi().asrTranscribe(input), (value) => validateAsrResult(value)),
  qaAsk: async (input: AiQaAskInput): Promise<QaResult> =>
    unwrap(await requireAiApi().qaAsk(prepareQaInput(input)), (value) => validateQaResult(value)),
  ttsSynthesize: (input: AiTtsSynthesizeInput): Promise<unknown> => requireAiApi().ttsSynthesize(input)
}
