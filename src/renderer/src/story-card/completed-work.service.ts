import type { ProjectRecord } from '@shared/contracts'
import { persistenceError } from '../persistence/errors'

export interface StoryCardWorkReader {
  get(workId: string): Promise<ProjectRecord | undefined>
}

/**
 * Guards the story-card flow. A ProjectRecord is the phase-1 work source, and
 * its projectId is used as the story card workId.
 */
export async function requireCompletedWork(
  workId: string,
  reader: StoryCardWorkReader
): Promise<ProjectRecord> {
  if (!workId.trim()) {
    throw persistenceError('WORK_NOT_FOUND', '作品不存在。')
  }

  const work = await reader.get(workId)
  if (!work) {
    throw persistenceError('WORK_NOT_FOUND', '作品不存在。')
  }
  if (!hasSavedArtwork(work)) {
    throw persistenceError('WORK_NOT_COMPLETED', '请先完成作品，再创建故事卡。')
  }
  return work
}

/** ProjectStore validates the saved scene. Drafts live in a different table. */
export function hasSavedArtwork(work: ProjectRecord): boolean {
  return Boolean(work.previewUrl && (
    work.scene.corePattern?.visible ||
    work.scene.personalElements.some(object => object.visible) ||
    work.scene.objects.some(object => object.visible) ||
    work.scene.personalBackground || work.scene.backgroundAssetId
  ))
}
