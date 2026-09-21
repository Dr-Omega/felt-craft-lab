import type { ResourceRef, UtcIso8601 } from './common'
import type { SceneDocument } from './scene'

export interface DraftRecord {
  draftId: string
  scene: SceneDocument
  updatedAt: UtcIso8601
  status: 'draft'
}

export const PROJECT_SYNC_STATUSES = [
  'local_only',
  'pending_sync',
  'synced',
  'sync_failed'
] as const
export type ProjectSyncStatus = (typeof PROJECT_SYNC_STATUSES)[number]

export const PROJECT_COMPLETION_STATUSES = ['draft', 'completed'] as const
export type ProjectCompletionStatus = (typeof PROJECT_COMPLETION_STATUSES)[number]

export interface ProjectRecord {
  projectId: string
  /** Index projection; must exactly match scene.workName. */
  projectName: string
  scene: SceneDocument
  /** Required stable preview resource after a formal save. */
  previewUrl: ResourceRef
  /** A story card can only be created after the work is formally completed. */
  completionStatus: ProjectCompletionStatus
  syncStatus: ProjectSyncStatus
  createdAt: UtcIso8601
  updatedAt: UtcIso8601
}

