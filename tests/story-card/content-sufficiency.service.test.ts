import { describe, expect, it } from 'vitest'
import { ContentSufficiencyService } from '../../src/renderer/src/story-card/content-sufficiency.service'

describe('ContentSufficiencyService', () => {
  it.each(['', '   ', '，。！？'])('rejects empty input without creating questions: %s', text => {
    expect(new ContentSufficiencyService().assess('work-001', text)).toEqual({
      sufficient: false,
      draft: {
        workId: 'work-001',
        status: 'failed',
        error: { code: 'INVALID_ARGUMENT', message: '请先录音或写下故事内容。', retryable: false }
      }
    })
  })

  it.each(['都喜欢', '小兔子。', '月', 'I like it', '小兔子在月夜花园里找朋友。'])('accepts meaningful input without a minimum length: %s', text => {
    expect(new ContentSufficiencyService().assess('work-001', text)).toEqual({ sufficient: true })
  })
})
