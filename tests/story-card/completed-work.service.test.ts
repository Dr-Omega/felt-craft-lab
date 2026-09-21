import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type { ProjectRecord } from '../../src/shared/contracts'
import { createFeltCraftDatabase } from '../../src/renderer/src/persistence/db'
import { PersistenceError } from '../../src/renderer/src/persistence/errors'
import {
  requireCompletedWork,
  type StoryCardWorkReader
} from '../../src/renderer/src/story-card/completed-work.service'
import { validFeltProject } from '../persistence/fixtures'

function reader(work: ProjectRecord | undefined): StoryCardWorkReader {
  return { get: async () => work }
}

describe('requireCompletedWork', () => {
  it('returns WORK_NOT_FOUND when the work does not exist', async () => {
    await expect(requireCompletedWork('missing-work', reader(undefined))).rejects.toMatchObject({
      name: PersistenceError.name,
      shared: { code: 'WORK_NOT_FOUND', retryable: false }
    })
  })

  it('returns WORK_NOT_COMPLETED for a draft work', async () => {
    const work = validFeltProject({ completionStatus: 'draft' })

    await expect(requireCompletedWork(work.projectId, reader(work))).rejects.toMatchObject({
      name: PersistenceError.name,
      shared: { code: 'WORK_NOT_COMPLETED', retryable: false }
    })
  })

  it('returns a completed work for the next story-card step', async () => {
    const work = validFeltProject({ completionStatus: 'completed' })

    await expect(requireCompletedWork(work.projectId, reader(work))).resolves.toEqual(work)
  })
})

describe('project completion status migration', () => {
  it('marks a legacy project without completionStatus as draft', async () => {
    const databaseName = `felt-legacy-project-${crypto.randomUUID()}`
    const legacyDb = new Dexie(databaseName)
    const schema = {
      drafts: 'draftId, updatedAt',
      projects: 'projectId, updatedAt, projectName',
      storyCards: 'workId, confirmedAt',
      assetAccess: '[userId+assetId], userId, assetId, updatedAt',
      favorites: '[userId+assetId], userId, assetId, createdAt'
    }
    legacyDb.version(2).stores(schema)
    await legacyDb.open()

    const legacyProject = { ...validFeltProject() } as Record<string, unknown>
    delete legacyProject.completionStatus
    await legacyDb.table('projects').put(legacyProject)
    legacyDb.close()

    const currentDb = createFeltCraftDatabase(databaseName)
    const migrated = await currentDb.projects.get(String(legacyProject.projectId))

    expect(migrated?.completionStatus).toBe('draft')
    await currentDb.delete()
  })
})
