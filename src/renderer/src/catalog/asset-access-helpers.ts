import type { AssetAccessState } from '@shared/contracts'

export const DEFAULT_USER_ID = 'user_demo_001'

/** Explicit test unlock helper — never seed automatically on product startup. */
export function createUnlockedAccess(assetId: string, now = new Date().toISOString()): AssetAccessState {
  return {
    userId: DEFAULT_USER_ID,
    assetId,
    unlocked: true,
    unlockSource: 'theme_complete',
    updatedAt: now
  }
}

export function isAssetUnlocked(access: AssetAccessState | undefined): boolean {
  return Boolean(access && access.unlocked === true)
}
