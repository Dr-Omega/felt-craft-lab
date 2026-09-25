import type { SharedError, StoryCardDraft, StoryCardInputRequest, StoryCardWorkContext } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import type { SpeechRecognitionAdapter } from './speech-recognition.adapter'
import type { StoryRewriteAdapter } from './story-rewrite.adapter'
import { ContentSufficiencyService } from './content-sufficiency.service'

export interface StoryProcessingRequest {
  input: StoryCardInputRequest
  context: StoryCardWorkContext
}

export interface StoryTranscriptProcessingRequest {
  workId: string
  text: string
  context: StoryCardWorkContext
}

function failed(workId: string, error: SharedError): StoryCardDraft {
  return { workId, status: 'failed', error: toSharedError(error, 'UNKNOWN') }
}

function invalid(workId: string): StoryCardDraft {
  return failed(workId, {
    code: 'INVALID_ARGUMENT',
    message: '故事处理输入必须属于当前已完成作品。',
    retryable: false
  })
}

function isMatchingCompletedWork(workId: unknown, context: StoryCardWorkContext): boolean {
  return (
    typeof workId === 'string' &&
    workId.trim().length > 0 &&
    workId.trim() === context?.workId &&
    context.completionStatus === 'completed'
  )
}

function isManualTextInput(input: StoryCardInputRequest): input is Extract<StoryCardInputRequest, { kind: 'manual_text' }> {
  return input.kind === 'manual_text'
}

/**
 * Phase 3 orchestration only. It transforms an accepted input into a temporary
 * candidate draft and never persists the transcript, draft, or formal StoryCard.
 */
export class StoryProcessingService {
  constructor(
    private readonly speechRecognition: SpeechRecognitionAdapter,
    private readonly storyRewrite: StoryRewriteAdapter,
    private readonly contentSufficiency = new ContentSufficiencyService()
  ) {}

  async process(request: StoryProcessingRequest): Promise<StoryCardDraft> {
    const workId = typeof request?.input?.workId === 'string' ? request.input.workId.trim() : ''
    if (!request?.input || !request.context || !isMatchingCompletedWork(workId, request.context)) return invalid(workId)

    if (isManualTextInput(request.input)) {
      return this.processText(workId, request.input.text, request.context)
    }

    let recognition
    try {
      recognition = await this.speechRecognition.transcribe(request.input)
    } catch (error) {
      return failed(workId, toSharedError(error, 'ASR_TIMEOUT'))
    }
    if (!recognition.ok) return failed(workId, recognition.error)
    if (recognition.transcript.workId !== workId) return invalid(workId)

    return this.processText(workId, recognition.transcript.text, request.context)
  }

  /** Processes an already-recognized temporary transcript without calling ASR again. */
  async processTranscript(request: StoryTranscriptProcessingRequest): Promise<StoryCardDraft> {
    const workId = typeof request?.workId === 'string' ? request.workId.trim() : ''
    if (!request?.context || !isMatchingCompletedWork(workId, request.context)) return invalid(workId)
    return this.processText(workId, request.text, request.context)
  }

  private async processText(workId: string, text: string, context: StoryCardWorkContext): Promise<StoryCardDraft> {
    const sufficiency = this.contentSufficiency.assess(workId, text)
    if (!sufficiency.sufficient) return sufficiency.draft

    try {
      return await this.storyRewrite.rewrite({
        workId,
        text,
        context
      })
    } catch (error) {
      return failed(workId, toSharedError(error, 'QA_TIMEOUT'))
    }
  }
}
