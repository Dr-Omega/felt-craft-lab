import type { AssetAccessState } from '@shared/contracts'

export const DEFAULT_USER_ID = 'user_demo_001'

/** Explicit in-memory allowance. Guided tasks pass the authenticated owner; never persist as a completion. */
export function createUnlockedAccess(assetId: string, now = new Date().toISOString(), userId = DEFAULT_USER_ID): AssetAccessState {
  return {
    userId,
    assetId,
    unlocked: true,
    unlockSource: 'theme_complete',
    updatedAt: now
  }
}

export function isAssetUnlocked(access: AssetAccessState | undefined): boolean {
  return Boolean(access && access.unlocked === true)
}
