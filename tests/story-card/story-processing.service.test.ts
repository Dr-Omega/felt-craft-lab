import { describe, expect, it, vi } from 'vitest'
import type {
  SharedError,
  StoryCardAudioInputRequest,
  StoryCardDraft,
  StoryCardManualTextInputRequest,
  StoryCardWorkContext
} from '../../src/shared/contracts'
import type { SpeechRecognitionAdapter } from '../../src/renderer/src/story-card/speech-recognition.adapter'
import { StoryProcessingService } from '../../src/renderer/src/story-card/story-processing.service'
import type { StoryRewriteAdapter } from '../../src/renderer/src/story-card/story-rewrite.adapter'

const context: StoryCardWorkContext = {
  workId: 'work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/work-001.png',
  background: { name: '月夜花园', themeName: '中秋' },
  subject: { name: '小兔子' },
  stickers: [{ name: '灯笼', themeName: '中秋' }]
}

const audioInput: StoryCardAudioInputRequest = {
  workId: 'work-001',
  kind: 'initial_full_recording',
  audioRef: 'felt-resource://audio/dynamic/story-card/temp/recording.webm',
  durationMs: 10_000
}

const manualInput: StoryCardManualTextInputRequest = {
  workId: 'work-001',
  kind: 'manual_text',
  text: '我想补充小兔子和朋友一起玩。',
  baseOriginalAudioRef: 'felt-resource://audio/dynamic/story-card/confirmed/recording.webm'
}

function draft(workId: string, text: string): StoryCardDraft {
  return {
    workId,
    status: 'ready_for_review',
    suggestedTitle: '小兔子的故事',
    suggestedStoryText: text
  }
}

function services(recognition: Awaited<ReturnType<SpeechRecognitionAdapter['transcribe']>>) {
  const speechRecognition: SpeechRecognitionAdapter = { transcribe: vi.fn(async () => recognition) }
  const storyRewrite: StoryRewriteAdapter = {
    rewrite: vi.fn(async (input) => draft(input.workId, input.text))
  }
  return { speechRecognition, storyRewrite, service: new StoryProcessingService(speechRecognition, storyRewrite) }
}

