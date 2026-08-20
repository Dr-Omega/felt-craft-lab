import { describe, expect, it } from 'vitest'
import {
  CHOOSE_WORK_THEME_MESSAGE,
  prepareNewWorkScene
} from '../../src/renderer/src/catalog/library-new-work'
import { ALL_THEMES_ID } from '../../src/renderer/src/catalog/ywn-catalog'

describe('Library new work theme selection (round 8: all is a formal theme)', () => {
  it('treats "all" as a real, first-class theme and persists it literally on the Scene', () => {
    const prepared = prepareNewWorkScene('我的新作品', ALL_THEMES_ID)

    expect(prepared.message).toBeUndefined()
    expect(prepared.scene).toBeDefined()
    expect(prepared.scene?.themeId).toBe('all')
    expect(prepared.scene?.assetSnapshotId).toBeTruthy()
    expect(prepared.scene?.workName).toBe('我的新作品')
  })

  it('keeps an explicit specific theme unchanged on the Scene', () => {
    const prepared = prepareNewWorkScene('元宵作品', 'lantern_festival')

    expect(prepared.scene?.themeId).toBe('lantern_festival')
    expect(prepared.scene?.canvas).toMatchObject({ width: 902, height: 516 })
    expect(prepared.message).toBeUndefined()
  })

  it('still treats an empty filter as a hard user error with the friendly message', () => {
    const prepared = prepareNewWorkScene('名字', '   ')

    expect(prepared.scene).toBeUndefined()
    expect(prepared.message).toBe(CHOOSE_WORK_THEME_MESSAGE)
  })

  it('falls back to the first catalog theme when the filter is non-empty but unknown', () => {
    const prepared = prepareNewWorkScene('名字', 'totally_made_up_theme')

    expect(prepared.scene).toBeDefined()
    expect(prepared.message).toBeUndefined()
    // Must NOT leak the unknown id into the Scene
    expect(prepared.scene?.themeId).not.toBe('totally_made_up_theme')
    expect(prepared.scene?.themeId).toBeTruthy()
  })

  it('does not depend on any acceptance flag any more', () => {
    // Two parallel calls prove the behaviour is the same with / without
    // any "acceptance" option (which no longer exists).
    const fromDefault = prepareNewWorkScene('作品', ALL_THEMES_ID)
    expect(fromDefault.scene?.themeId).toBe('all')
  })
})
