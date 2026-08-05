import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  validateAssetRecord,
  validateSceneSnapshotValidationContext
} from '../../src/shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY, parseFeltResourceRef } from '../../src/shared/resource'
import { resolveFeltResourcePath } from '../../src/shared/resource/resolve-path'
import {
  contentProjection,
  resolveContentVersion,
  type PriorContentVersion
} from '../../src/renderer/src/catalog/content-version'

const manifestPath = resolve('assets/generated/assets.manifest.json')
const materialRoot = resolve('assets/generated/material')
const audioRoot = resolve('assets/generated/audio')

type ManifestAsset = Record<string, any>

function collectRefs(asset: ManifestAsset): Array<{ field: string; ref: string }> {
  const refs: Array<{ field: string; ref: string }> = []
  for (const field of ['imageUrl', 'thumbnailUrl', 'preSplitDataUrl'] as const) {
    const value = asset[field]
    if (typeof value === 'string' && value.trim()) refs.push({ field, ref: value })
  }
  const audio = asset.audio && typeof asset.audio === 'object' ? asset.audio : {}
  for (const field of ['nameZhUrl', 'nameEnUrl', 'introZhUrl'] as const) {
    const value = audio[field]
    if (typeof value === 'string' && value.trim()) refs.push({ field: `audio.${field}`, ref: value })
  }
  return refs
}

describe('YWN formal manifest', () => {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    assetSnapshotId: string
    assets: ManifestAsset[]
    snapshotContext: { snapshots: Record<string, Array<{ assetId: string; type: string }>> }
  }

  const roots = {
    materialRoot,
    audioRoot,
    audioDynamicRoot: resolve('assets/generated/audio-dynamic'),
    previewRoot: resolve('assets/generated/previews')
  }

  it('imports exactly 17 ready assets and validates every AssetRecord', () => {
    expect(raw.assets).toHaveLength(17)
    expect(raw.assetSnapshotId.startsWith('snapshot_ywn_')).toBe(true)
    expect(raw.assetSnapshotId).not.toBe('snapshot_ywn_20260805_001')

    const ids = new Set<string>()
    for (const asset of raw.assets) {
      const result = validateAssetRecord(asset, FELT_RESOURCE_REF_POLICY)
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) continue
      expect(result.value.status).toBe('ready')
      expect(result.value).not.toHaveProperty('owner')
      expect(asset).not.toHaveProperty('unlockStatus')
      expect(result.value.source).not.toBe('YWN')
      expect(ids.has(result.value.assetId)).toBe(false)
      ids.add(result.value.assetId)
    }
    expect(ids.size).toBe(17)
  })

  it('validates snapshotContext against assets', () => {
    const context = validateSceneSnapshotValidationContext(raw.snapshotContext)
    expect(context.ok, JSON.stringify(context)).toBe(true)
    const snap = raw.snapshotContext.snapshots[raw.assetSnapshotId]
    expect(snap).toHaveLength(raw.assets.length)
    const byId = new Map(raw.assets.map((asset) => [asset.assetId, asset]))
    for (const entry of snap) {
      const asset = byId.get(entry.assetId)
      expect(asset).toBeTruthy()
      expect(asset!.type).toBe(entry.type)
    }
  })

  it('resolves every non-empty ResourceRef for all 17 assets to existing files', () => {
    let checked = 0
    for (const asset of raw.assets) {
      for (const { field, ref } of collectRefs(asset)) {
        const parsed = parseFeltResourceRef(ref)
        expect(parsed, `${asset.assetId}.${field}=${ref}`).toBeTruthy()
        const resolved = resolveFeltResourcePath(ref, roots)
        expect(resolved.ok, `${asset.assetId}.${field}=${ref}`).toBe(true)
        if (resolved.ok) {
          expect(resolved.exists).toBe(true)
          expect(existsSync(resolved.absolutePath)).toBe(true)
          expect(resolved.relativePath.includes('..')).toBe(false)
          expect(resolved.ref.startsWith('felt-resource://')).toBe(true)
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(17 * 4)
  })
})

describe('contentVersion continuation', () => {
  it('starts at 1 for a new assetId', () => {
    const projection = contentProjection({
      type: 'sticker',
      themeId: 'spring_festival',
      categoryIds: ['symbol'],
      nameZh: '福',
      nameEn: 'Fu',
      introZh: 'intro',
      keywords: ['福'],
      imageUrl: 'felt-resource://material/a.png',
      audio: {}
    })
    expect(resolveContentVersion('sticker_new_001', projection, {})).toBe(1)
  })

  it('keeps the old version when projection is unchanged', () => {
    const record = {
      type: 'sticker',
      themeId: 'spring_festival',
      categoryIds: ['symbol'],
      nameZh: '福',
      nameEn: 'Fu',
      introZh: 'intro',
      keywords: ['福'],
      imageUrl: 'felt-resource://material/a.png',
      thumbnailUrl: 'felt-resource://material/a_thumb.png',
      audio: {
        nameZhUrl: 'felt-resource://audio/a_zh.mp3'
      },
      source: 'Midjourney',
      license: 'MJ'
    }
    const projection = contentProjection(record)
    const prior: Record<string, PriorContentVersion> = {
      sticker_fu_001: { contentVersion: 3, projection }
    }
    expect(resolveContentVersion('sticker_fu_001', projection, prior)).toBe(3)
  })

  it('bumps version when a compared field changes', () => {
    const base = {
      type: 'sticker',
      themeId: 'spring_festival',
      categoryIds: ['symbol'],
      nameZh: '福',
      nameEn: 'Fu',
      introZh: 'intro',
      keywords: ['福'],
      imageUrl: 'felt-resource://material/a.png',
      audio: {},
      source: 'Midjourney',
      license: 'MJ'
    }
    const prior: Record<string, PriorContentVersion> = {
      sticker_fu_001: { contentVersion: 2, projection: contentProjection(base) }
    }
    const changed = contentProjection({ ...base, introZh: '新介绍' })
    expect(resolveContentVersion('sticker_fu_001', changed, prior)).toBe(3)
  })
})
