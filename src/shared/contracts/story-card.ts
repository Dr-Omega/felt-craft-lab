import type { ResourceRef, UtcIso8601 } from './common'
import type { SharedError } from './error'

export interface StoryCardWorkElement {
  name: string
  themeName?: string
}

export interface StoryCardWorkContext {
  workId: string
  completionStatus: 'completed'
  artworkImageRef: ResourceRef
  background: StoryCardWorkElement | null
  subject: StoryCardWorkElement
  stickers: StoryCardWorkElement[]
}

/**
 * A confirmed story card associated with one completed work.
 * Intermediate transcriptions, drafts, and partial recordings do not belong here.
 */
export interface StoryCard {
  workId: string
  artworkImageRef: ResourceRef
  title: string
  storyText: string
  originalAudioRef: ResourceRef
  confirmedAt: UtcIso8601
}

/**
 * Persistence boundary for confirmed story cards.
 * Uniqueness enforcement and storage implementation are introduced by later tasks.
 */
export interface StoryCardRepository {
  create(card: StoryCard): Promise<StoryCard>
  getByWorkId(workId: string): Promise<StoryCard | undefined>
  replace(card: StoryCard): Promise<StoryCard>
}

export type StoryCardInputKind =
  | 'initial_full_recording'
  | 'manual_text'
  | 'full_rerecording'
  | 'partial_supplement'

export interface StoryCardAudioInputRequest {
  workId: string
  kind: 'initial_full_recording' | 'full_rerecording' | 'partial_supplement'
  audioRef: ResourceRef
  durationMs: number
}

export type TemporaryFullRecordingInput = StoryCardAudioInputRequest & {
  kind: 'initial_full_recording' | 'full_rerecording'
}

export type TemporaryPartialSupplementInput = StoryCardAudioInputRequest & {
  kind: 'partial_supplement'
}

export interface StoryCardManualTextInputRequest {
  workId: string
  kind: 'manual_text'
  text: string
  baseOriginalAudioRef: ResourceRef
}

export type StoryCardInputRequest =
  | TemporaryFullRecordingInput
  | TemporaryPartialSupplementInput
  | StoryCardManualTextInputRequest

/** A temporary story-processing result. It is never persisted as a formal StoryCard. */
export type StoryCardDraft =
  | { workId: string; status: 'processing' }
  | { workId: string; status: 'ready_for_review'; suggestedTitle: string; suggestedStoryText: string }
  | { workId: string; status: 'needs_more_input'; followUpQuestions: [string, string, ...string[]] }
  | { workId: string; status: 'failed'; error: SharedError }
