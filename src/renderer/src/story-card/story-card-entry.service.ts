import type { StoryCardWorkContext } from '@shared/contracts'
import {
  requireCompletedWork,
  type StoryCardWorkReader
} from './completed-work.service'
import {
  adaptStoryCardWorkContext,
  type StoryCardAssetReader
} from './work-context.adapter'

export interface StoryCardEntryDependencies {
  workReader: StoryCardWorkReader
  assetReader: StoryCardAssetReader
}

/**
 * Backend entry for the post-completion story-card flow. UI navigation is
 * intentionally deferred until the later test interface stage.
 */
export async function enterStoryCardAfterWorkCompleted(
  workId: string,
  dependencies: StoryCardEntryDependencies
): Promise<StoryCardWorkContext> {
  const work = await requireCompletedWork(workId, dependencies.workReader)
  return adaptStoryCardWorkContext(work, dependencies.assetReader)
}
