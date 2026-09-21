import { describe, expect, it } from 'vitest'
import {
  MAX_RECORDING_DURATION_MS,
  RecordingSession,
  type RecordingSessionAction,
  RecordingSessionTransitionError
} from '../../src/renderer/src/story-card/recording-session.service'

function rejectedTransition(session: RecordingSession, action: RecordingSessionAction): unknown {
  try {
    session.dispatch(action)
  } catch (error) {
    return error
  }

  throw new Error(`Expected ${action} to be rejected.`)
}

describe('RecordingSession', () => {
  it('starts from not_started and enters recording', () => {
    const session = new RecordingSession()

    expect(session.state).toBe('not_started')
    expect(session.dispatch('start')).toBe('recording')
  })

  it('allows a paused recording to resume', () => {
    const session = new RecordingSession()

    session.dispatch('start')
    expect(session.dispatch('pause')).toBe('paused')
    expect(session.dispatch('resume')).toBe('recording')
  })

  it('allows a new recording after recording, pause, or end', () => {
    const recording = new RecordingSession()
    recording.dispatch('start')
    expect(recording.dispatch('rerecord')).toBe('rerecording')

    const paused = new RecordingSession()
    paused.dispatch('start')
    paused.dispatch('pause')
    expect(paused.dispatch('rerecord')).toBe('rerecording')

    const ended = new RecordingSession()
    ended.dispatch('start')
    ended.dispatch('end')
    expect(ended.dispatch('rerecord')).toBe('rerecording')
  })

  it('allows a re-recording to pause and end', () => {
    const session = new RecordingSession()
    session.dispatch('start')
    session.dispatch('rerecord')

    expect(session.dispatch('pause')).toBe('paused')
    expect(session.dispatch('resume')).toBe('recording')
    expect(session.dispatch('end')).toBe('ended')
  })

  it('rejects illegal state transitions', () => {
    const session = new RecordingSession()

    expect(() => session.dispatch('pause')).toThrow(RecordingSessionTransitionError)
    expect(rejectedTransition(session, 'pause')).toMatchObject({ state: 'not_started', action: 'pause' })

    session.dispatch('start')
    expect(rejectedTransition(session, 'start')).toMatchObject({ state: 'recording', action: 'start' })
  })

  it('ends at five minutes and reports that the limit was reached', () => {
    const session = new RecordingSession()
    session.dispatch('start')

    expect(session.addRecordedDuration(MAX_RECORDING_DURATION_MS - 1)).toEqual({
      durationMs: MAX_RECORDING_DURATION_MS - 1,
      status: 'recording'
    })
    expect(session.addRecordedDuration(1)).toEqual({
      durationMs: MAX_RECORDING_DURATION_MS,
      status: 'limit_reached'
    })
    expect(session.state).toBe('ended')
  })

  it('never records beyond the five-minute limit', () => {
    const session = new RecordingSession()
    session.dispatch('start')

    expect(session.addRecordedDuration(MAX_RECORDING_DURATION_MS + 1)).toEqual({
      durationMs: MAX_RECORDING_DURATION_MS,
      status: 'limit_reached'
    })
    expect(session.durationMs).toBe(MAX_RECORDING_DURATION_MS)
  })

  it('does not add duration while paused and resets duration for a re-recording', () => {
    const session = new RecordingSession()
    session.dispatch('start')
    session.addRecordedDuration(1_000)
    session.dispatch('pause')

    expect(() => session.addRecordedDuration(1)).toThrow(RecordingSessionTransitionError)

    session.dispatch('rerecord')
    expect(session.durationMs).toBe(0)
  })
})
