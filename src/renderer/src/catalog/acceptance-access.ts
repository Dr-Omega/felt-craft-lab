import type { AssetAccessState, AssetRecord } from '@shared/contracts'
import type { AssetAccessStore } from '../persistence'
import { createUnlockedAccess, DEFAULT_USER_ID, isAssetUnlocked } from './asset-access-helpers'

/** Explicit opt-in flag used only by acceptance/test environments. */
export const ACCEPTANCE_UNLOCK_ALL_ASSETS_ENV = 'VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS' as const

export function isAcceptanceUnlockAllAssetsEnabled(value: unknown): boolean {
  return value === 'true'
}

/** The formal asset types that the Editor can add or apply. */
export function editorAssetsForAcceptanceAccess(assets: readonly AssetRecord[]): AssetRecord[] {
  return assets.filter((asset) => asset.type === 'background' || asset.type === 'sticker')
}

/**
 * Seeds explicit access rows for acceptance only. The normal UI and adapter
 * access checks remain unchanged; callers still pass the saved rows through
 * refreshAccess() before rendering the picker.
 */
export async function seedAcceptanceUnlockedAccess(
  store: Pick<AssetAccessStore, 'save' | 'listForUser'>,
  assets: readonly AssetRecord[],
  enabled: boolean
): Promise<AssetAccessState[]> {
  if (!enabled) return []

  const existing = await store.listForUser(DEFAULT_USER_ID)
  const alreadyUnlocked = new Set(
    existing.filter((row) => isAssetUnlocked(row)).map((row) => row.assetId)
  )

  const seeded: AssetAccessState[] = []
  for (const asset of editorAssetsForAcceptanceAccess(assets)) {
    if (alreadyUnlocked.has(asset.assetId)) continue
    const access = createUnlockedAccess(asset.assetId)
    await store.save(access)
    seeded.push(access)
    alreadyUnlocked.add(asset.assetId)
  }
  return seeded
}

export { createUnlockedAccess, DEFAULT_USER_ID, isAssetUnlocked }
