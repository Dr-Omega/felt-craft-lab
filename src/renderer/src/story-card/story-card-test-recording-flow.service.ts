import type { ResourceRef, StoryCardManualTextInputRequest, TemporaryFullRecordingInput } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import {
  RecordingSession,
  type RecordingSessionAction,
  type RecordingProgress,
  type RecordingSessionState
} from './recording-session.service'
import { adaptManualTextSupplement, type ManualTextInputAdapterResult } from './manual-text-input.adapter'

export type CompletedTestRecording = {
  recording: TemporaryFullRecordingInput
  supersededAudioRef?: ResourceRef
}

/** Coordinates only the phase 5 test controls around the existing recording domain services. */
export class StoryCardTestRecordingFlow {
  private readonly session = new RecordingSession()
  private currentRecording?: TemporaryFullRecordingInput
  private nextRecordingKind: TemporaryFullRecordingInput['kind'] = 'initial_full_recording'

  constructor(private readonly workId: string) {}

  get state(): RecordingSessionState {
    return this.session.state
  }

  get durationMs(): number {
    return this.session.durationMs
  }

  get fullRecording(): TemporaryFullRecordingInput | undefined {
    return this.currentRecording
  }

  /** Removes a recording after it has been promoted, so a later rerecord does not delete the formal audio. */
  releaseConfirmedRecording(audioRef: ResourceRef): void {
    if (this.currentRecording?.audioRef === audioRef) this.currentRecording = undefined
  }

  dispatch(action: RecordingSessionAction): RecordingSessionState {
    const state = this.session.dispatch(action)
    if (action === 'rerecord') this.nextRecordingKind = 'full_rerecording'
    return state
  }

  addRecordedDuration(durationMs: number): RecordingProgress {
    return this.session.addRecordedDuration(durationMs)
  }

  completeFullRecording(audioRef: ResourceRef, durationMs: number): CompletedTestRecording {
    if (this.state !== 'ended') throw new Error('录音结束后才能保存完整录音。')

    const recording: TemporaryFullRecordingInput = {
      workId: this.workId,
      kind: this.nextRecordingKind,
      audioRef,
      durationMs
    }
    const supersededAudioRef = this.currentRecording?.audioRef

    this.currentRecording = recording
    return { recording, supersededAudioRef }
  }

  createManualTextRequest(text: string): ManualTextInputAdapterResult {
    if (!this.currentRecording) {
      return {
        ok: false,
        error: toSharedError({
          code: 'INVALID_ARGUMENT',
          message: '请先结束并保存一段完整录音，再补充文字。',
          retryable: false
        }, 'INVALID_ARGUMENT')
      }
    }

    return adaptManualTextSupplement({
      workId: this.workId,
      text,
      fullRecording: this.currentRecording
    })
  }
}

export function manualTextRequestSummary(request: StoryCardManualTextInputRequest): string {
  return `已生成 ${request.kind} 请求，关联完整录音：${request.baseOriginalAudioRef}`
}
