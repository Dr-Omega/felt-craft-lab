import type { ResourceRef } from '@shared/contracts'

export interface TemporaryRecordingDeleter {
  deleteTemporaryRecording(audioRef: ResourceRef): Promise<void>
}

export interface TemporaryRecordingCleanupResult {
  deletedRefs: ResourceRef[]
  failedRefs: ResourceRef[]
}

async function cleanupRefs(
  refs: readonly ResourceRef[],
  deleter: TemporaryRecordingDeleter
): Promise<TemporaryRecordingCleanupResult> {
  const deletedRefs: ResourceRef[] = []
  const failedRefs: ResourceRef[] = []
  for (const ref of new Set(refs)) {
    try {
      await deleter.deleteTemporaryRecording(ref)
      deletedRefs.push(ref)
    } catch {
      failedRefs.push(ref)
    }
  }
  return { deletedRefs, failedRefs }
}

/** Call only after the replacement full recording has been saved successfully. */
export function cleanupAfterFullRerecording(
  previousTemporaryFullRecordingRef: ResourceRef,
  replacementTemporaryFullRecordingRef: ResourceRef,
  deleter: TemporaryRecordingDeleter
): Promise<TemporaryRecordingCleanupResult> {
  if (previousTemporaryFullRecordingRef === replacementTemporaryFullRecordingRef) {
    return Promise.resolve({ deletedRefs: [], failedRefs: [] })
  }
  return cleanupRefs([previousTemporaryFullRecordingRef], deleter)
}

export function cleanupAfterCancellation(
  temporaryFullRecordingRef: ResourceRef | undefined,
  temporaryPartialRecordingRefs: readonly ResourceRef[],
  deleter: TemporaryRecordingDeleter
): Promise<TemporaryRecordingCleanupResult> {
  return cleanupRefs(
    [...(temporaryFullRecordingRef ? [temporaryFullRecordingRef] : []), ...temporaryPartialRecordingRefs],
    deleter
  )
}

/** A confirmed full recording is formal audio and must be retained; only discarded partials are removed. */
export function cleanupAfterFullRecordingConfirmation(
  discardedPartialRecordingRefs: readonly ResourceRef[],
  deleter: TemporaryRecordingDeleter
): Promise<TemporaryRecordingCleanupResult> {
  return cleanupRefs(discardedPartialRecordingRefs, deleter)
}

export function cleanupAfterPartialSupplementConfirmation(
  temporaryPartialRecordingRef: ResourceRef,
  deleter: TemporaryRecordingDeleter
): Promise<TemporaryRecordingCleanupResult> {
  return cleanupRefs([temporaryPartialRecordingRef], deleter)
}
