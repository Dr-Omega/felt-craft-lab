import type { DraftRecord, SceneDocument } from '@shared/contracts'
import { validateDraftRecord } from '@shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { asPersistenceError, persistenceError } from './errors'
import { DraftStore } from './stores'

export type SaveDraftOptions = {
  /** Existing draft id when updating; otherwise a new UUID is minted. */
  draftId?: string
  db?: FeltCraftDatabase
}

/**
 * Draft save workflow.
 * Input MUST come from EditorSession.prepareDraftSave() (a validated SceneDocument).
 * Persistence never re-reads Fabric JSON and does not re-implement Recovery/Pending.
 */
export async function saveDraftFromPreparedScene(
  scene: SceneDocument,
  options: SaveDraftOptions = {}
): Promise<DraftRecord> {
  const draftId = options.draftId ?? crypto.randomUUID()
  const record: DraftRecord = {
    draftId,
    scene,
    updatedAt: scene.updatedAt,
    status: 'draft'
  }

  const validated = validateDraftRecord(record, FELT_RESOURCE_REF_POLICY)
  if (!validated.ok) {
    throw persistenceError('DRAFT_SAVE_FAILED', '草稿记录未通过 Shared Contract 校验。')
  }

  try {
    const store = new DraftStore(options.db ?? getFeltCraftDatabase())
    return await store.save(validated.value)
  } catch (error) {
    throw asPersistenceError(error, 'DRAFT_SAVE_FAILED')
  }
}
