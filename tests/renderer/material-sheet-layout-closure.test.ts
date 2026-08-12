// @vitest-environment jsdom
/**
 * V4.6 第 7 轮：素材卡 / 搜索 / footer / 音频 / QA 视觉收口验收
 *
 * 这是一个轻量级"源码 + 渲染 DOM 双重检查"测试。它不替代 Electron
 * 真实视觉验收，但能在 CI 早期就拦下：
 *  - 素材卡重叠（aspect-ratio:1 被错误地放回 .material-card）
 *  - 名称还在 absolute 覆盖图片
 *  - 搜索区出现两个"搜索素材"
 *  - footer 仍然过高或英文名抢主视觉
 *  - 音频按钮还在用 🔊 emoji
 *  - QA 回答气泡还出现小圆点
 *  - 录音提示在顶部和输入框都重复
 *  - QA 空状态仍被 margin:auto 顶到中间
 *  - 分类 ID 直接出现给儿童
 *
 * 关键文件：
 *  - src/renderer/src/pages/EditorPage.vue（material-grid / material-card）
 *  - src/renderer/src/components/editor/MaterialSheet.vue
 *  - src/renderer/src/components/editor/AssetAudioControls.vue
 *  - src/renderer/src/components/editor/AssetQaSheet.vue
 *  - src/renderer/src/catalog/category-display.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const editorPage = readFileSync(resolve('src/renderer/src/pages/EditorPage.vue'), 'utf8')
const sheet = readFileSync(resolve('src/renderer/src/components/editor/MaterialSheet.vue'), 'utf8')
const sheetStyle = sheet.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
const audioControls = readFileSync(resolve('src/renderer/src/components/editor/AssetAudioControls.vue'), 'utf8')
const qaSheet = readFileSync(resolve('src/renderer/src/components/editor/AssetQaSheet.vue'), 'utf8')
const qaSheetStyle = qaSheet.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
const categoryDisplay = readFileSync(resolve('src/renderer/src/catalog/category-display.ts'), 'utf8')

describe('MaterialSheet layout closure (P0 — card overlap fix)', () => {
  it('material-card no longer forces a 1:1 whole-card box (was the overlap root cause)', () => {
    // The whole card used to carry `aspect-ratio: 1`, which forced the
    // card to stay square even when the grid row shrank, so the card
    // overflowed into the next row and visually overlapped the next line.
    expect(editorPage).toContain('.material-grid')
    expect(editorPage).toMatch(/\.material-grid\s*\{[^}]*grid-auto-rows:\s*max-content/)
    expect(editorPage).toMatch(/\.material-grid\s*\{[^}]*align-items:\s*start/)
    // The 1:1 ratio now lives on the image wrapper, not the whole card.
    expect(editorPage).not.toMatch(/\.material-card\s*\{[^}]*aspect-ratio:\s*1/)
    expect(editorPage).toMatch(/\.material-card-image\s*\{[^}]*aspect-ratio:\s*1/)
  })

  it('material-card has an independent paper-coloured name strip (not absolute on top of the image)', () => {
    expect(editorPage).toMatch(/\.material-card-name\s*\{[^}]*position:\s*static/)
    // Must NOT be positioned absolute (was the readability-on-dark-image bug)
    expect(editorPage).not.toMatch(/\.material-card-name\s*\{[^}]*position:\s*absolute/)
    // Has a min-height so all cards line up to the same row height
    expect(editorPage).toMatch(/\.material-card-name\s*\{[^}]*min-height:\s*28px/)
    // The text colour is the warm wood brown, not on top of an image
    expect(editorPage).toMatch(/\.material-card-name\s*\{[^}]*color:\s*var\(--color-text/)
  })

  it('MaterialSheet wraps the image in material-card-image so the lock badge stays on the picture, not the name strip', () => {
    expect(sheet).toContain('class="material-card-image"')
    // card-lock stays inside the image area, not the card
    expect(sheet).toMatch(/<span class="material-card-image">[\s\S]*?card-lock/)
  })
})

describe('MaterialSheet search bar (no duplicate 搜索素材)', () => {
  it('keeps the descriptive label only on aria-label and shows a single child-friendly placeholder', () => {
    expect(sheet).toContain('aria-label="搜索素材"')
    expect(sheet).toContain('placeholder="找一找素材……"')
    // The visible-label class is gone
    expect(sheet).not.toContain('class="sheet-search-label"')
    expect(sheet).not.toContain('>搜索素材<')
  })
})

describe('MaterialSheet footer compression', () => {
  it('English name is visibly de-emphasised compared to the Chinese name', () => {
    const zhStyle = sheetStyle.match(/\.sheet-footer-name-zh\s*\{[^}]*\}/)?.[0] ?? ''
    const enStyle = sheetStyle.match(/\.sheet-footer-name-en\s*\{[^}]*\}/)?.[0] ?? ''
    expect(zhStyle).toMatch(/font-size:\s*14px/)
    expect(zhStyle).toMatch(/font-weight:\s*700/)
    expect(enStyle).toMatch(/font-size:\s*10px/)
    // The English name is intentionally lighter than the Chinese name
    const zhSize = Number(zhStyle.match(/font-size:\s*(\d+)px/)?.[1] ?? 0)
    const enSize = Number(enStyle.match(/font-size:\s*(\d+)px/)?.[1] ?? 0)
    expect(zhSize).toBeGreaterThan(enSize)
  })

  it('footer has tighter vertical padding than the 10/14 default', () => {
    expect(sheetStyle).toMatch(/\.sheet-footer\s*\{[^}]*padding:\s*8px 24px 12px/)
  })
})

describe('AssetAudioControls (no blue emoji, short labels)', () => {
  it('no longer uses the speaker emoji; replaced with a single-color SVG icon', () => {
    expect(audioControls).not.toContain('🔊')
    expect(audioControls).toMatch(/<svg[^>]*class="asset-audio-icon"/)
    // Uses currentColor so the icon tracks the text color of the button
    expect(audioControls).toContain('fill="currentColor"')
  })

  it('uses short child-friendly labels (中文 / English / 介绍)', () => {
    expect(audioControls).toContain("label: '中文'")
    expect(audioControls).toContain("label: 'English'")
    expect(audioControls).toContain("label: '介绍'")
  })
})

describe('AssetQaSheet (empty state, recording de-dup, no dot)', () => {
  it('removes the orange dot before the assistant answer bubble', () => {
    // The .asset-qa-bubble.is-assistant::before used to inject a 4px apricot
    // dot that read like a list bullet, not a chat reply.
    expect(qaSheetStyle).not.toMatch(/\.asset-qa-bubble\.is-assistant::before/)
  })

  it('no longer centres the empty state with margin: auto 0 (no big middle gap)', () => {
    const emptyBlock = qaSheetStyle.match(/\.asset-qa-empty\s*\{[^}]*\}/)?.[0] ?? ''
    expect(emptyBlock).toBeTruthy()
    expect(emptyBlock).not.toMatch(/margin:\s*auto/)
    expect(emptyBlock).toMatch(/text-align:\s*left/)
  })

  it('recording: input placeholder no longer repeats the voice-bar text', () => {
    // The voice bar still says e.g. "莲花河灯正在听你说……"; the input now
    // tells the child the next action instead of duplicating the same line.
    const inputPlaceholderBlock = qaSheet.match(/const inputPlaceholder = computed[\s\S]*?\n\}\)/)?.[0] ?? ''
    expect(inputPlaceholderBlock).toBeTruthy()
    expect(inputPlaceholderBlock).toContain('说完点')
    // The recording branch should NOT contain the asset-anchored "正在听你说" line
    // (that's the voice bar's job); it should hand off the action to the child.
    expect(inputPlaceholderBlock).toContain('停止')
    expect(inputPlaceholderBlock).not.toContain("正在听你说")
  })
})

describe('Category display (no snake_case leaks to children)', () => {
  it('every known festival id maps to a Chinese display name without underscores', () => {
    const mapBlock = categoryDisplay.match(/KNOWN_CATEGORY_DISPLAY[\s\S]*?\}\)/)?.[0] ?? ''
    expect(mapBlock).toBeTruthy()
    expect(mapBlock).toContain("festival_scene: '场景'")
    expect(mapBlock).toContain("festival_decoration: '装饰'")
    expect(mapBlock).toContain("festival_food: '食物'")
    expect(mapBlock).toContain("festival_story: '故事角色'")
    expect(mapBlock).toContain("festival_poetry: '诗词'")
    expect(mapBlock).toContain("festival_custom: '习俗'")
  })

  it('falls back to the pin-able UNKNOWN_CATEGORY_DISPLAY instead of leaking the raw id', () => {
    expect(categoryDisplay).toContain('UNKNOWN_CATEGORY_DISPLAY')
    const fnBody = categoryDisplay.match(/function categoryDisplayName[\s\S]*?\n}/)?.[0] ?? ''
    expect(fnBody).not.toMatch(/\?\?\s*categoryId/)
    expect(fnBody).toContain('UNKNOWN_CATEGORY_DISPLAY')
  })
})
