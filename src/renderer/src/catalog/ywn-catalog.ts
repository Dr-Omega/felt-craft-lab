import type { AssetRecord, SceneDocument } from '@shared/contracts'
import type { FabricEditorAssetResolver } from '../editor'
import registryJson from './snapshot-registry.json'
import { createUnlockedAccess, DEFAULT_USER_ID, isAssetUnlocked } from './asset-access-helpers'
import { loadFormalCatalog, type FormalCatalog } from './load-formal-catalog'
import {
  buildCombinedSnapshotContext,
  indexAssetsBySnapshot,
  loadSnapshotRegistry
} from './snapshot-registry'
import { DEFAULT_SCENE_CANVAS } from './scene-defaults'

export { createUnlockedAccess, DEFAULT_USER_ID, isAssetUnlocked }

const snapshotModules = import.meta.glob('./snapshots/*.manifest.json', { eager: true }) as Record<
  string,
  { default: unknown }
>

function loadAllSnapshotCatalogs(): Record<string, FormalCatalog> {
  const registry = loadSnapshotRegistry(registryJson)
  const catalogs: Record<string, FormalCatalog> = {}
  for (const snapshotId of Object.keys(registry.snapshots)) {
    const key = `./snapshots/${snapshotId}.manifest.json`
    const mod = snapshotModules[key]
    if (!mod) {
      throw new Error(`Bundled snapshot manifest missing for ${snapshotId} (${key}).`)
    }
    const catalog = loadFormalCatalog(mod.default)
    if (catalog.assetSnapshotId !== snapshotId) {
      throw new Error(
        `Snapshot manifest id mismatch: registry=${snapshotId} file=${catalog.assetSnapshotId}`
      )
    }
    catalogs[snapshotId] = catalog
  }
  return catalogs
}

const registry = loadSnapshotRegistry(registryJson)
const catalogsBySnapshotId = loadAllSnapshotCatalogs()
const assetsBySnapshotId = indexAssetsBySnapshot(catalogsBySnapshotId)
const latestCatalog = catalogsBySnapshotId[registry.latestSnapshotId]
if (!latestCatalog) {
  throw new Error(`Latest snapshot catalog missing: ${registry.latestSnapshotId}`)
}

/** Library / new Scene always use latest formal snapshot. */
export const YWN_SNAPSHOT_ID = registry.latestSnapshotId
export const YWN_ASSETS = latestCatalog.assets
/** Combined index of every still-supported historical snapshot for Editor recovery. */
export const YWN_SNAPSHOT_CONTEXT = buildCombinedSnapshotContext(catalogsBySnapshotId)

const latestById = new Map(YWN_ASSETS.map((asset) => [asset.assetId, asset]))

/** Formal YWN ready assets for Library — latest snapshot only. */
export const CATALOG_ASSETS: readonly AssetRecord[] = YWN_ASSETS

export function getCatalogAsset(assetId: string): AssetRecord | undefined {
  return latestById.get(assetId)
}

export function listCatalogByType(type: AssetRecord['type']): AssetRecord[] {
  return CATALOG_ASSETS.filter((asset) => asset.type === type)
}

export function listCatalogThemes(): string[] {
  return [...new Set(CATALOG_ASSETS.map((asset) => asset.themeId))]
}

/**
 * Read-only AssetRecord set for a specific snapshot.
 * Editor must use launch.scene.assetSnapshotId — never fall back to latest.
 */
export function getCatalogAssetsForSnapshot(snapshotId: string): readonly AssetRecord[] {
  const snapshotAssets = assetsBySnapshotId.get(snapshotId)
  if (!snapshotAssets) {
    throw new Error(`Asset snapshot not found: ${snapshotId}`)
  }
  return [...snapshotAssets.values()]
}

/**
 * Editor boot helper: missing historical snapshot → empty picker (no latest fallback).
 * Session/Fabric still open and enter ASSET_SNAPSHOT_MISMATCH / Recovery.
 */
export function resolveEditorCatalogForSnapshot(snapshotId: string): {
  assets: readonly AssetRecord[]
  snapshotMissing: boolean
} {
  try {
    return { assets: getCatalogAssetsForSnapshot(snapshotId), snapshotMissing: false }
  } catch {
    return { assets: [], snapshotMissing: true }
  }
}

/**
 * Resolves AssetRecord by (assetId, assetSnapshotId).
 * Missing historical snapshot must NOT fall back to latest — throw so Adapter Recovery runs.
 */
export function createCatalogResolver(): FabricEditorAssetResolver {
  return {
    async resolveAsset(assetId: string, assetSnapshotId: string): Promise<AssetRecord> {
      const snapshotAssets = assetsBySnapshotId.get(assetSnapshotId)
      if (!snapshotAssets) {
        throw new Error(`Asset snapshot not found: ${assetSnapshotId}`)
      }
      const asset = snapshotAssets.get(assetId)
      if (!asset) {
        throw new Error(`Catalog missing asset ${assetId} in snapshot ${assetSnapshotId}`)
      }
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
    canvas: { ...DEFAULT_SCENE_CANVAS, backgroundColor: '#FFF8E7' },
    backgroundAssetId: null,
    subject: null,
    objects: [],
    createdAt: now,
    updatedAt: now
  }
}
