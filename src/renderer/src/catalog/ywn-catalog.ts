import type { AssetRecord, SceneDocument } from '@shared/contracts'
import type { FabricEditorAssetResolver } from '../editor'
import manifestJson from './assets.manifest.json'
import { createUnlockedAccess, DEFAULT_USER_ID, isAssetUnlocked } from './asset-access-helpers'
import { loadFormalCatalog } from './load-formal-catalog'

export { createUnlockedAccess, DEFAULT_USER_ID, isAssetUnlocked }

const formal = loadFormalCatalog(manifestJson)

export const YWN_SNAPSHOT_ID = formal.assetSnapshotId
export const YWN_ASSETS = formal.assets
export const YWN_SNAPSHOT_CONTEXT = formal.snapshotContext

const assetById = new Map(YWN_ASSETS.map((asset) => [asset.assetId, asset]))

/** Formal YWN ready assets only — validated at catalog load boundary. */
export const CATALOG_ASSETS: readonly AssetRecord[] = YWN_ASSETS

export function getCatalogAsset(assetId: string): AssetRecord | undefined {
  return assetById.get(assetId)
}

export function listCatalogByType(type: AssetRecord['type']): AssetRecord[] {
  return CATALOG_ASSETS.filter((asset) => asset.type === type)
}

export function listCatalogThemes(): string[] {
  return [...new Set(CATALOG_ASSETS.map((asset) => asset.themeId))]
}

export function createCatalogResolver(): FabricEditorAssetResolver {
  return {
    async resolveAsset(assetId: string): Promise<AssetRecord> {
      const asset = assetById.get(assetId)
      if (!asset) throw new Error(`Catalog missing asset: ${assetId}`)
      return asset
    }
  }
}

export function createBlankScene(workName: string, themeId?: string): SceneDocument {
  const now = new Date().toISOString()
  const theme = themeId ?? CATALOG_ASSETS[0]?.themeId ?? 'spring_festival'
  const name = workName.trim() || '我的新作品'
  return {
    schemaVersion: 1,
    sceneId: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    workName: name,
    themeId: theme,
    assetSnapshotId: YWN_SNAPSHOT_ID,
    canvas: { width: 960, height: 640, backgroundColor: '#FFF8E7' },
    backgroundAssetId: null,
    objects: [],
    createdAt: now,
    updatedAt: now
  }
}
