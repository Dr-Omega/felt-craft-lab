import { describe, expect, it, vi } from 'vitest'
import {
  cleanupAfterCancellation,
  cleanupAfterFullRecordingConfirmation,
  cleanupAfterFullRerecording,
  cleanupAfterPartialSupplementConfirmation
} from '../../src/renderer/src/story-card/temporary-recording-cleanup.service'

const full = 'felt-resource://audio/dynamic/story-card/full.webm'
const replacement = 'felt-resource://audio/dynamic/story-card/replacement.webm'
const partial = 'felt-resource://audio/dynamic/story-card/partial.webm'

function deleter(failFor: string[] = []) {
  return { deleteTemporaryRecording: vi.fn(async (ref: string) => {
    if (failFor.includes(ref)) throw new Error('delete failed')
  }) }
}

describe('temporary recording cleanup', () => {
  it('deletes only the old recording after a replacement has been saved', async () => {
    const service = deleter()
    await expect(cleanupAfterFullRerecording(full, replacement, service)).resolves.toEqual({
      deletedRefs: [full],
      failedRefs: []
    })
    expect(service.deleteTemporaryRecording).toHaveBeenCalledWith(full)
    expect(service.deleteTemporaryRecording).not.toHaveBeenCalledWith(replacement)
  })

  it('deletes all known temporary recordings after cancellation', async () => {
    const service = deleter()
    await expect(cleanupAfterCancellation(full, [partial], service)).resolves.toEqual({
      deletedRefs: [full, partial],
      failedRefs: []
    })
  })

  it('keeps confirmed full audio but removes discarded or confirmed partial recordings', async () => {
    const service = deleter()
    await cleanupAfterFullRecordingConfirmation([partial], service)
    await cleanupAfterPartialSupplementConfirmation(partial, service)

    expect(service.deleteTemporaryRecording).toHaveBeenCalledWith(partial)
    expect(service.deleteTemporaryRecording).not.toHaveBeenCalledWith(full)
  })

  it('returns failed refs for a later retry without blocking other cleanup', async () => {
    const service = deleter([partial])
    await expect(cleanupAfterCancellation(full, [partial], service)).resolves.toEqual({
      deletedRefs: [full],
      failedRefs: [partial]
    })
  })
})
