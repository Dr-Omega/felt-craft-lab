import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve('src/renderer/src/pages/StoryCardPage.vue'), 'utf8')

describe('StoryCardPage contract', () => {
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
