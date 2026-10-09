import type {
  StoryCard,
  StoryCardRepository,
  TemporaryFullRecordingInput
} from '@shared/contracts'
import {
  confirmStoryCardWithFullRecording,
  type FullRecordingPromoter
} from './confirmed-full-recording.service'
import {
  type CurrentStoryCardWork,
  type StoryCardFinalFields,
  validateStoryCardFinalFields
} from './story-card-final-fields.validation'

export type { CurrentStoryCardWork } from './story-card-final-fields.validation'

/**
 * The one user-facing command that turns edited content into a formal story card.
 * It always uses the current work image and requires a valid confirmation date.
 */
export interface ConfirmStoryCardCommand extends StoryCardFinalFields {
  recording: TemporaryFullRecordingInput
}

export async function confirmStoryCard(
  command: ConfirmStoryCardCommand,
  repository: StoryCardRepository,
  promoter: FullRecordingPromoter
): Promise<StoryCard> {
  validateStoryCardFinalFields(command)

  return confirmStoryCardWithFullRecording(
    {
      workId: command.editPayload.workId,
      artworkImageRef: command.workContext.artworkImageRef,
      title: command.editPayload.title,
      storyText: command.editPayload.storyText,
      confirmedAt: command.confirmedAt
    },
    command.recording,
    repository,
    promoter
  )
}
