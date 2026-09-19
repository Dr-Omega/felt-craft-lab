import type { AsrProvider, ResourceRef } from './common'

export type QaHistoryRole = 'user' | 'assistant'

export interface QaHistoryMessage {
  role: QaHistoryRole
  content: string
}

/** Whitelisted material context sent to the QA model. */
export interface QaAssetContext {
  assetId?: string
  nameZh?: string
  introZh?: string
  themeId?: string
}

export interface QaAskInput {
  question: string
  asset?: QaAssetContext
  history?: readonly QaHistoryMessage[]
  provider?: string
}

export const QA_MAX_QUESTION_CHARS = 500 as const
export const QA_MAX_HISTORY_MESSAGES = 12 as const
export const QA_MAX_HISTORY_TURNS = 6 as const
export const QA_MAX_HISTORY_MESSAGE_CHARS = 500 as const

export interface AsrResult {
  transcript: string
  provider: AsrProvider
  /** End-to-end client request latency; not the recording duration. */
  durationMs: number
  /** Recording duration when it can be obtained reliably. */
  audioDurationMs?: number
  confidence?: number
  requestId?: string
}

export interface QaResult {
  /** Safety-processed answer, never a provider's raw response. */
  answer: string
  requestId?: string
  safetyAction?: 'allow' | 'redirect' | 'reject'
}

export interface TtsResult {
  audioUrl: ResourceRef
  cacheHit: boolean
  requestId?: string
}

