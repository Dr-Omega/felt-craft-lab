import Dexie, { type Table } from 'dexie'
import type { AssetAccessState, DraftRecord, ProjectRecord, StoryCard } from '@shared/contracts'
import type { FavoriteRecord } from './favorites'

export const FELT_PERSISTENCE_DB_NAME = 'felt-craft-lab'
export const FELT_PERSISTENCE_DB_VERSION = 4

export type FeltCraftDatabase = Dexie & {
  drafts: Table<DraftRecord, string>
  projects: Table<ProjectRecord, string>
  storyCards: Table<StoryCard, string>
  assetAccess: Table<AssetAccessState, [string, string]>
  favorites: Table<FavoriteRecord, [string, string]>
}

export function createFeltCraftDatabase(name = FELT_PERSISTENCE_DB_NAME): FeltCraftDatabase {
  const db = new Dexie(name) as FeltCraftDatabase
  const versionOneSchema = {
    drafts: 'draftId, updatedAt',
    projects: 'projectId, updatedAt, projectName',
    assetAccess: '[userId+assetId], userId, assetId, updatedAt',
    favorites: '[userId+assetId], userId, assetId, createdAt'
  }
  const versionTwoSchema = {
    ...versionOneSchema,
    storyCards: 'workId, confirmedAt'
  }
  db.version(1).stores(versionOneSchema)
  db.version(2).stores(versionTwoSchema)
  db.version(3).stores(versionTwoSchema).upgrade((transaction) =>
    transaction.table('projects').toCollection().modify((project) => {
      if (project.completionStatus === undefined) project.completionStatus = 'draft'
    })
  )
  db.version(FELT_PERSISTENCE_DB_VERSION).stores(versionTwoSchema).upgrade((transaction) =>
    Promise.all([
      transaction.table('drafts').toCollection().modify((draft) => {
        if (draft.scene?.subject === undefined) draft.scene.subject = null
      }),
      transaction.table('projects').toCollection().modify((project) => {
        if (project.scene?.subject === undefined) project.scene.subject = null
      })
    ])
  )
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
