import Dexie, { type Table } from 'dexie'
import type { AssetAccessState, DraftRecord, ProjectRecord } from '@shared/contracts'
import type { FavoriteRecord } from './favorites'

export const FELT_PERSISTENCE_DB_NAME = 'felt-craft-lab'
export const FELT_PERSISTENCE_DB_VERSION = 1

export type FeltCraftDatabase = Dexie & {
  drafts: Table<DraftRecord, string>
  projects: Table<ProjectRecord, string>
  assetAccess: Table<AssetAccessState, [string, string]>
  favorites: Table<FavoriteRecord, [string, string]>
}

export function createFeltCraftDatabase(name = FELT_PERSISTENCE_DB_NAME): FeltCraftDatabase {
  const db = new Dexie(name) as FeltCraftDatabase
  db.version(FELT_PERSISTENCE_DB_VERSION).stores({
    drafts: 'draftId, updatedAt',
    projects: 'projectId, updatedAt, projectName',
    assetAccess: '[userId+assetId], userId, assetId, updatedAt',
    favorites: '[userId+assetId], userId, assetId, createdAt'
  })
  return db
}

let sharedDb: FeltCraftDatabase | undefined

/** Default singleton used by renderer workflow helpers. */
export function getFeltCraftDatabase(): FeltCraftDatabase {
  if (!sharedDb) {
    sharedDb = createFeltCraftDatabase()
  }
  return sharedDb
}

/** Test helper — replace or clear the singleton. */
export function setFeltCraftDatabaseForTests(db: FeltCraftDatabase | undefined): void {
  sharedDb = db
}
