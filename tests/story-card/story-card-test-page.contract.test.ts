import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve('src/renderer/src/pages/StoryCardTestPage.vue'), 'utf8')

describe('StoryCardTestPage contract', () => {
  it('keeps confirmed long story text in a fixed-height scrollable region', () => {
    expect(page).toContain('<p class="story-text-scroll" tabindex="0">{{ confirmedCard.storyText }}</p>')

    const storyTextRule = page.match(/\.story-text-scroll\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(storyTextRule).toContain('height: 160px')
    expect(storyTextRule).toContain('overflow-y: auto')
  })

  it('exposes dedicated Mock rule examples and update confirmation controls', () => {
    expect(page).toContain("showRuleExample('language-chinese')")
    expect(page).toContain("showRuleExample('language-english')")
    expect(page).toContain("showRuleExample('language-mixed')")
    expect(page).toContain("showRuleExample('visual-boundary')")
    expect(page).toContain("showRuleExample('child-friendly')")
    expect(page).toContain('确认局部补录并更新故事卡')
    expect(page).toContain('确认完整重录并覆盖故事卡')
    expect(page).toContain('原始完整录音引用：{{ confirmedCard.originalAudioRef }}')
  })

  it('clearly distinguishes fixed Mock output from real-recording verification', () => {
    expect(page).toContain('固定 Mock 的预设整理结果；不会识别或转写你本次录音')
    expect(page).toContain('只有这里会读取当前临时完整录音并发起真实 AI 调用')
  })
})
