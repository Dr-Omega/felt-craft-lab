import { describe, expect, it } from 'vitest'
import type { StoryCardWorkContext } from '../../src/shared/contracts'
import { createFreshAcceptanceWorkContext } from '../../src/renderer/src/story-card/acceptance-work-context'

const context: StoryCardWorkContext = {
  workId: 'completed-work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/completed-work-001.png',
  background: { name: '月夜花园' },
  subject: { name: '小兔子' },
  stickers: [{ name: '灯笼' }]
}

describe('story-card acceptance work context', () => {
  it('uses a fresh work id so each direct launch begins a new story-card flow', () => {
    const fresh = createFreshAcceptanceWorkContext(context, 'run-001')

    expect(fresh).toEqual({ ...context, workId: 'story-card-acceptance-run-001' })
  })
})
