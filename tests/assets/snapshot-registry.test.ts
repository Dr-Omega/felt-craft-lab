import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCatalogResolver, CATALOG_ASSETS, YWN_SNAPSHOT_CONTEXT, YWN_SNAPSHOT_ID } from '../../src/renderer/src/catalog/ywn-catalog'
import {
  buildCombinedSnapshotContext,
  loadSnapshotRegistry
} from '../../src/renderer/src/catalog/snapshot-registry'
import { loadFormalCatalog } from '../../src/renderer/src/catalog/load-formal-catalog'
import { contentProjection, resolveContentVersion } from '../../src/renderer/src/catalog/content-version'

const registryPath = resolve('assets/generated/snapshot-registry.json')
const snapA = 'snapshot_ywn_20260805_112922'

describe('historical snapshot registry + resolver', () => {
  it('loads registry and exposes latest-only Library catalog', () => {
    const registry = loadSnapshotRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
    expect(registry.latestSnapshotId).toBe('snapshot_ywn_material_v2_1cdf77d')
    expect(YWN_SNAPSHOT_ID).toBe(registry.latestSnapshotId)
    expect(CATALOG_ASSETS).toHaveLength(71)
    expect(YWN_SNAPSHOT_CONTEXT.snapshots[snapA]).toHaveLength(17)
  })

  it('builds combined snapshotContext covering every registered snapshot', () => {
    const registry = loadSnapshotRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
    const catalogs: Record<string, ReturnType<typeof loadFormalCatalog>> = {}
    for (const snapshotId of Object.keys(registry.snapshots)) {
      const raw = JSON.parse(
        readFileSync(resolve(`assets/generated/snapshots/${snapshotId}/assets.manifest.json`), 'utf8')
      )
      catalogs[snapshotId] = loadFormalCatalog(raw)
    }
    const combined = buildCombinedSnapshotContext(catalogs)
    expect(Object.keys(combined.snapshots).sort()).toEqual(Object.keys(registry.snapshots).sort())
    expect(combined.snapshots[snapA]?.[0]?.assetId).toBeTruthy()
  })

  it('resolveAsset uses exact snapshot and never falls back to latest', async () => {
    const resolver = createCatalogResolver()
    const latest = await resolver.resolveAsset('sticker_fu_001', snapA)
    expect(latest.assetId).toBe('sticker_fu_001')
    expect(latest.imageUrl).toContain(`material/${snapA}/`)
    const oldMoon = await resolver.resolveAsset('sticker_crescent_moon_001', snapA)
    expect(oldMoon.imageUrl).toContain(`material/${snapA}/`)
    const newMoon = await resolver.resolveAsset('sticker_moon_001', YWN_SNAPSHOT_ID)
    expect(newMoon.imageUrl).toContain(`material/${YWN_SNAPSHOT_ID}/`)
    await expect(resolver.resolveAsset('sticker_crescent_moon_001', YWN_SNAPSHOT_ID)).rejects.toThrow('Catalog missing asset')

    await expect(resolver.resolveAsset('sticker_fu_001', 'snapshot_missing_zzz')).rejects.toThrow(
      /Asset snapshot not found/
    )
  })

  it('contentVersion ignores snapshot namespace in ResourceRefs', () => {
    const base = {
      type: 'sticker',
      themeId: 'spring_festival',
      categoryIds: ['festival_decoration'],
      nameZh: '福字',
      nameEn: 'Fu',
      introZh: 'intro',
      keywords: ['春节'],
      imageUrl: 'felt-resource://material/snapshot_a/sticker_fu_001.png',
      thumbnailUrl: 'felt-resource://material/snapshot_a/sticker_fu_001_thumb.png',
      audio: {
        nameZhUrl: 'felt-resource://audio/snapshot_a/sticker_fu_001_name_zh.mp3'
      },
      source: 'Midjourney',
      license: 'MJ'
    }
    const hashes = {
      image: { logicalName: 'sticker_fu_001.png', sha256: 'abc' },
      thumbnail: { logicalName: 'sticker_fu_001_thumb.png', sha256: 'def' },
      nameZhAudio: { logicalName: 'sticker_fu_001_name_zh.mp3', sha256: 'ghi' }
    }
    const p1 = contentProjection(base, hashes)
    const p2 = contentProjection(
      {
        ...base,
        imageUrl: 'felt-resource://material/snapshot_b/sticker_fu_001.png',
        thumbnailUrl: 'felt-resource://material/snapshot_b/sticker_fu_001_thumb.png',
        audio: {
          nameZhUrl: 'felt-resource://audio/snapshot_b/sticker_fu_001_name_zh.mp3'
        }
      },
      hashes
    )
    expect(p1).toEqual(p2)
    expect(
      resolveContentVersion('sticker_fu_001', p2, {
        sticker_fu_001: { contentVersion: 4, projection: p1 }
      })
    ).toBe(4)

    const changedBytes = contentProjection(base, {
      ...hashes,
      image: { logicalName: 'sticker_fu_001.png', sha256: 'CHANGED' }
    })
    expect(
      resolveContentVersion('sticker_fu_001', changedBytes, {
        sticker_fu_001: { contentVersion: 4, projection: p1 }
      })
    ).toBe(5)
  })
})
