import { beforeEach, describe, expect, it } from 'vitest'
import { getAppView, openLearningZoneTest, openLibrary } from '../../src/renderer/src/app-nav'

describe('学习区测试导航入口', () => {
  beforeEach(() => {
    openLibrary()
  })

  it('opens the learning zone test view', () => {
    openLearningZoneTest()
    expect(getAppView()).toBe('learning-zone-test')
  })
})
