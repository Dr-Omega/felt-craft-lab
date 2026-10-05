import { beforeEach, describe, expect, it } from 'vitest'
import { getAppView, openLearningZone, openLibrary } from '../../src/renderer/src/app-nav'

describe('学习区导航入口', () => {
  beforeEach(() => {
    openLibrary()
  })

  it('opens the formal learning zone view', () => {
    openLearningZone()
    expect(getAppView()).toBe('learning-zone')
  })
})
