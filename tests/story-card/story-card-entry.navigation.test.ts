import { afterEach, describe, expect, it } from 'vitest'
import type { StoryCardWorkContext } from '../../src/shared/contracts'
import {
  getAppView,
  getStoryCardContext,
  openLibrary,
  openStoryCard
} from '../../src/renderer/src/app-nav'

const workContext: StoryCardWorkContext = {
  workId: 'completed-work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/completed-work-001.png',
  background: { name: '月夜花园' },
  subject: { name: '小兔子' },
  stickers: [{ name: '灯笼' }]
}

describe('story-card entry navigation', () => {
  afterEach(() => {
    openLibrary()
  })

  it('opens the formal story-card view with the completed work context', () => {
    openStoryCard(workContext)

    expect(getAppView()).toBe('story-card')
    expect(getStoryCardContext()).toEqual(workContext)
  })
})
