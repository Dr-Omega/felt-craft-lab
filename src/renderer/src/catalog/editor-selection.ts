/** Editor selection helpers for the Scene's immutable asset snapshot. */
import type { AssetRecord } from '@shared/contracts'
import { ALL_THEMES_ID } from './ywn-catalog'

export function assetsForEditor(
  assets: readonly AssetRecord[],
  type: AssetRecord['type'],
  sceneThemeId: string | undefined
): AssetRecord[] {
  const typed = assets.filter((asset) => asset.type === type)
  // "all" and any other falsy / missing theme id means "no preference",
  // so the Editor returns every typed asset in the Scene's snapshot
  // without any artificial reordering.
  if (!sceneThemeId || sceneThemeId === ALL_THEMES_ID) return typed
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
