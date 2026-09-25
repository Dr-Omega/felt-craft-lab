import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const app = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')
const nav = readFileSync(resolve('src/renderer/src/app-nav.ts'), 'utf8')
const page = readFileSync(resolve('src/renderer/src/pages/LearningZoneTestPage.vue'), 'utf8')

describe('学习区测试入口', () => {
  it('uses the requested label and app view', () => {
    expect(app).toContain('学习区测试')
    expect(app).toContain("view === 'learning-zone-test'")
    expect(nav).toContain("'learning-zone-test'")
    expect(nav).toContain('openLearningZoneTest')
  })

  it('embeds a configurable learning zone URL with a local default', () => {
    expect(page).toContain('VITE_LEARNING_ZONE_URL')
    expect(page).toContain("http://127.0.0.1:3000/")
    expect(page).not.toContain('target="_blank"')
    expect(page).not.toContain('新窗口打开')
    expect(page).toContain('<iframe')
    expect(page).toContain('allow="autoplay"')
  })

  it('expands the embedded game so the outer page can scroll normally', () => {
    expect(page).toContain('embeddedPageHeight')
    expect(page).toContain('ResizeObserver')
    expect(page).toContain('document.documentElement.scrollHeight')
    expect(page).toContain('@load="fitFrameToEmbeddedPage"')
    expect(page).not.toMatch(/\.learning-zone-frame-wrap,\s*\n\s*\.learning-zone-frame/)
    expect(page).toContain("closest?.('.sticker-tray')")
    expect(page).toContain("window.scrollBy({ top: event.deltaY * multiplier")
  })
})
