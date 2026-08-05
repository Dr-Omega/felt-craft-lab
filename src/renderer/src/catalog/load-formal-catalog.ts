import type { AssetRecord, SceneSnapshotValidationContext } from '@shared/contracts'
import {
  validateAssetRecord,
  validateSceneSnapshotValidationContext
} from '@shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource'

export type FormalCatalog = {
  assetSnapshotId: string
  assets: readonly AssetRecord[]
  snapshotContext: SceneSnapshotValidationContext
}

/**
 * Formal Catalog boundary: Manifest JSON → validateAssetRecord + snapshot context.
 * Do not trust raw JSON with type assertions.
 */
export function loadFormalCatalog(raw: unknown): FormalCatalog {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Formal Manifest root must be an object.')
  }
  const root = raw as Record<string, unknown>
  if (typeof root.assetSnapshotId !== 'string' || !root.assetSnapshotId.trim()) {
    throw new Error('Formal Manifest missing assetSnapshotId.')
  }
  if (!Array.isArray(root.assets)) {
    throw new Error('Formal Manifest assets must be an array.')
  }

  const contextResult = validateSceneSnapshotValidationContext(root.snapshotContext)
  if (!contextResult.ok) {
    throw new Error(`Formal Manifest snapshotContext invalid: ${JSON.stringify(contextResult.errors)}`)
  }

  const assets: AssetRecord[] = []
  const seen = new Set<string>()
  for (const [index, candidate] of root.assets.entries()) {
    const validated = validateAssetRecord(candidate, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) {
      throw new Error(
        `Formal Manifest assets[${index}] failed validateAssetRecord: ${JSON.stringify(validated.errors)}`
      )
    }
    if (seen.has(validated.value.assetId)) {
      throw new Error(`Formal Manifest duplicate assetId: ${validated.value.assetId}`)
    }
    seen.add(validated.value.assetId)
    if (validated.value.status !== 'ready') {
      throw new Error(
        `Formal Manifest assets[${index}] status must be ready (got ${validated.value.status}); test_only is rejected.`
      )
    }
    if ('owner' in (candidate as object) || 'unlockStatus' in (candidate as object)) {
      throw new Error(`Formal Manifest assets[${index}] must not include owner/unlockStatus.`)
    }
    assets.push(validated.value)
  }

  const snap = contextResult.value.snapshots[root.assetSnapshotId]
  if (!snap) {
    throw new Error(`Formal Manifest snapshotContext missing index for ${root.assetSnapshotId}`)
  }
  if (snap.length !== assets.length) {
    throw new Error(
      `Formal Manifest snapshotContext size ${snap.length} != assets size ${assets.length}`
    )
  }
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]))
  for (const entry of snap) {
    const asset = byId.get(entry.assetId)
    if (!asset || asset.type !== entry.type) {
      throw new Error(`Formal Manifest snapshotContext mismatch for ${entry.assetId}/${entry.type}`)
    }
  }

  return Object.freeze({
    assetSnapshotId: root.assetSnapshotId,
    assets: Object.freeze(assets),
    snapshotContext: contextResult.value
  })
}
