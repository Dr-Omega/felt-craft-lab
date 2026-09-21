import type { ResourceRef, SharedError, TemporaryPartialSupplementInput } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { parseFeltResourceRef } from '@shared/resource'
import { MAX_RECORDING_DURATION_MS } from './recording-session.service'

export type PartialSupplementRecordingInput = {
  workId: string
  audioRef: ResourceRef
  durationMs: number
}

export type PartialSupplementInputAdapterResult =
  | { ok: true; request: TemporaryPartialSupplementInput }
  | { ok: false; error: SharedError }

function invalid(code: SharedError['code'], message: string): PartialSupplementInputAdapterResult {
  return { ok: false, error: toSharedError({ code, message, retryable: false }, code) }
}

/**
 * Creates a temporary input for a partial re-recording. Its discriminated kind
 * prevents this audio from being used as a full recording replacement.
 */
export function adaptPartialSupplementInput(input: PartialSupplementRecordingInput): PartialSupplementInputAdapterResult {
  const workId = input.workId.trim()
  if (!workId) return invalid('INVALID_ARGUMENT', '作品标识不能为空。')

  const parsedAudioRef = parseFeltResourceRef(input.audioRef)
  if (!parsedAudioRef || parsedAudioRef.kind !== 'audio') {
    return invalid('INVALID_ARGUMENT', '局部补录必须使用应用内音频资源引用。')
  }

  if (!Number.isInteger(input.durationMs) || input.durationMs <= 0) {
    return invalid('INVALID_ARGUMENT', '局部补录时长必须为正整数毫秒值。')
  }
  if (input.durationMs > MAX_RECORDING_DURATION_MS) {
    return invalid('AUDIO_TOO_LONG', '局部补录不能超过 5 分钟。')
  }

  return {
    ok: true,
    request: {
      workId,
      kind: 'partial_supplement',
      audioRef: parsedAudioRef.ref,
      durationMs: input.durationMs
    }
  }
}
