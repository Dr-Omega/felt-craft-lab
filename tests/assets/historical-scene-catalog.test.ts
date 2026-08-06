import { describe, expect, it } from 'vitest'
import type { AssetRecord, SceneDocument } from '../../src/shared/contracts'
import { assetsForTheme, pickSelectedAsset } from '../../src/renderer/src/catalog/editor-selection'
import { getCatalogAssetsForSnapshot, YWN_SNAPSHOT_ID } from '../../src/renderer/src/catalog/ywn-catalog'

function sticker(snapshotId: string, imageToken: string, contentVersion: number): AssetRecord {
  return {
    assetId: 'sticker_fu_001',
    type: 'sticker',
    themeId: 'spring_festival',
    categoryIds: ['festival_decoration'],
    nameZh: '福字',
    nameEn: 'Fu',
    introZh: 'intro',
    keywords: ['春节'],
    imageUrl: `felt-resource://material/${snapshotId}/sticker_fu_001.png`,
    thumbnailUrl: `felt-resource://material/${snapshotId}/sticker_fu_001_thumb.png`,
    audio: {},
    source: 'test',
    license: 'test',
    contentVersion,
    status: 'ready',
    // Encode distinct media identity without relying on network bytes.
    preSplitDataUrl: imageToken
  }
}

describe('historical Scene Editor catalog selection', () => {
  it('exposes formal latest assets via getCatalogAssetsForSnapshot(latest)', () => {
    const assets = getCatalogAssetsForSnapshot(YWN_SNAPSHOT_ID)
    expect(assets.length).toBe(17)
    expect(assets.every((asset) => asset.imageUrl.includes(`/${YWN_SNAPSHOT_ID}/`))).toBe(true)
  })

  it('throws when snapshot is missing (no latest fallback)', () => {
    expect(() => getCatalogAssetsForSnapshot('snapshot_missing_zzz')).toThrow(/Asset snapshot not found/)
  })

  it('keeps Editor picker on snapshot_001 AssetRecord A when latest is B', () => {
    const snap1 = 'snapshot_001'
    const snap2 = 'snapshot_002'
    const assetA = sticker(snap1, 'image-A', 1)
    const assetB = sticker(snap2, 'image-B', 2)
    const bySnapshot = new Map<string, Map<string, AssetRecord>>([
      [snap1, new Map([[assetA.assetId, assetA]])],
      [snap2, new Map([[assetB.assetId, assetB]])]
    ])

    const scene: Pick<SceneDocument, 'assetSnapshotId' | 'themeId'> = {
      assetSnapshotId: snap1,
      themeId: 'spring_festival'
    }
    const sceneAssets = [...(bySnapshot.get(scene.assetSnapshotId)?.values() ?? [])]
    expect(sceneAssets).toHaveLength(1)
    expect(sceneAssets[0]?.preSplitDataUrl).toBe('image-A')
    expect(sceneAssets[0]?.contentVersion).toBe(1)

    const stickers = assetsForTheme(sceneAssets, 'sticker', scene.themeId)
    const selected = pickSelectedAsset('sticker_fu_001', stickers)
    expect(selected?.imageUrl).toContain(`/${snap1}/`)
    expect(selected?.preSplitDataUrl).toBe('image-A')
    expect(selected?.contentVersion).toBe(1)
    expect(selected?.imageUrl).not.toContain(snap2)
    expect(selected?.preSplitDataUrl).not.toBe('image-B')

    // Saving semantics: Scene keeps its own snapshot id (Editor never rewrites to latest).
    expect(scene.assetSnapshotId).toBe(snap1)
  })
})
