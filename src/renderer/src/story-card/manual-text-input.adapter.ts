import type { SharedError, StoryCardManualTextInputRequest, TemporaryFullRecordingInput } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { parseFeltResourceRef } from '@shared/resource'

export type ManualTextSupplementInput = {
  workId: string
  text: string
  fullRecording: TemporaryFullRecordingInput
}

export type ManualTextInputAdapterResult =
  | { ok: true; request: StoryCardManualTextInputRequest }
  | { ok: false; error: SharedError }

function invalid(code: SharedError['code'], message: string): ManualTextInputAdapterResult {
  return { ok: false, error: toSharedError({ code, message, retryable: false }, code) }
}

/**
 * Creates a text-only processing request linked to an existing full recording.
 * It never treats the typed text as a replacement audio source.
 */
export function adaptManualTextSupplement(input: ManualTextSupplementInput): ManualTextInputAdapterResult {
  const workId = input.workId.trim()
  if (!workId) return invalid('INVALID_ARGUMENT', '作品标识不能为空。')

  const text = input.text.trim()
  if (!text) return invalid('EMPTY_INPUT', '请先输入想补充的故事内容。')

  const fullRecording = input.fullRecording
  if (
    (fullRecording.kind !== 'initial_full_recording' && fullRecording.kind !== 'full_rerecording') ||
    fullRecording.workId.trim() !== workId
  ) {
    return invalid('INVALID_ARGUMENT', '文字补充必须关联当前作品的完整录音。')
  }

  const parsedAudioRef = parseFeltResourceRef(fullRecording.audioRef)
  if (!parsedAudioRef || parsedAudioRef.kind !== 'audio') {
    return invalid('INVALID_ARGUMENT', '文字补充必须关联已有的完整录音。')
  }

  return {
    ok: true,
    request: {
      workId,
      kind: 'manual_text',
      text,
      baseOriginalAudioRef: parsedAudioRef.ref
    }
  }
}
