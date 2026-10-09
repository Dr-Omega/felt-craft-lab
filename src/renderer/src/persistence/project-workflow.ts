import type { ProjectRecord } from '@shared/contracts'
import { validateProjectRecord } from '@shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource'
import type { PreparedProjectSave } from '../editor/editor-session.types'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { asPersistenceError, persistenceError } from './errors'
import { cleanupPreviewRef, deleteProjectPreviewRef, saveProjectPreviewBytes } from './preview-bridge'
import { DraftStore, ProjectStore } from './stores'

export type SaveNewProjectOptions = {
  /** Consume only this matching draft, atomically with the new saved work. */
  draftId?: string
  projectId?: string
  createdAt?: string
  db?: FeltCraftDatabase
}

export type UpdateProjectOptions = {
  db?: FeltCraftDatabase
}

function utcNow(): string {
  return new Date().toISOString()
}

function ensureUpdatedAt(sceneUpdatedAt: string, candidate: string): string {
  return Date.parse(candidate) < Date.parse(sceneUpdatedAt) ? sceneUpdatedAt : candidate
}

function buildProjectRecord(input: {
  projectId: string
  scene: PreparedProjectSave['scene']
  previewUrl: string
  createdAt: string
  updatedAt: string
}): ProjectRecord {
  return {
    projectId: input.projectId,
    projectName: input.scene.workName,
    scene: input.scene,
    previewUrl: input.previewUrl,
    syncStatus: 'local_only',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  }
}

/**
 * New Project save workflow.
 * Input MUST come from EditorSession.prepareProjectSave().
 * Order: unique preview → validate ProjectRecord → Dexie. Cleanup preview on failure.
 */
export async function saveNewProject(
  prepared: PreparedProjectSave,
  options: SaveNewProjectOptions = {}
): Promise<ProjectRecord> {
  const projectId = options.projectId ?? crypto.randomUUID()
  const createdAt = options.createdAt ?? utcNow()
  const updatedAt = ensureUpdatedAt(prepared.scene.updatedAt, utcNow())

  let newPreviewRef: string | undefined
  try {
    newPreviewRef = await saveProjectPreviewBytes(prepared.previewPng)

    const record = buildProjectRecord({
      projectId,
      scene: prepared.scene,
      previewUrl: newPreviewRef,
      createdAt,
      updatedAt
    })

    if (record.projectName !== prepared.scene.workName) {
      throw persistenceError('PROJECT_NAME_REQUIRED', 'projectName 必须与 scene.workName 完全一致。')
    }

    const validated = validateProjectRecord(record, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) {
      throw persistenceError('PROJECT_SAVE_FAILED', '作品记录未通过 Shared Contract 校验。')
    }

    const db = options.db ?? getFeltCraftDatabase()
    const store = new ProjectStore(db)
    if (!options.draftId) return await store.save(validated.value)
    return await db.transaction('rw', db.projects, db.drafts, async () => {
      const draft = await new DraftStore(db).get(options.draftId!)
      if (!draft || draft.scene.sceneId !== record.scene.sceneId || draft.scene.userId !== record.scene.userId) {
        throw persistenceError('PROJECT_SAVE_FAILED', '原草稿不存在或与当前作品不匹配，请保留画布并重试。')
      }
      const saved = await store.save(validated.value)
      await db.drafts.delete(draft.draftId)
      return saved
    })
  } catch (error) {
    await cleanupPreviewRef(newPreviewRef)
    throw asPersistenceError(error, 'PROJECT_SAVE_FAILED')
  }
}

/**
 * Update existing Project.
 * Keeps projectId + createdAt. Writes a new unique preview first; only after Dexie
 * succeeds does it delete the old preview. Old project+preview stay intact on failure.
 */
export async function updateExistingProject(
  existing: ProjectRecord,
  prepared: PreparedProjectSave,
  options: UpdateProjectOptions = {}
): Promise<ProjectRecord> {
  const updatedAt = ensureUpdatedAt(prepared.scene.updatedAt, utcNow())
  const previousPreview = existing.previewUrl

  let newPreviewRef: string | undefined
  try {
    newPreviewRef = await saveProjectPreviewBytes(prepared.previewPng)

    const record = buildProjectRecord({
      projectId: existing.projectId,
      scene: prepared.scene,
      previewUrl: newPreviewRef,
      createdAt: existing.createdAt,
      updatedAt
    })

    if (record.projectName !== prepared.scene.workName) {
      throw persistenceError('PROJECT_NAME_REQUIRED', 'projectName 必须与 scene.workName 完全一致。')
    }

    const validated = validateProjectRecord(record, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) {
      throw persistenceError('PROJECT_SAVE_FAILED', '作品记录未通过 Shared Contract 校验。')
    }

    const db = options.db ?? getFeltCraftDatabase()
    const store = new ProjectStore(db)
    const saved = await db.transaction('rw', db.projects, db.storyCards, async () => {
      const project = await store.save(validated.value)
      const card = await db.storyCards.get(existing.projectId)
      if (card) await db.storyCards.put({ ...card, artworkImageRef: project.previewUrl })
      return project
    })

    if (previousPreview && previousPreview !== newPreviewRef) {
      try {
        await deleteProjectPreviewRef(previousPreview)
      } catch {
        // Old preview cleanup failure must not undo the successful new Project commit.
      }
    }

    return saved
  } catch (error) {
    await cleanupPreviewRef(newPreviewRef)
    throw asPersistenceError(error, 'PROJECT_SAVE_FAILED')
  }
}

export type DeleteProjectOptions = {
  db?: FeltCraftDatabase
}

/**
 * Application-layer Project delete.
 * Order: load+validate → Dexie delete → best-effort preview cleanup.
 * Preview is never deleted before Dexie succeeds. Preview cleanup failure must
 * not restore an already-deleted ProjectRecord.
 */
export async function deleteExistingProject(
  projectId: string,
  options: DeleteProjectOptions = {}
): Promise<void> {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw persistenceError('INVALID_ARGUMENT', 'projectId 无效。')
  }

  const store = new ProjectStore(options.db ?? getFeltCraftDatabase())
  let existing: ProjectRecord
  try {
    const found = await store.get(projectId)
    if (!found) {
      throw persistenceError('INVALID_ARGUMENT', '作品不存在。')
    }
    existing = found
  } catch (error) {
    throw asPersistenceError(error, 'INVALID_ARGUMENT')
  }

  try {
    const db = options.db ?? getFeltCraftDatabase()
    await db.transaction('rw', db.projects, db.storyCards, async () => {
      await store.delete(projectId)
      await db.storyCards.delete(projectId)
    })
  } catch (error) {
    // Dexie failed — preview must remain.
    throw asPersistenceError(error, 'PROJECT_SAVE_FAILED')
  }

  try {
    await deleteProjectPreviewRef(existing.previewUrl)
  } catch {
    // Preview cleanup failure must not revive the deleted Project.
  }
}
