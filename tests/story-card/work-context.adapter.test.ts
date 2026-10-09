import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type { AssetRecord, ProjectRecord } from '../../src/shared/contracts'
import { createFeltCraftDatabase } from '../../src/renderer/src/persistence/db'
import {
  adaptStoryCardWorkContext,
  type StoryCardAssetReader
} from '../../src/renderer/src/story-card/work-context.adapter'
import { cloneFixture, validAsset } from '../shared/contracts.fixtures'
import { validFeltProject } from '../persistence/fixtures'

function asset(overrides: Partial<AssetRecord> & Pick<AssetRecord, 'assetId' | 'type'>): AssetRecord {
  return { ...cloneFixture(validAsset), ...overrides }
}

function reader(assets: readonly AssetRecord[]): StoryCardAssetReader {
  return { listBySnapshot: () => assets }
}

function expectStoryCardError(action: () => void, code: string): void {
  try {
    action()
  } catch (error) {
    expect(error).toMatchObject({ shared: { code, retryable: false } })
    return
  }
  throw new Error(`Expected ${code} error.`)
}

describe('adaptStoryCardWorkContext', () => {
  it('returns only the story-card fields from a completed work and its latest preview', () => {
    const work = validFeltProject({
      previewUrl: 'felt-resource://preview/latestwork0041118111111111111111.png'
    })
    const background = asset({
      assetId: 'background_moon_001',
      type: 'background',
      nameZh: '月夜花园',
      themeId: 'mid_autumn_festival'
    })
    const sticker = asset({
      assetId: work.scene.objects[0].assetId,
      type: 'sticker',
      nameZh: '灯笼',
      themeId: 'lantern_festival'
    })

    const context = adaptStoryCardWorkContext(work, reader([background, sticker]))

    expect(context).toEqual({
      workId: work.projectId,
      completionStatus: 'completed',
      artworkImageRef: work.previewUrl,
      background: { name: '月夜花园', themeName: '中秋' },
      subject: { name: work.projectName },
      stickers: [{ name: '灯笼', themeName: '元宵' }]
    })
    expect(context).not.toHaveProperty('scene')
  })

  it('rejects a work without any visible content', () => {
    const work = validFeltProject()
    work.scene.objects = []
    work.scene.backgroundAssetId = null

    expectStoryCardError(() => adaptStoryCardWorkContext(work, reader([])), 'WORK_NOT_COMPLETED')
  })

  it('rejects a referenced material missing from the work snapshot', () => {
    const work = validFeltProject()

    expectStoryCardError(() => adaptStoryCardWorkContext(work, reader([])), 'ASSET_NOT_FOUND')
  })
})

describe('subject migration', () => {
  it('preserves legacy scenes and personal asset tables during additive story migration', async () => {
    const databaseName = `felt-legacy-subject-${crypto.randomUUID()}`
    const legacyDb = new Dexie(databaseName)
    const schema = {
      drafts: 'draftId, updatedAt',
      projects: 'projectId, updatedAt, projectName',
      personalAssets: 'personalAssetId, userId, role, updatedAt',
      personalAssetVersions: 'versionId, personalAssetId, versionNumber, createdAt',
      assetAccess: '[userId+assetId], userId, assetId, updatedAt',
      favorites: '[userId+assetId], userId, assetId, createdAt'
    }
    legacyDb.version(2).stores(schema)
    await legacyDb.open()

    const project = validFeltProject()
    const draft = { ...validFeltProject().scene }
    await legacyDb.table('projects').put(project)
    await legacyDb.table('drafts').put({
      draftId: 'cc2b2db3-0ef0-4db9-a89c-b2fb0eff1dc1',
      scene: draft,
      updatedAt: draft.updatedAt,
      status: 'draft'
    })
    legacyDb.close()

    const currentDb = createFeltCraftDatabase(databaseName)
    const migratedProject = await currentDb.projects.get(project.projectId)
    const migratedDraft = await currentDb.drafts.get('cc2b2db3-0ef0-4db9-a89c-b2fb0eff1dc1')

    expect(migratedProject?.scene).toEqual(project.scene)
    expect(migratedDraft?.scene).toEqual(draft)
    await currentDb.delete()
  })
})
