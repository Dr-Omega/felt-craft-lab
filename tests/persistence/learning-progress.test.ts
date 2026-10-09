import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFeltCraftDatabase, type FeltCraftDatabase } from '../../src/renderer/src/persistence/db'
import { saveLearningCompletion, completedThemes } from '../../src/renderer/src/learning-zone/progress'
import { CATALOG_ASSETS, YWN_SNAPSHOT_ID } from '../../src/renderer/src/catalog/ywn-catalog'
import type { LearningCompletion } from '../../src/shared/learning'

describe('learning transaction, migration and permission separation', () => {
  let db: FeltCraftDatabase
  const expected = { userId: 'user_demo_001', themeId: 'mid_autumn_festival', sessionId: 'session-1', assetSnapshotId: YWN_SNAPSHOT_ID }
  const receipt: LearningCompletion = { ...expected, completedAt: '2026-10-08T08:00:00.000Z',
    stickerIds: CATALOG_ASSETS.filter(a => a.type === 'sticker' && a.themeId === expected.themeId).map(a => a.assetId) }
  beforeEach(() => { db = createFeltCraftDatabase(`learning-${crypto.randomUUID()}`) })
  afterEach(async () => { await db.delete() })
  it('saves once, unlocks only the completed theme and never shares across users/snapshots', async () => {
    await saveLearningCompletion(db, receipt, expected, CATALOG_ASSETS)
    await saveLearningCompletion(db, { ...receipt, completedAt: '2026-10-09T08:00:00.000Z' }, expected, CATALOG_ASSETS)
    expect(await db.learningProgress.count()).toBe(1)
    const access = await db.assetAccess.toArray()
    expect(access).toHaveLength(CATALOG_ASSETS.filter(a => a.themeId === expected.themeId).length)
    expect(access.every(a => a.unlockSource === 'theme_complete' && a.updatedAt === receipt.completedAt)).toBe(true)
    expect(await completedThemes(db, expected.userId, YWN_SNAPSHOT_ID)).toEqual([expected.themeId])
    expect(await completedThemes(db, 'other-user', YWN_SNAPSHOT_ID)).toEqual([])
    expect(await completedThemes(db, expected.userId, 'other-snapshot')).toEqual([])
  })
  it.each([
    { userId: 'other' }, { themeId: 'spring_festival' }, { sessionId: 'wrong' },
    { assetSnapshotId: 'wrong' }, { stickerIds: [] }, { stickerIds: ['foreign'] },
    { stickerIds: [...receipt.stickerIds, receipt.stickerIds[0]] }, { completedAt: 'not-a-date' }
  ])('rejects invalid receipts without partial writes: %j', async change => {
    await expect(saveLearningCompletion(db, { ...receipt, ...change }, expected, CATALOG_ASSETS)).rejects.toThrow()
    expect(await db.learningProgress.count()).toBe(0)
    expect(await db.assetAccess.count()).toBe(0)
  })
  it('rolls back permissions if saving completion fails', async () => {
    const fail = () => { throw new Error('storage failure') }
    db.learningProgress.hook('creating', fail)
    await expect(saveLearningCompletion(db, receipt, expected, CATALOG_ASSETS)).rejects.toThrow('storage failure')
    expect(await db.assetAccess.count()).toBe(0)
    expect(await db.learningProgress.count()).toBe(0)
  })
  it('preserves V3 stories while adding an empty authoritative completion ledger', async () => {
    const old = new Dexie(db.name)
    old.version(3).stores({ storyCards: 'workId, confirmedAt' })
    const story = { workId: 'work-1', title: '我的故事', storyText: '未公开文字', confirmedAt: receipt.completedAt }
    await old.table('storyCards').put(story)
    old.close()
    await db.open()
    expect(await db.storyCards.get('work-1')).toEqual(story)
    expect(await db.learningProgress.count()).toBe(0)
  })
})
