import { describe, expect, it } from 'vitest'
import type { AssetRecord, ProjectRecord } from '../../src/shared/contracts'
import {
  enterStoryCardAfterWorkCompleted,
  type StoryCardEntryDependencies
} from '../../src/renderer/src/story-card/story-card-entry.service'
import { cloneFixture, validAsset } from '../shared/contracts.fixtures'
import { validFeltProject } from '../persistence/fixtures'

function asset(overrides: Partial<AssetRecord> & Pick<AssetRecord, 'assetId' | 'type'>): AssetRecord {
  return { ...cloneFixture(validAsset), ...overrides }
}

function dependencies(work: ProjectRecord | undefined): StoryCardEntryDependencies {
  return {
    workReader: { get: async () => work },
    assetReader: {
      listBySnapshot: () => {
        if (!work) return []
        return [
          asset({
            assetId: 'background_moon_001',
            type: 'background',
            nameZh: '月夜花园',
            themeId: 'mid_autumn_festival'
          }),
          asset({
            assetId: work.scene.objects[0].assetId,
            type: 'sticker',
            nameZh: '灯笼',
            themeId: 'lantern_festival'
          })
        ]
      }
    }
  }
}

async function expectStoryCardError(
  action: () => Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await action()
  } catch (error) {
    expect(error).toMatchObject({ shared: { code, retryable: false } })
    return
  }
  throw new Error(`Expected ${code} error.`)
}

describe('enterStoryCardAfterWorkCompleted', () => {
  it('returns the initial story-card context for a completed work', async () => {
    const work = validFeltProject({
      previewUrl: 'felt-resource://preview/entrylatest00411181111111111111.png'
    })

    await expect(enterStoryCardAfterWorkCompleted(work.projectId, dependencies(work))).resolves.toEqual({
      workId: work.projectId,
      completionStatus: 'completed',
      artworkImageRef: work.previewUrl,
      background: { name: '月夜花园', themeName: '中秋' },
      subject: { name: '小兔子' },
      stickers: [{ name: '灯笼', themeName: '元宵' }]
    })
  })

  it('does not enter the story-card flow for a missing work', async () => {
    await expectStoryCardError(
      () => enterStoryCardAfterWorkCompleted('missing-work', dependencies(undefined)),
      'WORK_NOT_FOUND'
    )
  })

  it('does not enter the story-card flow for a draft work', async () => {
    const work = validFeltProject({ completionStatus: 'draft' })

    await expectStoryCardError(
      () => enterStoryCardAfterWorkCompleted(work.projectId, dependencies(work)),
      'WORK_NOT_COMPLETED'
    )
  })
})
