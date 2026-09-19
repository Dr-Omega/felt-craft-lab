import { describe, expect, it, vi } from 'vitest'
import type { SceneDocument } from '@shared/contracts'
import { buildProjectionLayers } from '../../src/renderer/src/projection/projection-layers'

vi.mock('../../src/renderer/src/catalog/ywn-catalog', () => ({
  createCatalogResolver: () => ({
    async resolveAsset(assetId: string) {
      if (assetId === 'bg-1') {
        return {
          assetId: 'bg-1',
          type: 'background',
          themeId: 'spring_festival',
          categoryIds: [],
          nameZh: '背景',
          nameEn: 'Background',
          introZh: '',
          keywords: [],
          imageUrl: 'felt-resource://material/mock-background.png',
          contentVersion: 1,
          status: 'ready'
        }
      }
      return {
        assetId,
        type: 'sticker',
        themeId: 'spring_festival',
        categoryIds: [],
        nameZh: `贴纸${assetId}`,
        nameEn: assetId,
        introZh: '',
        keywords: [],
        imageUrl: 'felt-resource://material/mock-sticker.png',
        contentVersion: 1,
        status: 'ready'
      }
    }
  })
}))

function makeScene(overrides: Partial<SceneDocument> = {}): SceneDocument {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    schemaVersion: 1,
    sceneId: 'scene-1',
    userId: 'user-1',
    workName: '测试作品',
    themeId: 'spring_festival',
    assetSnapshotId: 'snapshot_test',
    canvas: { width: 902, height: 516, backgroundColor: '#fff' },
    backgroundAssetId: 'bg-1',
    objects: [
      {
        objectId: 'o-1',
        assetId: 'st-1',
        assetType: 'sticker',
        left: 100,
        top: 100,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        zIndex: 1,
        visible: true,
        locked: false
      },
      {
        objectId: 'o-2',
        assetId: 'st-2',
        assetType: 'sticker',
        left: 120,
        top: 120,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        zIndex: 2,
        visible: true,
        locked: false
      }
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('buildProjectionLayers', () => {
  it('excludes background by default and orders stickers by zIndex', async () => {
    const layers = await buildProjectionLayers(makeScene(), { includeBackground: false })
    expect(layers.map((layer) => layer.assetId)).toEqual(['st-1', 'st-2'])
    expect(layers.map((layer) => layer.layerNumber)).toEqual([1, 2])
  })

  it('includes background as the first layer when enabled', async () => {
    const layers = await buildProjectionLayers(makeScene(), { includeBackground: true })
    expect(layers[0]?.kind).toBe('background')
    expect(layers.map((layer) => layer.assetId)).toEqual(['bg-1', 'st-1', 'st-2'])
  })

  it('skips hidden stickers', async () => {
    const layers = await buildProjectionLayers(
      makeScene({
        objects: [
          {
            objectId: 'o-1',
            assetId: 'st-1',
            assetType: 'sticker',
            left: 0,
            top: 0,
            scaleX: 1,
            scaleY: 1,
            angle: 0,
            zIndex: 1,
            visible: false,
            locked: false
          }
        ]
      }),
      { includeBackground: false }
    )
    expect(layers).toHaveLength(0)
  })
})
