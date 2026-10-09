export const RECORDING_SESSION_STATES = [
  'not_started',
  'recording',
  'paused',
  'ended',
  'rerecording'
] as const

export type RecordingSessionState = (typeof RECORDING_SESSION_STATES)[number]

export type RecordingSessionAction = 'start' | 'pause' | 'resume' | 'end' | 'rerecord'

export const MAX_RECORDING_DURATION_MS = 300_000

export interface RecordingProgress {
  durationMs: number
  status: 'recording' | 'limit_reached'
}

const TRANSITIONS: Readonly<Record<RecordingSessionState, Partial<Record<RecordingSessionAction, RecordingSessionState>>>> = {
  not_started: { start: 'recording' },
  recording: { pause: 'paused', end: 'ended', rerecord: 'rerecording' },
  paused: { resume: 'recording', end: 'ended', rerecord: 'rerecording' },
  ended: { rerecord: 'rerecording' },
  rerecording: { pause: 'paused', end: 'ended' }
}

export class RecordingSessionTransitionError extends Error {
  constructor(
    readonly state: RecordingSessionState,
    readonly action: RecordingSessionAction
  ) {
    super(`录音会话当前处于“${state}”状态，不能执行“${action}”。`)
    this.name = 'RecordingSessionTransitionError'
  }
}

/**
 * Tracks recording controls only. Duration limits and temporary audio assets
 * are introduced by later Phase 2 tasks.
 */
export class RecordingSession {
  private currentState: RecordingSessionState = 'not_started'
  private recordedDurationMs = 0

  get state(): RecordingSessionState {
    return this.currentState
  }

  get durationMs(): number {
    return this.recordedDurationMs
  }

  dispatch(action: RecordingSessionAction): RecordingSessionState {
    const nextState = TRANSITIONS[this.currentState][action]
    if (!nextState) throw new RecordingSessionTransitionError(this.currentState, action)

    this.currentState = nextState
    if (action === 'rerecord') this.recordedDurationMs = 0
    return this.currentState
  }

  addRecordedDuration(durationMs: number): RecordingProgress {
    if (!Number.isInteger(durationMs) || durationMs < 0) {
      throw new TypeError('录音时长增量必须是非负整数毫秒值。')
    }
    if (this.currentState !== 'recording' && this.currentState !== 'rerecording') {
      throw new RecordingSessionTransitionError(this.currentState, 'end')
    }

    this.recordedDurationMs = Math.min(MAX_RECORDING_DURATION_MS, this.recordedDurationMs + durationMs)
    if (this.recordedDurationMs === MAX_RECORDING_DURATION_MS) {
      this.dispatch('end')
      return { durationMs: this.recordedDurationMs, status: 'limit_reached' }
    }

    return { durationMs: this.recordedDurationMs, status: 'recording' }
  }
}
