import mockDataset from '../../docs/story-card/phase-0/测试数据/SC-00-07_故事处理Mock数据集.json'
import { describe, expect, it, vi } from 'vitest'
import type { StoryCardDraft, StoryCardManualTextInputRequest, StoryCardWorkContext } from '../../src/shared/contracts'
import type { SpeechRecognitionAdapter } from '../../src/renderer/src/story-card/speech-recognition.adapter'
import { StoryProcessingService } from '../../src/renderer/src/story-card/story-processing.service'
import { MockStoryRewriteAdapter, type MockStoryRewriteFixture } from '../../src/renderer/src/story-card/story-rewrite.adapter'

type MockCase = {
  id: string
  input: StoryCardManualTextInputRequest
  context: StoryCardWorkContext
  expected: Omit<StoryCardDraft, 'workId'>
}

const cases = mockDataset.cases as MockCase[]
const fixtures: MockStoryRewriteFixture[] = cases.map((testCase) => ({
  workId: testCase.input.workId,
  text: testCase.input.text,
  draft: { workId: testCase.input.workId, ...testCase.expected } as StoryCardDraft
}))

function manualOnlyRecognition(): SpeechRecognitionAdapter & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn(async () => {
      throw new Error('手动输入不应进入语音识别。')
    })
  }
}

describe('StoryProcessingService fixed Mock regression', () => {
  it('processes every Phase 0 story-rewrite Mock case through the text-processing entry point', async () => {
    const recognition = manualOnlyRecognition()
    const service = new StoryProcessingService(recognition, new MockStoryRewriteAdapter(fixtures))

    for (const testCase of cases) {
      await expect(service.process({ input: testCase.input, context: testCase.context })).resolves.toEqual({
        workId: testCase.input.workId,
        ...testCase.expected
      })
    }

    expect(recognition.transcribe).not.toHaveBeenCalled()
  })

  it('blocks an unmentioned sticker at the processing entry point', async () => {
    const input: StoryCardManualTextInputRequest = {
      workId: 'work-visual-boundary',
      kind: 'manual_text',
      text: '小兔子在月夜花园找朋友，它想和朋友一起玩。',
      baseOriginalAudioRef: 'felt-resource://audio/work-visual-boundary-original.mp3'
    }
    const context: StoryCardWorkContext = {
      workId: input.workId,
      completionStatus: 'completed',
      artworkImageRef: 'felt-resource://preview/work-visual-boundary.png',
      background: { name: '月夜花园', themeName: '中秋' },
      subject: { name: '小兔子' },
      stickers: [{ name: '灯笼', themeName: '中秋' }]
    }
    const service = new StoryProcessingService(
      manualOnlyRecognition(),
      new MockStoryRewriteAdapter([
        {
          workId: input.workId,
          text: input.text,
          draft: {
            workId: input.workId,
            status: 'ready_for_review',
            suggestedTitle: '小兔子的月夜花园',
            suggestedStoryText: '小兔子在月夜花园找朋友，灯笼亮亮的。'
          }
        }
      ])
    )

    await expect(service.process({ input, context })).resolves.toMatchObject({
      workId: input.workId,
      status: 'failed',
      error: { code: 'QA_BLOCKED', retryable: false }
    })
  })

  it('blocks an unmentioned core event at the processing entry point', async () => {
    const input: StoryCardManualTextInputRequest = {
      workId: 'work-plot-boundary',
      kind: 'manual_text',
      text: '小兔子在月夜花园找朋友，后来和朋友一起玩。',
      baseOriginalAudioRef: 'felt-resource://audio/work-plot-boundary-original.mp3'
    }
    const context: StoryCardWorkContext = {
      workId: input.workId,
      completionStatus: 'completed',
      artworkImageRef: 'felt-resource://preview/work-plot-boundary.png',
      background: { name: '月夜花园', themeName: '中秋' },
      subject: { name: '小兔子' },
      stickers: []
    }
    const service = new StoryProcessingService(
      manualOnlyRecognition(),
      new MockStoryRewriteAdapter([
        {
          workId: input.workId,
          text: input.text,
          draft: {
            workId: input.workId,
            status: 'ready_for_review',
            suggestedTitle: '小兔子的月夜花园',
            suggestedStoryText: '小兔子在月夜花园找朋友，后来坐船去森林。'
          }
        }
      ])
    )

    await expect(service.process({ input, context })).resolves.toMatchObject({
      workId: input.workId,
      status: 'failed',
      error: { code: 'QA_BLOCKED', retryable: false }
    })
  })
})
