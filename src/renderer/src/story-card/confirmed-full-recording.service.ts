import type {
  SharedError,
  StoryCard,
  StoryCardRepository,
  TemporaryFullRecordingInput
} from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import { parseFeltResourceRef } from '@shared/resource'

export type ConfirmedStoryCardContent = Omit<StoryCard, 'originalAudioRef'>

export interface FullRecordingPromoter {
  promoteTemporaryFullRecording(audioRef: string): Promise<string>
}

export class ConfirmedFullRecordingBindingError extends Error {
  constructor(readonly shared: SharedError) {
    super(shared.message)
    this.name = 'ConfirmedFullRecordingBindingError'
  }
}

function reject(message: string): never {
  throw new ConfirmedFullRecordingBindingError(
    toSharedError({ code: 'INVALID_ARGUMENT', message, retryable: false }, 'INVALID_ARGUMENT')
  )
}

function isFullRecording(recording: TemporaryFullRecordingInput): boolean {
  return recording.kind === 'initial_full_recording' || recording.kind === 'full_rerecording'
}

/**
 * Infrastructure helper for promoting a full recording and writing a formal card.
 * The Phase 4 confirmation command supplies the edited title and story text.
 */
export async function confirmStoryCardWithFullRecording(
  content: ConfirmedStoryCardContent,
  recording: TemporaryFullRecordingInput,
  repository: StoryCardRepository,
  promoter: FullRecordingPromoter
): Promise<StoryCard> {
  if (!isFullRecording(recording)) reject('只有完整录音才能绑定为正式原始音频。')
  if (content.workId !== recording.workId) reject('完整录音必须属于当前作品。')

  const promotedAudioRef = await promoter.promoteTemporaryFullRecording(recording.audioRef)
  const parsedAudioRef = parseFeltResourceRef(promotedAudioRef)
  if (!parsedAudioRef || parsedAudioRef.kind !== 'audio' || !parsedAudioRef.relativePath.startsWith('dynamic/story-card/confirmed/')) {
    reject('确认后的完整录音必须位于受保护的故事卡音频空间。')
  }

  const card: StoryCard = {
    ...content,
    originalAudioRef: parsedAudioRef.ref
  }
  const existing = await repository.getByWorkId(card.workId)
  return existing ? repository.replace(card) : repository.create(card)
}
