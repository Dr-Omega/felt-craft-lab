import Dexie, { type Table } from 'dexie'
import type {
  AssetAccessState,
  DraftRecord,
  PersonalAssetRecord,
  PersonalAssetVersionRecord,
  ProjectRecord
} from '@shared/contracts'
import type { FavoriteRecord } from './favorites'

export const FELT_PERSISTENCE_DB_NAME = 'felt-craft-lab'
export const FELT_PERSISTENCE_DB_VERSION = 2

export type FeltCraftDatabase = Dexie & {
  drafts: Table<DraftRecord, string>
  projects: Table<ProjectRecord, string>
  assetAccess: Table<AssetAccessState, [string, string]>
  favorites: Table<FavoriteRecord, [string, string]>
  personalAssets: Table<PersonalAssetRecord, string>
  personalAssetVersions: Table<PersonalAssetVersionRecord, string>
}

export function createFeltCraftDatabase(name = FELT_PERSISTENCE_DB_NAME): FeltCraftDatabase {
  const db = new Dexie(name) as FeltCraftDatabase
  db.version(1).stores({
    drafts: 'draftId, updatedAt',
    projects: 'projectId, updatedAt, projectName',
    assetAccess: '[userId+assetId], userId, assetId, updatedAt',
    favorites: '[userId+assetId], userId, assetId, createdAt'
  })
  db.version(FELT_PERSISTENCE_DB_VERSION).stores({
    drafts: 'draftId, updatedAt',
    projects: 'projectId, updatedAt, projectName',
    assetAccess: '[userId+assetId], userId, assetId, updatedAt',
    favorites: '[userId+assetId], userId, assetId, createdAt',
    personalAssets: 'personalAssetId, userId, role, updatedAt',
    personalAssetVersions: 'versionId, personalAssetId, versionNumber, createdAt'
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
