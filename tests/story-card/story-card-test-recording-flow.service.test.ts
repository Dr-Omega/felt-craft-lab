import { describe, expect, it } from 'vitest'
import { StoryCardTestRecordingFlow } from '../../src/renderer/src/story-card/story-card-test-recording-flow.service'

const firstAudioRef = 'felt-resource://audio/dynamic/story-card/temp/first.webm'
const secondAudioRef = 'felt-resource://audio/dynamic/story-card/temp/second.webm'

describe('StoryCardTestRecordingFlow', () => {
  it('uses the recording state machine before allowing a text supplement', () => {
    const flow = new StoryCardTestRecordingFlow('story-card-mock-work-001')

    expect(flow.createManualTextRequest('补充一点内容。')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })

    flow.dispatch('start')
    flow.dispatch('pause')
    flow.dispatch('resume')
    flow.dispatch('end')
    flow.completeFullRecording(firstAudioRef, 3_000)

    expect(flow.createManualTextRequest('  小兔子找到了朋友。  ')).toEqual({
      ok: true,
      request: {
        workId: 'story-card-mock-work-001',
        kind: 'manual_text',
        text: '小兔子找到了朋友。',
        baseOriginalAudioRef: firstAudioRef
      }
    })
  })

  it('marks an ended replacement as a full rerecording and returns the superseded temporary audio', () => {
    const flow = new StoryCardTestRecordingFlow('story-card-mock-work-001')
    flow.dispatch('start')
    flow.dispatch('end')
    flow.completeFullRecording(firstAudioRef, 1_000)

    flow.dispatch('rerecord')
    flow.dispatch('end')

    expect(flow.completeFullRecording(secondAudioRef, 2_000)).toEqual({
      recording: {
        workId: 'story-card-mock-work-001',
        kind: 'full_rerecording',
        audioRef: secondAudioRef,
        durationMs: 2_000
      },
      supersededAudioRef: firstAudioRef
    })
  })

  it('ends the recording session when its accumulated duration reaches five minutes', () => {
    const flow = new StoryCardTestRecordingFlow('story-card-mock-work-001')
    flow.dispatch('start')

    expect(flow.addRecordedDuration(300_000)).toEqual({
      durationMs: 300_000,
      status: 'limit_reached'
    })
    expect(flow.state).toBe('ended')

    expect(flow.completeFullRecording(firstAudioRef, flow.durationMs).recording).toMatchObject({
      durationMs: 300_000
    })
  })
})
