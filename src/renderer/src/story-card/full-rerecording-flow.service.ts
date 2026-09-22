import type {
  StoryCardDraft,
  StoryCardRepository,
  StoryCardWorkContext,
  TemporaryFullRecordingInput
} from '@shared/contracts'
import type { StoryProcessingRequest } from './story-processing.service'
import { persistenceError } from '../persistence/errors'

export interface FullRerecordingStoryProcessor {
  process(request: StoryProcessingRequest): Promise<StoryCardDraft>
}

export interface FullRerecordingProcessingRequest {
  recording: TemporaryFullRecordingInput
  context: StoryCardWorkContext
}

/**
 * Sends a new complete re-recording through the temporary story-processing path.
 * It never replaces a formal card; a separate confirmation is still required.
 */
export async function processFullRerecording(
  request: FullRerecordingProcessingRequest,
  repository: StoryCardRepository,
  processor: FullRerecordingStoryProcessor
): Promise<StoryCardDraft> {
  if (request.recording.kind !== 'full_rerecording') {
    throw persistenceError('INVALID_ARGUMENT', '完整重录必须使用新的完整录音。')
  }
  if (
    request.recording.workId.trim() !== request.context.workId ||
    request.context.completionStatus !== 'completed'
  ) {
    throw persistenceError('INVALID_ARGUMENT', '完整重录必须属于当前已完成作品。')
  }
  if (!(await repository.getByWorkId(request.recording.workId))) {
    throw persistenceError('STORY_CARD_NOT_FOUND', '这件作品还没有可重新录制的故事卡。')
  }

  return processor.process({ input: request.recording, context: request.context })
}
