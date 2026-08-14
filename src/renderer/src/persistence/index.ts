export {
  createFeltCraftDatabase,
  FELT_PERSISTENCE_DB_NAME,
  FELT_PERSISTENCE_DB_VERSION,
  getFeltCraftDatabase,
  setFeltCraftDatabaseForTests,
  type FeltCraftDatabase
} from './db'
export { saveDraftFromPreparedScene } from './draft-workflow'
export { DRAFT_AUTOSAVE_DEBOUNCE_MS, DraftAutosaveController, type DraftAutosaveOptions, type DraftAutosaveSave, type DraftAutosaveSession } from './draft-autosave'
export { PersistenceError, asPersistenceError, persistenceError } from './errors'
export { isFavoriteRecord, type FavoriteRecord } from './favorites'
export {
  cleanupPreviewRef,
  deleteProjectPreviewRef,
  saveProjectPreviewBytes
} from './preview-bridge'
export { deleteExistingProject, saveNewProject, updateExistingProject } from './project-workflow'
export { AssetAccessStore, DraftStore, FavoriteStore, ProjectStore } from './stores'
export { DEFAULT_WORK_NAME, normalizeWorkName, WORK_NAME_MAX_LENGTH } from './work-name'
