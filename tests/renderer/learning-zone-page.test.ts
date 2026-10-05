import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const app = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')
const nav = readFileSync(resolve('src/renderer/src/app-nav.ts'), 'utf8')
const page = readFileSync(resolve('src/renderer/src/pages/LearningZonePage.vue'), 'utf8')

describe('学习区正式入口', () => {
  it('uses the formal book UI and its unit-to-topic selection layout', () => {
    expect(app).toContain('学习区')
    expect(app).toContain("view === 'learning-zone'")
    expect(nav).toContain("'learning-zone'")
    expect(nav).toContain('openLearningZone')
    expect(page).toContain('learning-book.png')
    expect(page).toContain('unit-card-frame.png')
    expect(page).toContain('topic-card-frame.png')
    expect(page).toContain("name: '书画'")
    expect(page).toContain("name: '动物'")
    expect(page).toContain('gridTemplateRows')
    expect(page).toContain('中英文名称')
    expect(page).toContain('中文介绍')
    expect(page).toContain("'background-card': asset.type === 'background'")
    expect(page).toContain('.topic-button .frame-image { transform: scale(1.035); }')
    expect(page).toContain('function unitListStyle()')
    expect(page).toContain('function unlockPanelStyle()')
    expect(page).toContain('function unlockedPanelStyle()')
    expect(page).toContain('function unlockFrameStyle()')
    expect(page).toContain("...box(400, 145, 180, 570, 31)")
    expect(page).toContain("...box(575, 150, 415, 880, 32)")
    expect(page).toContain("...box(1080, 205, 450, 330, 90)")
    expect(page).toContain("...box(1020, 155, 560, 825, 90)")
    expect(page).toContain("transform: 'scale(.8)'")
    expect(page).toContain('84px')
    expect(page).not.toContain('iframe')
  })
})
