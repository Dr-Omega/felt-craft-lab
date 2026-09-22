import { describe, expect, it, vi } from 'vitest'
import type {
  StoryCard,
  StoryCardRepository,
  TemporaryFullRecordingInput
} from '../../src/shared/contracts'
import {
  confirmStoryCard,
  type ConfirmStoryCardCommand
} from '../../src/renderer/src/story-card/story-card-confirmation.service'

function command(overrides: Partial<ConfirmStoryCardCommand> = {}): ConfirmStoryCardCommand {
  return {
    editPayload: {
      workId: 'work-001',
      title: '小兔子的月夜花园',
      storyText: '小兔子在月夜花园里找朋友。'
    },
    workContext: {
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png'
    },
    confirmedAt: '2026-09-22T00:00:00.000Z',
    recording: {
      workId: 'work-001',
      kind: 'initial_full_recording',
      audioRef: 'felt-resource://audio/dynamic/story-card/temp/full-recording.webm',
      durationMs: 10_000
    },
    ...overrides
  }
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

function promoter() {
  return {
    promoteTemporaryFullRecording: vi.fn(
      async () => 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm'
    )
  }
}

describe('confirmStoryCard', () => {
  it('creates a formal card only after the confirmation command is called', async () => {
    const store = repository()
    const recordingPromoter = promoter()

    expect(store.create).not.toHaveBeenCalled()
    await expect(confirmStoryCard(command(), store, recordingPromoter)).resolves.toEqual({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的月夜花园',
      storyText: '小兔子在月夜花园里找朋友。',
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm',
      confirmedAt: '2026-09-22T00:00:00.000Z'
    })
    expect(store.create).toHaveBeenCalledTimes(1)
    expect(store.replace).not.toHaveBeenCalled()
  })

  it('overwrites the existing formal card through the same confirmation command', async () => {
    const existing: StoryCard = {
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/old-work-001.png',
      title: '旧故事',
      storyText: '这是旧故事。',
      originalAudioRef: 'felt-resource://audio/previous.webm',
      confirmedAt: '2026-09-21T00:00:00.000Z'
    }
    const store = repository(existing)

    await confirmStoryCard(command(), store, promoter())

    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).toHaveBeenCalledWith({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的月夜花园',
      storyText: '小兔子在月夜花园里找朋友。',
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/full-recording.webm',
      confirmedAt: '2026-09-22T00:00:00.000Z'
    })
  })

  it('does not write or promote audio when the command and recording target different works', async () => {
    const store = repository()
    const recordingPromoter = promoter()
    const recording: TemporaryFullRecordingInput = {
      ...command().recording,
      workId: 'work-002'
    }

    await expect(confirmStoryCard(command({ recording }), store, recordingPromoter)).rejects.toMatchObject({
      shared: { code: 'INVALID_ARGUMENT', retryable: false }
    })
    expect(recordingPromoter.promoteTemporaryFullRecording).not.toHaveBeenCalled()
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
  })

  it('rejects incomplete final fields, invalid dates, and mismatched current works before writing', async () => {
    const store = repository()
    const recordingPromoter = promoter()

    await expect(
      confirmStoryCard(command({ editPayload: { workId: 'work-001', title: ' ', storyText: '完整故事。' } }), store, recordingPromoter)
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    await expect(
      confirmStoryCard(command({ editPayload: { workId: 'work-001', title: '故事标题', storyText: ' ' } }), store, recordingPromoter)
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    await expect(
      confirmStoryCard(command({ confirmedAt: '2026-02-31T00:00:00.000Z' }), store, recordingPromoter)
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })
    await expect(
      confirmStoryCard(
        command({
          workContext: {
            workId: 'work-002',
            artworkImageRef: 'felt-resource://preview/latest-work-002.png'
          }
        }),
        store,
        recordingPromoter
      )
    ).rejects.toMatchObject({ shared: { code: 'INVALID_ARGUMENT', retryable: false } })

    expect(recordingPromoter.promoteTemporaryFullRecording).not.toHaveBeenCalled()
    expect(store.create).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
  })
})
