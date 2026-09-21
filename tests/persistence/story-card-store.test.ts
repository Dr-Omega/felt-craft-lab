import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StoryCard } from '../../src/shared/contracts'
import {
  createFeltCraftDatabase,
  setFeltCraftDatabaseForTests,
  StoryCardStore,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'

function storyCard(overrides: Partial<StoryCard> = {}): StoryCard {
  return {
    workId: 'work-story-card-001',
    artworkImageRef: 'felt-resource://preview/work-story-card-001.png',
    title: '小兔子的花园故事',
    storyText: '小兔子在花园里找朋友。',
    originalAudioRef: 'felt-resource://audio/work-story-card-001.mp3',
    confirmedAt: '2026-09-21T00:00:00.000Z',
    ...overrides
  }
}

describe('StoryCardStore', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-story-card-${crypto.randomUUID()}`)
    setFeltCraftDatabaseForTests(db)
  })

  afterEach(async () => {
    setFeltCraftDatabaseForTests(undefined)
    await db.delete()
  })

  it('uses workId as the unique key and replaces the existing card', async () => {
    const store = new StoryCardStore(db)
    const first = storyCard()
    const replacement = storyCard({
      title: '小兔子的月夜故事',
      storyText: '小兔子在月夜花园里和朋友一起玩。',
      confirmedAt: '2026-09-21T01:00:00.000Z'
    })

    await store.create(first)
    await expect(store.create(replacement)).rejects.toMatchObject({ name: 'ConstraintError' })
    await store.replace(replacement)

    expect(await db.storyCards.count()).toBe(1)
    expect(await store.getByWorkId(first.workId)).toEqual(replacement)
  })
})
