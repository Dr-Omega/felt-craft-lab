import type {
  StoryCard,
  StoryCardDraft,
  StoryCardRepository,
  StoryCardWorkContext,
  TemporaryPartialSupplementInput
} from '@shared/contracts'
import type { StoryProcessingRequest } from './story-processing.service'
import {
  type StoryCardFinalFields,
  validateStoryCardFinalFields
} from './story-card-final-fields.validation'
import { persistenceError } from '../persistence/errors'

export interface PartialSupplementStoryProcessor {
  process(request: StoryProcessingRequest): Promise<StoryCardDraft>
}

export interface PartialSupplementProcessingRequest {
  supplement: TemporaryPartialSupplementInput
  context: StoryCardWorkContext
}

export interface ConfirmPartialSupplementCommand extends StoryCardFinalFields {
  supplement: TemporaryPartialSupplementInput
}

function validateSupplementForWork(
  supplement: TemporaryPartialSupplementInput,
  workId: string
): void {
  if (supplement.kind !== 'partial_supplement' || supplement.workId.trim() !== workId) {
    throw persistenceError('INVALID_ARGUMENT', '局部补录必须属于当前作品。')
  }
}

/**
 * Processes a partial supplement into a temporary candidate without changing
 * the confirmed story card or its original full recording.
 */
export async function processPartialSupplement(
  request: PartialSupplementProcessingRequest,
  repository: StoryCardRepository,
  processor: PartialSupplementStoryProcessor
): Promise<StoryCardDraft> {
  validateSupplementForWork(request.supplement, request.context.workId)
  if (request.context.completionStatus !== 'completed') {
    throw persistenceError('INVALID_ARGUMENT', '局部补录必须属于当前已完成作品。')
  }
  if (!(await repository.getByWorkId(request.supplement.workId))) {
    throw persistenceError('STORY_CARD_NOT_FOUND', '这件作品还没有可修改的故事卡。')
  }

  return processor.process({ input: request.supplement, context: request.context })
}

/**
 * Confirms edited content derived from a partial supplement. The original full
 * recording is copied from the existing formal card and is never promoted or replaced.
 */
export async function confirmPartialSupplement(
  command: ConfirmPartialSupplementCommand,
  repository: StoryCardRepository
): Promise<StoryCard> {
  validateStoryCardFinalFields(command)
  validateSupplementForWork(command.supplement, command.editPayload.workId)

  const existing = await repository.getByWorkId(command.editPayload.workId)
  if (!existing) {
    throw persistenceError('STORY_CARD_NOT_FOUND', '这件作品还没有可修改的故事卡。')
  }

  return repository.replace({
    ...existing,
    artworkImageRef: command.workContext.artworkImageRef,
    title: command.editPayload.title,
    storyText: command.editPayload.storyText,
    confirmedAt: command.confirmedAt
  })
}
