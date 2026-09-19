import type { AsrProvider, ResourceRef } from './common'

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

