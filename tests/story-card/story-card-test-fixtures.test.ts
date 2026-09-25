import { describe, expect, it } from 'vitest'
import {
  STORY_CARD_TEST_UPDATED_WORK_CONTEXT,
  STORY_CARD_TEST_WORK_CONTEXT
} from '../../src/renderer/src/story-card/story-card-test-fixtures'

describe('STORY_CARD_TEST_WORK_CONTEXT', () => {
  it('provides a completed work with its artwork and creative elements', () => {
    expect(STORY_CARD_TEST_WORK_CONTEXT).toMatchObject({
      completionStatus: 'completed',
      artworkImageRef: expect.any(String),
      background: { name: expect.any(String) },
      subject: { name: expect.any(String) }
    })
    expect(STORY_CARD_TEST_WORK_CONTEXT.stickers).not.toHaveLength(0)
    expect(STORY_CARD_TEST_WORK_CONTEXT.artworkImageRef).toBe(
      'felt-resource://material/snapshot_ywn_20260805_112922/background_osmanthus_moon_001.png'
    )
  })

  it('provides a distinct valid artwork reference for the update test', () => {
    expect(STORY_CARD_TEST_UPDATED_WORK_CONTEXT).toMatchObject({
      workId: STORY_CARD_TEST_WORK_CONTEXT.workId,
      completionStatus: 'completed'
    })
    expect(STORY_CARD_TEST_UPDATED_WORK_CONTEXT.artworkImageRef)
      .not.toBe(STORY_CARD_TEST_WORK_CONTEXT.artworkImageRef)
  })
})
