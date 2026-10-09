import { describe, expect, it } from 'vitest'
import {
  isAcceptanceAllThemesInEditorEnabled,
  CHOOSE_WORK_THEME_MESSAGE,
  prepareNewWorkScene
} from '../../src/renderer/src/catalog/library-new-work'

describe('Library new work theme selection', () => {
  it('does not create a Scene from the all-themes filter', () => {
    const prepared = prepareNewWorkScene('我的新作品', 'all')

    expect(prepared.scene).toBeUndefined()
    expect(prepared.message).toBe('请先选择作品主题')
    expect(prepared.message).toBe(CHOOSE_WORK_THEME_MESSAGE)
  })

  it('creates a Scene with the explicitly selected theme', () => {
    const prepared = prepareNewWorkScene('元宵作品', 'lantern_festival')

    expect(prepared.scene?.themeId).toBe('lantern_festival')
    expect(prepared.scene?.canvas).toMatchObject({ width: 1302, height: 858 })
    expect(prepared.message).toBeUndefined()
  })

  it('recognizes only the explicit acceptance flag', () => {
    expect(isAcceptanceAllThemesInEditorEnabled('true')).toBe(true)
    expect(isAcceptanceAllThemesInEditorEnabled('false')).toBe(false)
    expect(isAcceptanceAllThemesInEditorEnabled(undefined)).toBe(false)
  })

  it('allows all themes only when acceptance mode is enabled and keeps a valid Scene theme', () => {
    const prepared = prepareNewWorkScene('全主题验收作品', 'all', { allowAllThemes: true })

    expect(prepared.scene).toBeDefined()
    expect(prepared.scene?.themeId).not.toBe('all')
    expect(prepared.scene?.themeId).toBeTruthy()
    expect(prepared.scene?.assetSnapshotId).toBeTruthy()
    expect(prepared.message).toBeUndefined()
  })
})
