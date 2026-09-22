import { describe, expect, it, vi } from 'vitest'
import type {
  StoryCard,
  StoryCardDraft,
  StoryCardRepository,
  StoryCardWorkContext,
  TemporaryFullRecordingInput,
  TemporaryPartialSupplementInput
} from '../../src/shared/contracts'
import { processFullRerecording } from '../../src/renderer/src/story-card/full-rerecording-flow.service'
import {
  confirmPartialSupplement,
  processPartialSupplement
} from '../../src/renderer/src/story-card/partial-supplement-flow.service'
import { prepareStoryCardEditing } from '../../src/renderer/src/story-card/story-card-editing.service'
import { confirmStoryCard } from '../../src/renderer/src/story-card/story-card-confirmation.service'
import { decideStoryCardContentUpdate } from '../../src/renderer/src/story-card/story-card-content-update-decision.service'
import { getStoryCardDetail } from '../../src/renderer/src/story-card/story-card-detail.service'
import { syncStoryCardArtworkImage } from '../../src/renderer/src/story-card/story-card-artwork-sync.service'

const initialWork: StoryCardWorkContext = {
  workId: 'work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/work-001.png',
  background: { name: '月夜花园' },
  subject: { name: '小兔子' },
  stickers: []
}

const latestWork: StoryCardWorkContext = {
  ...initialWork,
  artworkImageRef: 'felt-resource://preview/latest-work-001.png'
}

const initialRecording: TemporaryFullRecordingInput = {
  workId: 'work-001',
  kind: 'initial_full_recording',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/initial.webm',
  durationMs: 10_000
}

const rerecording: TemporaryFullRecordingInput = {
  workId: 'work-001',
  kind: 'full_rerecording',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/rerecording.webm',
  durationMs: 10_000
}

const supplement: TemporaryPartialSupplementInput = {
  workId: 'work-001',
  kind: 'partial_supplement',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/partial.webm',
  durationMs: 3_000
}

function readyDraft(
  title: string,
  storyText: string
): Extract<StoryCardDraft, { status: 'ready_for_review' }> {
  return { workId: 'work-001', status: 'ready_for_review', suggestedTitle: title, suggestedStoryText: storyText }
}

function memoryRepository(initial?: StoryCard): StoryCardRepository & {
  create: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
  current: () => StoryCard | undefined
} {
  let current = initial
  return {
    create: vi.fn(async (card: StoryCard) => {
      current = card
      return card
    }),
    getByWorkId: vi.fn(async () => current),
    replace: vi.fn(async (card: StoryCard) => {
      current = card
      return card
    }),
    current: () => current
  }
}

async function createInitialCard(store: StoryCardRepository): Promise<void> {
  await confirmStoryCard(
    {
      editPayload: {
        workId: 'work-001',
        title: '小兔子的月夜花园',
        storyText: '小兔子在月夜花园里找朋友。'
      },
      workContext: initialWork,
      confirmedAt: '2026-09-22T00:00:00.000Z',
      recording: initialRecording
    },
    store,
    {
      promoteTemporaryFullRecording: async () =>
        'felt-resource://audio/dynamic/story-card/confirmed/initial.webm'
    }
  )
}

