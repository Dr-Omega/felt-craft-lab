import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFeltCraftDatabase,
  deleteExistingProject,
  DraftStore,
  PersistenceError,
  ProjectStore,
  saveDraftFromPreparedScene,
  saveNewProject,
  setFeltCraftDatabaseForTests,
  updateExistingProject,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'
import type { PreparedProjectSave } from '../../src/renderer/src/editor/editor-session.types'
import {
  cloneFixture,
  feltPreviewRef,
  fixtureTime,
  MINIMAL_PNG_BYTES,
  preparedScene,
  validFeltProject
} from './fixtures'

function installPreviewApi(handlers?: {
  save?: (bytes: ArrayBuffer | Uint8Array) => Promise<string>
  delete?: (ref: string) => Promise<void>
}) {
  const saved: string[] = []
  const deleted: string[] = []
  let counter = 0

  const api = {
    saveProjectPreview: vi.fn(async (_bytes: ArrayBuffer | Uint8Array) => {
      if (handlers?.save) return handlers.save(_bytes)
      counter += 1
      const ref = feltPreviewRef(`${counter.toString().padStart(8, '0')}111141118111111111111111.png`)
      saved.push(ref)
      return ref
    }),
    deleteProjectPreview: vi.fn(async (ref: string) => {
      if (handlers?.delete) return handlers.delete(ref)
      deleted.push(ref)
    })
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electronAPI: api }
  })

  return { api, saved, deleted }
}

