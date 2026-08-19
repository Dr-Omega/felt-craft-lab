import type { CreationIntentAccepted } from '@shared/creation-intent'
import { DEFAULT_USER_ID } from '../catalog/asset-access-helpers'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { PersonalAssetStore, PersonalAssetVersionStore } from './stores'

export type PersistAcceptedGenerationOptions = {
  db?: FeltCraftDatabase
  userId?: string
  now?: string
}

/**
 * Persist the work's core-pattern file records so the editor can load the PNG.
 * This is not a catalog / 素材库 item.
 * Version must be saved first: asset.save asserts the current version exists.
 */
export async function persistAcceptedGeneration(
  accepted: CreationIntentAccepted,
  options: PersistAcceptedGenerationOptions = {}
): Promise<void> {
  const now = options.now ?? new Date().toISOString()
  const db = options.db ?? getFeltCraftDatabase()
  await new PersonalAssetVersionStore(db).save({
    versionId: accepted.versionId,
    personalAssetId: accepted.personalAssetId,
    versionNumber: 1,
    sourceImageRef: accepted.sourceImageRef,
    parentVersionId: null,
    createdAt: now
  })
  await new PersonalAssetStore(db).save({
    personalAssetId: accepted.personalAssetId,
    userId: options.userId ?? DEFAULT_USER_ID,
    role: accepted.role,
    sourceType: 'ai_generated',
    name: accepted.name,
    currentVersionId: accepted.versionId,
    createdAt: now,
    updatedAt: now
  })
}
