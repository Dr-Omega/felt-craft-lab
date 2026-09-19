import type { AssetRecord, SceneSnapshotValidationContext } from '@shared/contracts'
import { loadFormalCatalog, type FormalCatalog } from './load-formal-catalog'

export type SnapshotRegistryEntry = {
  manifest: string
  generatedAt?: string
}

export type SnapshotRegistry = {
  latestSnapshotId: string
  snapshots: Record<string, SnapshotRegistryEntry>
}

export function loadSnapshotRegistry(raw: unknown): SnapshotRegistry {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Snapshot registry root must be an object.')
  }
  const root = raw as Record<string, unknown>
  if (typeof root.latestSnapshotId !== 'string' || !root.latestSnapshotId.trim()) {
    throw new Error('Snapshot registry missing latestSnapshotId.')
  }
  if (!root.snapshots || typeof root.snapshots !== 'object') {
    throw new Error('Snapshot registry missing snapshots map.')
  }
  const snapshots: Record<string, SnapshotRegistryEntry> = {}
  for (const [snapshotId, entry] of Object.entries(root.snapshots as Record<string, unknown>)) {
    if (!snapshotId.trim()) throw new Error('Snapshot registry contains empty snapshotId.')
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Snapshot registry entry invalid for ${snapshotId}`)
    }
    const row = entry as Record<string, unknown>
    if (typeof row.manifest !== 'string' || !row.manifest.trim()) {
      throw new Error(`Snapshot registry entry missing manifest for ${snapshotId}`)
    }
    snapshots[snapshotId] = {
      manifest: row.manifest,
      generatedAt: typeof row.generatedAt === 'string' ? row.generatedAt : undefined
    }
  }
  if (!snapshots[root.latestSnapshotId]) {
    throw new Error(`Snapshot registry latestSnapshotId ${root.latestSnapshotId} not in snapshots map.`)
  }
  return {
    latestSnapshotId: root.latestSnapshotId,
    snapshots
  }
}

export function buildCombinedSnapshotContext(
  catalogsBySnapshotId: Record<string, FormalCatalog>
): SceneSnapshotValidationContext {
  const snapshots: Record<string, Array<{ assetId: string; type: 'background' | 'sticker' }>> = {}
  for (const [snapshotId, catalog] of Object.entries(catalogsBySnapshotId)) {
    const index = catalog.snapshotContext.snapshots[snapshotId]
    if (!index) {
      throw new Error(`Catalog for ${snapshotId} missing its own snapshot index.`)
    }
    snapshots[snapshotId] = index.map((entry) => ({
      assetId: entry.assetId,
      type: entry.type
    }))
  }
  return { snapshots }
}

export function indexAssetsBySnapshot(
  catalogsBySnapshotId: Record<string, FormalCatalog>
): Map<string, Map<string, AssetRecord>> {
  const out = new Map<string, Map<string, AssetRecord>>()
  for (const [snapshotId, catalog] of Object.entries(catalogsBySnapshotId)) {
    out.set(snapshotId, new Map(catalog.assets.map((asset) => [asset.assetId, asset])))
  }
  return out
}