describe('phase 4 story-card workflow', () => {
  it('keeps drafts unreadable until confirmation and overwrites the same formal card on re-confirmation', async () => {
    const store = memoryRepository()
    const draft = readyDraft('小兔子的月夜花园', '小兔子在月夜花园里找朋友。')

    expect(prepareStoryCardEditing(draft)).toMatchObject({ ok: true })
    await expect(getStoryCardDetail('work-001', store)).rejects.toMatchObject({
      shared: { code: 'STORY_CARD_NOT_FOUND', retryable: false }
    })

    await createInitialCard(store)
    await confirmStoryCard(
      {
        editPayload: {
          workId: 'work-001',
          title: '小兔子的新版月夜花园',
          storyText: '小兔子在月夜花园里和朋友一起玩。'
        },
        workContext: initialWork,
        confirmedAt: '2026-09-22T01:00:00.000Z',
        recording: initialRecording
      },
      store,
      {
        promoteTemporaryFullRecording: async () =>
          'felt-resource://audio/dynamic/story-card/confirmed/initial-reconfirmed.webm'
      }
    )

    expect(store.create).toHaveBeenCalledTimes(1)
    expect(store.replace).toHaveBeenCalledTimes(1)
    await expect(getStoryCardDetail('work-001', store)).resolves.toMatchObject({
      title: '小兔子的新版月夜花园',
      storyText: '小兔子在月夜花园里和朋友一起玩。',
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/initial-reconfirmed.webm'
    })
  })

  it('keeps confirmed text and full audio when the latest artwork is synced and keep-story is chosen', async () => {
    const store = memoryRepository()
    await createInitialCard(store)

    expect(decideStoryCardContentUpdate('work-001', 'keep_current_story')).toEqual({
      workId: 'work-001',
      type: 'keep_current_story'
    })
    await syncStoryCardArtworkImage(latestWork, store)

    await expect(getStoryCardDetail('work-001', store)).resolves.toEqual({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的月夜花园',
      storyText: '小兔子在月夜花园里找朋友。',
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/initial.webm',
      confirmedAt: '2026-09-22T00:00:00.000Z'
    })
  })

  it('distinguishes full re-recording audio replacement from partial-supplement text-only confirmation', async () => {
    const store = memoryRepository()
    await createInitialCard(store)
    await syncStoryCardArtworkImage(latestWork, store)

    expect(decideStoryCardContentUpdate('work-001', 'full_rerecording')).toMatchObject({
      type: 'start_full_rerecording',
      inputKind: 'full_rerecording'
    })
    const rerecordingDraft = readyDraft('小兔子的重录故事', '小兔子重新讲了月夜花园的故事。')
    await processFullRerecording(
      { recording: rerecording, context: latestWork },
      store,
      { process: vi.fn(async () => rerecordingDraft) }
    )
    expect(store.current()?.originalAudioRef).toBe('felt-resource://audio/dynamic/story-card/confirmed/initial.webm')
    await confirmStoryCard(
      {
        editPayload: {
          workId: 'work-001',
          title: rerecordingDraft.suggestedTitle,
          storyText: rerecordingDraft.suggestedStoryText
        },
        workContext: latestWork,
        confirmedAt: '2026-09-22T02:00:00.000Z',
        recording: rerecording
      },
      store,
      {
        promoteTemporaryFullRecording: async () =>
          'felt-resource://audio/dynamic/story-card/confirmed/rerecording.webm'
      }
    )

    expect(decideStoryCardContentUpdate('work-001', 'partial_supplement')).toMatchObject({
      type: 'start_partial_supplement',
      inputKind: 'partial_supplement'
    })
    const supplementDraft = readyDraft('小兔子的补充故事', '小兔子还和朋友一起看了灯笼。')
    await processPartialSupplement(
      { supplement, context: latestWork },
      store,
      { process: vi.fn(async () => supplementDraft) }
    )
    await confirmPartialSupplement(
      {
        editPayload: {
          workId: 'work-001',
          title: supplementDraft.suggestedTitle,
          storyText: supplementDraft.suggestedStoryText
        },
        workContext: latestWork,
        confirmedAt: '2026-09-22T03:00:00.000Z',
        supplement
      },
      store
    )

    await expect(getStoryCardDetail('work-001', store)).resolves.toEqual({
      workId: 'work-001',
      artworkImageRef: 'felt-resource://preview/latest-work-001.png',
      title: '小兔子的补充故事',
      storyText: '小兔子还和朋友一起看了灯笼。',
      originalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/rerecording.webm',
      confirmedAt: '2026-09-22T03:00:00.000Z'
    })
  })
})
