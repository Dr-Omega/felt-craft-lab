import { describe, expect, it } from 'vitest'
import { formatStoryCardAudioTime } from '../../src/renderer/src/story-card/story-card-test-audio-player.service'

describe('story-card test audio player helpers', () => {
  it('formats playback times for the minimal player', () => {
    expect(formatStoryCardAudioTime(0)).toBe('0:00')
    expect(formatStoryCardAudioTime(65.9)).toBe('1:05')
    expect(formatStoryCardAudioTime(Number.NaN)).toBe('0:00')
  })
})
