import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(`src/renderer/src/${path}`, 'utf8')

describe('reported UI regressions', () => {
  it('removes duplicate lobby labels while keeping the original navigation', () => {
    const lobby = read('pages/LobbyPage.vue')
    expect(lobby).not.toContain('lobby-user')
    expect(lobby).not.toContain('开始创作')
    expect(lobby).toContain('aria-label="进入个人空间" @click="openPersonalCenter"')
    expect(lobby).toContain('aria-label="进入创作区"')
    expect(lobby).toContain('@click="openCreate"')
  })

  it('preserves the removed heading space above the theme stickers', () => {
    const learning = read('pages/LearningZonePage.vue')
    expect(learning).not.toContain('<h3>主题贴纸</h3>')
    expect(learning).toMatch(/\.theme-preview-stickers\s*\{[^}]*padding-top:\s*36px/)
  })

  it('distinguishes actual layer processing stages without adding permanent instructions', () => {
    const panel = read('components/projection/ElementLayerEditor.vue')
    expect(panel).toContain("job.value?.status === 'background' ? '正在处理图片…'")
    expect(panel).toContain("job.value?.status === 'fabrication' ? '正在拆分图层…'")
  })
})
