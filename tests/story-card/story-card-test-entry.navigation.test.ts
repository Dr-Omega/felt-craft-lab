import { afterEach, describe, expect, it } from 'vitest'
import type { StoryCardWorkContext } from '../../src/shared/contracts'
import {
  getAppView,
  getStoryCardTestContext,
  openLibrary,
  openStoryCardTest
} from '../../src/renderer/src/app-nav'

const workContext: StoryCardWorkContext = {
  workId: 'completed-work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/completed-work-001.png',
  background: { name: '月夜花园' },
  subject: { name: '小兔子' },
  stickers: [{ name: '灯笼' }]
}

describe('story-card test entry navigation', () => {
  afterEach(() => {
    openLibrary()
  })

  it('opens the story-card test view', () => {
    openStoryCardTest()

    expect(getAppView()).toBe('story-card-test')
  })

  it('keeps the completed work context for the story-card test view', () => {
    openStoryCardTest(workContext)

    expect(getStoryCardTestContext()).toEqual(workContext)
  })
})
