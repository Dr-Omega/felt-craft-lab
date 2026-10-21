import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve('src/renderer/src/pages/StoryCardPage.vue'), 'utf8')

describe('StoryCardPage contract', () => {
  it('submits only visible editable text, never re-appends a hidden recording transcript', () => {
    expect(page).not.toContain('transcript.value +')
    expect(page).not.toContain('recognized?.ok ? recognized.transcript.text')
    expect(page).toContain('await prepareRecordingText(')
    expect(page).toContain('text: supplementText.value.trim()')
  })
  it('does not overlay extra follow-up questions on the supplied artwork', () => {
    expect(page).not.toContain('draft.followUpQuestions.join')
    expect(page).not.toContain('question-text')
    expect(page).not.toContain('可以回答上面的问题')
    expect(page).toContain("errorMessage.value = '请补充一点故事内容后再试。'")
  })
  it('keeps rerecord left and generate right on one row without transcript or skip controls', () => {
    expect(page).toContain('class="added-button supplement-rerecord" :style="box(620, 704, 300, 82, 9.2)"')
    expect(page).toContain('class="added-button supplement-submit" :style="box(980, 704, 300, 82, 9.2)"')
    expect(page.indexOf('class="added-button supplement-rerecord"')).toBeLessThan(page.indexOf('class="added-button supplement-submit"'))
    expect(page).not.toContain('transcript-review')
    expect(page).not.toContain('检查识别文字')
    expect(page).not.toContain('没有，跳过09.png')
    expect(page).not.toContain('aria-label="没有补充，跳过"')
    expect(page).not.toContain('!supplementText.trim() && !transcript.trim()')
    expect(page).toContain('busy || (speechFailed && !supplementText.trim())')
  })

  it('keeps confirmed long story text in a fixed-height scrollable region', () => {
    expect(page).toContain('<p class="detail-story"')
    expect(page).toContain('{{ confirmedCard.storyText }}</p>')

    const storyTextRule = page.match(/\.detail-story\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(storyTextRule).toContain('overflow-y: auto')
    expect(page).toContain('box(1210, 333, 360, 455, 4.2)')
  })

  it('uses the supplied layers and keeps their numbered stacking order', () => {
    expect(page).toContain("大背景（放在最底层）.png', order: 0")
    expect(page).toContain("背景边框（放在第二高的顶层）.png', order: 90")
    expect(page).toContain("返回键（放在最顶层）.png', order: 100")
    expect(page).toContain('return result.sort((a, b) => a.order - b.order)')
  })

  it('uses integer z-index values for controls above the recording panel', () => {
    expect(page).toContain('zIndex: Math.round(order * 10)')
    expect(page).toContain('aria-label="暂停录音"')
    expect(page).toContain('aria-label="完成录音"')
    expect(page).toContain('aria-label="重新录音"')
  })

  it('uses the real service adapters without the old Mock interface', () => {
    expect(page).toContain('GatewaySpeechRecognitionAdapter')
    expect(page).toContain('GatewayStoryRewriteAdapter')
    expect(page).not.toContain('story-card-test-fixtures')
    expect(page).not.toContain('Story Card · Test Flow')
  })
})