describe('StoryProcessingService', () => {
  it('sends a full recording through recognition and then story rewrite', async () => {
    const { speechRecognition, storyRewrite, service } = services({
      ok: true,
      transcript: { workId: 'work-001', text: '小兔子在月夜花园里找朋友。' }
    })

    await expect(service.process({ input: audioInput, context })).resolves.toEqual(draft('work-001', '小兔子在月夜花园里找朋友。'))
    expect(speechRecognition.transcribe).toHaveBeenCalledWith(audioInput)
    expect(storyRewrite.rewrite).toHaveBeenCalledWith({
      workId: 'work-001',
      text: '小兔子在月夜花园里找朋友。',
      context
    })
  })

  it('sends manual text directly to story rewrite without transcribing again', async () => {
    const { speechRecognition, storyRewrite, service } = services({
      ok: true,
      transcript: { workId: 'work-001', text: '不应使用这段转写。' }
    })

    await expect(service.process({ input: manualInput, context })).resolves.toEqual(draft('work-001', manualInput.text))
    expect(speechRecognition.transcribe).not.toHaveBeenCalled()
    expect(storyRewrite.rewrite).toHaveBeenCalledWith({ workId: 'work-001', text: manualInput.text, context })
  })

  it('processes a temporary transcript without transcribing again, so a later supplement can reuse it', async () => {
    const { speechRecognition, storyRewrite, service } = services({
      ok: true,
      transcript: { workId: 'work-001', text: '不应再次转写。' }
    })
    const combinedText = '小兔子在月夜花园里找朋友。\n它还想告诉朋友，灯笼像星星一样亮。'

    await expect(service.processTranscript({ workId: 'work-001', text: combinedText, context })).resolves.toEqual(
      draft('work-001', combinedText)
    )
    expect(speechRecognition.transcribe).not.toHaveBeenCalled()
    expect(storyRewrite.rewrite).toHaveBeenCalledWith({ workId: 'work-001', text: combinedText, context })
  })

  it('returns needs-more-input before story rewrite when the text is too short', async () => {
    const { speechRecognition, storyRewrite, service } = services({
      ok: true,
      transcript: { workId: 'work-001', text: '不应使用这段转写。' }
    })

    await expect(service.process({ input: { ...manualInput, text: '小兔子。' }, context })).resolves.toMatchObject({
      workId: 'work-001',
      status: 'needs_more_input',
      followUpQuestions: expect.any(Array)
    })
    expect(speechRecognition.transcribe).not.toHaveBeenCalled()
    expect(storyRewrite.rewrite).not.toHaveBeenCalled()
  })

  it('returns recognition failure or invalid work context without calling story rewrite', async () => {
    const timeout: SharedError = { code: 'ASR_TIMEOUT', message: '语音识别暂时没有完成，请稍后再试。', retryable: true }
    const failedServices = services({ ok: false, error: timeout })

    await expect(failedServices.service.process({ input: audioInput, context })).resolves.toEqual({
      workId: 'work-001',
      status: 'failed',
      error: timeout
    })
    expect(failedServices.storyRewrite.rewrite).not.toHaveBeenCalled()

    const invalidServices = services({ ok: true, transcript: { workId: 'work-001', text: '不会使用。' } })
    await expect(
      invalidServices.service.process({ input: audioInput, context: { ...context, workId: 'work-other' } })
    ).resolves.toMatchObject({ status: 'failed', error: { code: 'INVALID_ARGUMENT', retryable: false } })
    expect(invalidServices.speechRecognition.transcribe).not.toHaveBeenCalled()
    expect(invalidServices.storyRewrite.rewrite).not.toHaveBeenCalled()

    const mismatchedTranscriptServices = services({ ok: true, transcript: { workId: 'work-other', text: '不会使用。' } })
    await expect(mismatchedTranscriptServices.service.process({ input: audioInput, context })).resolves.toMatchObject({
      workId: 'work-001',
      status: 'failed',
      error: { code: 'INVALID_ARGUMENT', retryable: false }
    })
    expect(mismatchedTranscriptServices.storyRewrite.rewrite).not.toHaveBeenCalled()
  })

  it('normalizes thrown recognition and rewrite failures into retryable failed drafts', async () => {
    const recognitionFailure: SpeechRecognitionAdapter = {
      transcribe: vi.fn(async () => {
        throw new Error('provider connection failed')
      })
    }
    const unusedRewrite: StoryRewriteAdapter = { rewrite: vi.fn(async () => draft('work-001', '不应生成候选稿。')) }
    const recognitionService = new StoryProcessingService(recognitionFailure, unusedRewrite)

    await expect(recognitionService.process({ input: audioInput, context })).resolves.toMatchObject({
      workId: 'work-001',
      status: 'failed',
      error: { code: 'ASR_TIMEOUT', retryable: true }
    })
    expect(unusedRewrite.rewrite).not.toHaveBeenCalled()

    const successfulRecognition: SpeechRecognitionAdapter = {
      transcribe: vi.fn(async () => ({ ok: true as const, transcript: { workId: 'work-001', text: '小兔子在月夜花园里找朋友。' } }))
    }
    const rewriteFailure: StoryRewriteAdapter = {
      rewrite: vi.fn(async () => {
        throw new Error('provider connection failed')
      })
    }
    const rewriteService = new StoryProcessingService(successfulRecognition, rewriteFailure)

    await expect(rewriteService.process({ input: audioInput, context })).resolves.toMatchObject({
      workId: 'work-001',
      status: 'failed',
      error: { code: 'QA_TIMEOUT', retryable: true }
    })
  })
})
