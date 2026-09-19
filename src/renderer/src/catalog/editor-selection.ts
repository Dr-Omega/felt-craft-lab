/**
 * Theme-scoped Editor selection helpers.
 * selected IDs must stay inside the current Scene theme collection.
 */
import type { AssetRecord } from '@shared/contracts'

export function assetsForTheme(
  assets: readonly AssetRecord[],
  type: AssetRecord['type'],
  themeId: string | undefined
): AssetRecord[] {
  const typed = assets.filter((asset) => asset.type === type)
  if (!themeId) return typed
  return typed.filter((asset) => asset.themeId === themeId)
}

export function normalizeSelectedAssetId(
  selectedId: string,
  options: readonly AssetRecord[]
): string {
  if (options.some((asset) => asset.assetId === selectedId)) return selectedId
  return options[0]?.assetId ?? ''
}

export function pickSelectedAsset(
  selectedId: string,
  options: readonly AssetRecord[]
): AssetRecord | undefined {
  return options.find((asset) => asset.assetId === selectedId)
}
