import { describe, expect, it, vi } from 'vitest'
import type { StoryCard, StoryCardRepository, TemporaryFullRecordingInput } from '../../src/shared/contracts'
import {
  confirmStoryCardWithFullRecording,
  type ConfirmedStoryCardContent
} from '../../src/renderer/src/story-card/confirmed-full-recording.service'

function content(overrides: Partial<ConfirmedStoryCardContent> = {}): ConfirmedStoryCardContent {
  return {
    workId: 'work-001',
    artworkImageRef: 'felt-resource://preview/work-001.png',
    title: '小兔子的花园故事',
    storyText: '小兔子在花园里找朋友。',
    confirmedAt: '2026-09-21T00:00:00.000Z',
    ...overrides
  }
}

function fullRecording(kind: TemporaryFullRecordingInput['kind'] = 'initial_full_recording'): TemporaryFullRecordingInput {
  return {
    workId: 'work-001',
    kind,
    audioRef: 'felt-resource://audio/dynamic/story-card/temp/full-recording.webm',
    durationMs: 10_000
  }
}

function promoter(ref = 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm') {
  return { promoteTemporaryFullRecording: vi.fn(async () => ref) }
}

function repository(existing?: StoryCard): StoryCardRepository & {
  create: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async (card: StoryCard) => card),
    getByWorkId: vi.fn(async () => existing),
    replace: vi.fn(async (card: StoryCard) => card)
  }
}

describe('confirmStoryCardWithFullRecording', () => {
  it('writes the full recording ref only when the confirmation service is called', async () => {
    const store = repository()
    const recording = fullRecording()
    const recordingPromoter = promoter()

    expect(store.create).not.toHaveBeenCalled()
    await expect(confirmStoryCardWithFullRecording(content(), recording, store, recordingPromoter)).resolves.toEqual({
      ...content(),
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm'
    })
    expect(recordingPromoter.promoteTemporaryFullRecording).toHaveBeenCalledWith(recording.audioRef)
    expect(store.create).toHaveBeenCalledWith({
      ...content(),
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm'
    })
    expect(store.replace).not.toHaveBeenCalled()
  })

  it('replaces the formal card when a full re-recording is confirmed', async () => {
    const existing: StoryCard = {
      ...content(),
      originalAudioRef: 'felt-resource://audio/previous.webm'
    }
    const store = repository(existing)
    const recording = fullRecording('full_rerecording')
    const recordingPromoter = promoter()

    await confirmStoryCardWithFullRecording(content({ title: '新的故事' }), recording, store, recordingPromoter)

    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).toHaveBeenCalledWith({
      ...content({ title: '新的故事' }),
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm'
    })
  })

  it('rejects partial recordings and mismatched works without writing a formal card', async () => {
    const store = repository()
    const recordingPromoter = promoter()
    const partial = { ...fullRecording(), kind: 'partial_supplement' } as unknown as TemporaryFullRecordingInput

    await expect(confirmStoryCardWithFullRecording(content(), partial, store, recordingPromoter)).rejects.toMatchObject({
      shared: { code: 'INVALID_ARGUMENT', retryable: false }
    })
    await expect(confirmStoryCardWithFullRecording(content({ workId: 'work-002' }), fullRecording(), store, recordingPromoter)).rejects.toMatchObject({
      shared: { code: 'INVALID_ARGUMENT', retryable: false }
    })
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
    expect(recordingPromoter.promoteTemporaryFullRecording).not.toHaveBeenCalled()
  })

  it('does not write a formal card when full-recording promotion fails', async () => {
    const store = repository()
    const recordingPromoter = {
      promoteTemporaryFullRecording: vi.fn(async () => {
        throw new Error('promotion failed')
      })
    }

    await expect(confirmStoryCardWithFullRecording(content(), fullRecording(), store, recordingPromoter)).rejects.toThrow(
      'promotion failed'
    )
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
  })
})
