import type { ProjectRecord } from '@shared/contracts'
import { validateProjectRecord } from '@shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource'
import type { PreparedProjectSave } from '../editor/editor-session.types'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { asPersistenceError, persistenceError } from './errors'
import { cleanupPreviewRef, deleteProjectPreviewRef, saveProjectPreviewBytes } from './preview-bridge'
import { ProjectStore } from './stores'

export type SaveNewProjectOptions = {
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

    const store = new ProjectStore(options.db ?? getFeltCraftDatabase())
    return await store.save(validated.value)
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

    const store = new ProjectStore(options.db ?? getFeltCraftDatabase())
    const saved = await store.save(validated.value)

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
