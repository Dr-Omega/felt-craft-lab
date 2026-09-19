/** Editor selection helpers for the Scene's immutable asset snapshot. */
import type { AssetRecord } from '@shared/contracts'

export function assetsForEditor(
  assets: readonly AssetRecord[],
  type: AssetRecord['type'],
  sceneThemeId: string | undefined
): AssetRecord[] {
  const typed = assets.filter((asset) => asset.type === type)
  if (!sceneThemeId) return typed
  return [
    ...typed.filter((asset) => asset.themeId === sceneThemeId),
    ...typed.filter((asset) => asset.themeId !== sceneThemeId)
  ]
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
