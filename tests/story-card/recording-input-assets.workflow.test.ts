import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResourceRef, StoryCard, StoryCardRepository } from '../../src/shared/contracts'
import {
  deleteTemporaryStoryCardAudio,
  promoteTemporaryStoryCardAudio,
  saveTemporaryStoryCardAudio
} from '../../src/main/story-card-audio/write'
import { resolveFeltResourcePath } from '../../src/shared/resource/resolve-path'
import type { ResourceRoots } from '../../src/shared/resource'
import {
  confirmStoryCardWithFullRecording,
  type ConfirmedStoryCardContent
} from '../../src/renderer/src/story-card/confirmed-full-recording.service'
import { adaptManualTextSupplement } from '../../src/renderer/src/story-card/manual-text-input.adapter'
import { adaptPartialSupplementInput } from '../../src/renderer/src/story-card/partial-supplement-input.adapter'
import {
  MAX_RECORDING_DURATION_MS,
  RecordingSession,
  RecordingSessionTransitionError
} from '../../src/renderer/src/story-card/recording-session.service'
import { cleanupAfterFullRecordingConfirmation } from '../../src/renderer/src/story-card/temporary-recording-cleanup.service'

const temporaryDirectories: string[] = []

function makeRoots(): ResourceRoots {
  const root = mkdtempSync(join(tmpdir(), 'felt-recording-workflow-'))
  temporaryDirectories.push(root)
  return {
    materialRoot: join(root, 'material'),
    audioRoot: join(root, 'audio-fixed'),
    audioDynamicRoot: join(root, 'audio-dynamic'),
    previewRoot: join(root, 'preview')
  }
}

function cardContent(): ConfirmedStoryCardContent {
  return {
    workId: 'work-001',
    artworkImageRef: 'felt-resource://preview/work-001.png',
    title: '小兔子的花园故事',
    storyText: '小兔子在花园里找朋友。',
    confirmedAt: '2026-09-21T00:00:00.000Z'
  }
}

function repository(): StoryCardRepository & { current?: StoryCard } {
  const store: StoryCardRepository & { current?: StoryCard } = {
    create: async (card) => {
      store.current = card
      return card
    },
    getByWorkId: async () => store.current,
    replace: async (card) => {
      store.current = card
      return card
    }
  }
  return store
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('recording and input assets workflow', () => {
  it('covers pause, limit, re-record, manual text, full/partial boundaries, and confirmation cleanup', async () => {
    const session = new RecordingSession()
    session.dispatch('start')
    session.dispatch('pause')
    expect(() => session.addRecordedDuration(1)).toThrow(RecordingSessionTransitionError)
    session.dispatch('resume')
    session.addRecordedDuration(1_000)
    session.dispatch('rerecord')
    expect(session.durationMs).toBe(0)
    expect(session.addRecordedDuration(MAX_RECORDING_DURATION_MS)).toMatchObject({ status: 'limit_reached' })
    expect(session.state).toBe('ended')

    const roots = makeRoots()
    const fullSaved = saveTemporaryStoryCardAudio(new Uint8Array([1]), 'audio/webm', roots)
    const partialSaved = saveTemporaryStoryCardAudio(new Uint8Array([2]), 'audio/webm', roots)
    expect(fullSaved.ok && partialSaved.ok).toBe(true)
    if (!fullSaved.ok || !partialSaved.ok) return

    expect(
      adaptManualTextSupplement({
        workId: 'work-001',
        text: '我还想补充小兔子在找朋友。',
        fullRecording: {
          workId: 'work-001',
          kind: 'initial_full_recording',
          audioRef: fullSaved.ref,
          durationMs: 1_000
        }
      })
    ).toMatchObject({ ok: true, request: { kind: 'manual_text', baseOriginalAudioRef: fullSaved.ref } })

    const partialInput = adaptPartialSupplementInput({
      workId: 'work-001',
      audioRef: partialSaved.ref,
      durationMs: 1_000
    })
    expect(partialInput).toMatchObject({ ok: true, request: { kind: 'partial_supplement' } })

    const store = repository()
    await confirmStoryCardWithFullRecording(
      cardContent(),
      {
        workId: 'work-001',
        kind: 'initial_full_recording',
        audioRef: fullSaved.ref,
        durationMs: 1_000
      },
      store,
      {
        promoteTemporaryFullRecording: async (ref) => {
          const promoted = promoteTemporaryStoryCardAudio(ref, roots)
          if (!promoted.ok) throw new Error(promoted.error.message)
          return promoted.ref
        }
      }
    )
    expect(store.current?.originalAudioRef).toMatch(/^felt-resource:\/\/audio\/dynamic\/story-card\/confirmed\//)

    await cleanupAfterFullRecordingConfirmation([partialSaved.ref], {
      deleteTemporaryRecording: async (ref: ResourceRef) => {
        const deleted = deleteTemporaryStoryCardAudio(ref, roots)
        if (!deleted.ok) throw new Error(deleted.error.message)
      }
    })
    const fullPath = resolveFeltResourcePath(store.current?.originalAudioRef ?? '', roots)
    const originalTemporaryPath = resolveFeltResourcePath(fullSaved.ref, roots, { requireExists: false })
    const partialPath = resolveFeltResourcePath(partialSaved.ref, roots, { requireExists: false })
    expect(fullPath.ok && existsSync(fullPath.absolutePath)).toBe(true)
    expect(originalTemporaryPath).toMatchObject({ ok: true, exists: false })
    expect(partialPath).toMatchObject({ ok: true, exists: false })
  })
})
