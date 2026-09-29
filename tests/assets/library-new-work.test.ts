import { describe, expect, it } from 'vitest'
import {
  prepareNewWorkScene
} from '../../src/renderer/src/catalog/library-new-work'

describe('Library new work theme selection', () => {
  it('creates a Scene from the default all-themes filter', () => {
    const prepared = prepareNewWorkScene('我的新作品', 'all')

    expect(prepared.scene?.workName).toBe('我的新作品')
    expect(prepared.scene?.themeId).toBeTruthy()
    expect(prepared.scene?.themeId).not.toBe('all')
    expect(prepared.message).toBeUndefined()
  })

  it('creates a Scene with the explicitly selected theme', () => {
    const prepared = prepareNewWorkScene('元宵作品', 'lantern_festival')

    expect(prepared.scene?.themeId).toBe('lantern_festival')
    expect(prepared.scene?.canvas).toMatchObject({ width: 960, height: 960 })
    expect(prepared.message).toBeUndefined()
  })

})
