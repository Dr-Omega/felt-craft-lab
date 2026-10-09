import type { StoryCardWorkContext } from '@shared/contracts'

/**
 * The direct acceptance launcher must begin at the first story-card page on
 * every app start, even if an earlier acceptance run saved a card locally.
 */
export function createFreshAcceptanceWorkContext(context: StoryCardWorkContext, runId: string = crypto.randomUUID()): StoryCardWorkContext {
  return { ...context, workId: `story-card-acceptance-${runId}` }
}