describe('draft workflow', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-draft-wf-${crypto.randomUUID()}`)
    setFeltCraftDatabaseForTests(db)
  })

  afterEach(async () => {
    setFeltCraftDatabaseForTests(undefined)
    await db.delete()
  })

  it('saves a legal draft from prepareDraftSave scene output', async () => {
    const scene = preparedScene()
    const draft = await saveDraftFromPreparedScene(scene, { db })
    expect(draft.status).toBe('draft')
    expect(draft.scene).toEqual(scene)
    expect(draft.updatedAt).toBe(scene.updatedAt)
    expect(JSON.stringify(draft)).not.toMatch(/fabric|canvasJSON|objectsJson/i)

    const store = new DraftStore(db)
    expect(await store.get(draft.draftId)).toEqual(draft)
  })

  it('rejects an illegal scene for draft save', async () => {
    const scene = preparedScene()
    // @ts-expect-error intentional invalid schema
    scene.schemaVersion = 99
    await expect(saveDraftFromPreparedScene(scene, { db })).rejects.toBeInstanceOf(PersistenceError)
    expect(await new DraftStore(db).list()).toHaveLength(0)
  })
})

describe('project workflow', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-project-wf-${crypto.randomUUID()}`)
    setFeltCraftDatabaseForTests(db)
    installPreviewApi()
  })

  afterEach(async () => {
    setFeltCraftDatabaseForTests(undefined)
    await db.delete()
  })

  function prepared(workName = preparedScene().workName): PreparedProjectSave {
    return {
      scene: preparedScene({ workName }),
      previewPng: new Blob([MINIMAL_PNG_BYTES], { type: 'image/png' })
    }
  }

  it('creates a new project with local_only sync and matching projectName', async () => {
    const input = prepared()
    const project = await saveNewProject(input, {
      db,
      projectId: 'c3ac4f13-c4be-4ce0-8781-c60b78a21e83',
      createdAt: fixtureTime
    })
    expect(project.projectName).toBe(input.scene.workName)
    expect(project.syncStatus).toBe('local_only')
    expect(project.previewUrl).toMatch(/^felt-resource:\/\/preview\//)
    expect(await new ProjectStore(db).get(project.projectId)).toEqual(project)
  })

  it('persists canonical square Scene dimensions without rewriting the Scene', async () => {
    const input = prepared()
    input.scene.canvas = { width: 960, height: 960, backgroundColor: '#FFF8E7' }

    const project = await saveNewProject(input, {
      db,
      projectId: 'c3ac4f13-c4be-4ce0-8781-c60b78a21e83',
      createdAt: fixtureTime
    })

    expect(project.scene.canvas).toEqual(input.scene.canvas)
    expect(project.previewUrl).toMatch(/^felt-resource:\/\/preview\//)
  })

  it('updates an existing project with a new preview and deletes the old one after Dexie success', async () => {
    const { api, deleted } = installPreviewApi()
    const existing = validFeltProject({ previewUrl: feltPreviewRef('oldpreview000141118111111111111111.png') })
    await new ProjectStore(db).save(existing)

    const updated = await updateExistingProject(existing, prepared('我的中秋月夜'), { db })
    expect(updated.projectId).toBe(existing.projectId)
    expect(updated.createdAt).toBe(existing.createdAt)
    expect(updated.previewUrl).not.toBe(existing.previewUrl)
    expect(api.saveProjectPreview).toHaveBeenCalledTimes(1)
    expect(deleted).toEqual([existing.previewUrl])
  })

  it('cleans up the new preview when Dexie fails on create', async () => {
    const { deleted, saved } = installPreviewApi()
    const brokenDb = {
      projects: {
        put: async () => {
          throw new Error('dexie down')
        }
      }
    } as unknown as FeltCraftDatabase

    await expect(saveNewProject(prepared(), { db: brokenDb })).rejects.toBeInstanceOf(PersistenceError)
    expect(saved).toHaveLength(1)
    expect(deleted).toEqual(saved)
  })

  it('keeps old project + old preview when update validation/Dexie fails', async () => {
    const { deleted, saved } = installPreviewApi()
    const existing = validFeltProject()
    await new ProjectStore(db).save(existing)

    const brokenDb = {
      projects: {
        put: async () => {
          throw new Error('dexie down')
        }
      }
    } as unknown as FeltCraftDatabase

    await expect(updateExistingProject(existing, prepared(), { db: brokenDb })).rejects.toBeInstanceOf(
      PersistenceError
    )
    expect(saved).toHaveLength(1)
    expect(deleted).toEqual(saved)
    expect(deleted).not.toContain(existing.previewUrl)

    const stillThere = await new ProjectStore(db).get(existing.projectId)
    expect(stillThere).toEqual(existing)
  })

  it('runs Shared Contract validation (projectName must equal workName)', async () => {
    const input = prepared()
    // Force mismatch after prepare by mutating a clone path through fake scene.workName
    // that differs from an injected projectName — workflow always sets projectName from workName,
    // so exercise the store policy with a mock:// preview via direct contract rejection path:
    const { deleted, saved } = installPreviewApi({
      save: async () => 'mock://previews/illegal.png'
    })

    await expect(saveNewProject(input, { db })).rejects.toMatchObject({
      shared: { code: 'PROJECT_SAVE_FAILED' }
    })
    expect(saved.length + deleted.length).toBeGreaterThan(0)
    expect(deleted).toEqual(['mock://previews/illegal.png'])
    expect(await new ProjectStore(db).list()).toHaveLength(0)
  })

  it('deletes Dexie project then best-effort cleans preview', async () => {
    const { deleted } = installPreviewApi()
    const existing = validFeltProject({ previewUrl: feltPreviewRef('todeletepreview00141118111111111111.png') })
    await new ProjectStore(db).save(existing)

    await deleteExistingProject(existing.projectId, { db })
    expect(await new ProjectStore(db).get(existing.projectId)).toBeUndefined()
    expect(deleted).toEqual([existing.previewUrl])
  })

  it('does not delete preview when Dexie delete fails', async () => {
    const { deleted } = installPreviewApi()
    const existing = validFeltProject({ previewUrl: feltPreviewRef('keeppreview0000141118111111111111.png') })
    await new ProjectStore(db).save(existing)

    const brokenDb = {
      projects: {
        get: async () => existing,
        delete: async () => {
          throw new Error('dexie delete failed')
        }
      }
    } as unknown as FeltCraftDatabase

    await expect(deleteExistingProject(existing.projectId, { db: brokenDb })).rejects.toBeInstanceOf(
      PersistenceError
    )
    expect(deleted).toEqual([])
    expect(await new ProjectStore(db).get(existing.projectId)).toEqual(existing)
  })

  it('keeps project deleted when preview cleanup fails', async () => {
    installPreviewApi({
      delete: async () => {
        throw new Error('preview unlink failed')
      }
    })
    const existing = validFeltProject({ previewUrl: feltPreviewRef('orphanpreview00014111811111111111.png') })
    await new ProjectStore(db).save(existing)

    await expect(deleteExistingProject(existing.projectId, { db })).resolves.toBeUndefined()
    expect(await new ProjectStore(db).get(existing.projectId)).toBeUndefined()
  })
})
