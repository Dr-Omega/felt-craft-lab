import { describe, expect, it } from 'vitest'
import {
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
    expect(prepared.scene?.canvas).toMatchObject({ width: 960, height: 960 })
    expect(prepared.message).toBeUndefined()
  })
})
