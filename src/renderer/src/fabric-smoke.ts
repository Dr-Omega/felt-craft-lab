import type { AssetRecord, SceneDocument } from '@shared/contracts'
import { FabricEditorAdapter } from './editor'

const snapshotId = 'fabric_smoke_snapshot_001'
const stickerId = 'fabric_smoke_sticker_001'
const backgroundId = 'fabric_smoke_background_001'
const now = '2026-08-01T09:00:00.000Z'

function asset(assetId: string, type: 'background' | 'sticker', imageUrl: string): AssetRecord {
  return {
    assetId,
    type,
    themeId: 'fabric_smoke_theme',
    categoryIds: ['smoke'],
    nameZh: 'smoke',
    nameEn: 'smoke',
    introZh: 'smoke',
    keywords: ['smoke'],
    imageUrl,
    audio: {},
    contentVersion: 1,
    status: 'test_only'
  }
}

const background = asset(backgroundId, 'background', 'felt-resource://material/mock-background.png')
const sticker = asset(stickerId, 'sticker', 'felt-resource://material/mock-sticker.png')

const scene: SceneDocument = {
  schemaVersion: 2,
  sceneId: '59bd8862-8616-44c0-91bf-0d95bfe1161e',
  userId: 'fabric_smoke_user',
  workName: 'Fabric smoke',
  themeId: 'fabric_smoke_theme',
  assetSnapshotId: snapshotId,
  canvas: { width: 320, height: 240, backgroundColor: '#FFFFFF' },
  backgroundAssetId: backgroundId,
  objects: [{
    objectId: '53dd8862-8616-44c0-91bf-0d95bfe1161e',
    assetId: stickerId,
    assetType: 'sticker',
    left: 160,
    top: 120,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    zIndex: 1,
    visible: true,
    locked: false
  }],
  personalBackground: null,
  corePattern: null,
  personalElements: [],
  createdAt: now,
  updatedAt: now
}

async function run(): Promise<void> {
  const element = document.querySelector<HTMLCanvasElement>('#fabric-smoke-canvas')
  if (!element) throw new Error('smoke canvas missing')

  const adapter = new FabricEditorAdapter({
    allowTestAssets: true,
    now: () => new Date(now),
    snapshotContext: {
      snapshots: {
        [snapshotId]: [
          { assetId: backgroundId, type: 'background' },
          { assetId: stickerId, type: 'sticker' }
        ]
      }
    }
  })
  adapter.initialize(element, scene)
  const imported = await adapter.importScene(scene, {
    async resolveAsset(assetId): Promise<AssetRecord> {
      if (assetId === backgroundId) return background
      if (assetId === stickerId) return sticker
      throw new Error('unknown smoke asset')
    }
  })
  if (imported.issues.length !== 0) throw new Error('smoke scene recovered unexpectedly')
  const exported = adapter.exportScene()
  if (exported.objects.length !== 1 || exported.backgroundAssetId !== backgroundId) {
    throw new Error('SceneDocument mapping failed')
  }
  const png = await adapter.exportPng()
  if (png.size === 0) throw new Error('Fabric PNG export is empty')
  adapter.dispose()
}

void run()
  .then(() => { document.title = 'FABRIC_ADAPTER_SMOKE_OK' })
  .catch((error) => { document.title = `FABRIC_ADAPTER_SMOKE_FAIL:${error instanceof Error ? error.message : String(error)}` })
