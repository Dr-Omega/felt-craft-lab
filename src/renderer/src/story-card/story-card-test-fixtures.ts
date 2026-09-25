import type { StoryCardWorkContext } from '@shared/contracts'

/** Completed-work fixture used only by the phase 5 story-card test flow. */
export const STORY_CARD_TEST_WORK_CONTEXT: StoryCardWorkContext = {
  workId: 'story-card-mock-work-001',
  completionStatus: 'completed',
  artworkImageRef: 'felt-resource://material/snapshot_ywn_20260805_112922/background_osmanthus_moon_001.png',
  background: { name: '月夜花园', themeName: '中秋' },
  subject: { name: '小兔子' },
  stickers: [{ name: '灯笼', themeName: '元宵' }, { name: '星星贴纸', themeName: '中秋' }]
}

/** Latest artwork fixture used only to simulate a completed-work update in Phase 5. */
export const STORY_CARD_TEST_UPDATED_WORK_CONTEXT: StoryCardWorkContext = {
  ...STORY_CARD_TEST_WORK_CONTEXT,
  artworkImageRef: 'felt-resource://material/snapshot_ywn_20260805_112922/background_lake_moon_001.png'
}
