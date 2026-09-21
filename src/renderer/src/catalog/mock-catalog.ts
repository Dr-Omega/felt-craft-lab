import type {
  AssetAccessState,
  AssetRecord,
  SceneDocument,
  SceneSnapshotValidationContext
} from '@shared/contracts'
import type { FabricEditorAssetResolver } from '../editor'
import { DEFAULT_SCENE_CANVAS } from './scene-defaults'

export const MOCK_USER_ID = 'user_demo_001'
export const MOCK_SNAPSHOT_ID = 'snapshot_ui_workflows_001'
export const MOCK_THEME_ID = 'theme_ui_mock'

const NOW = '2026-08-05T10:00:00.000Z'

function baseAsset(
  assetId: string,
  type: 'background' | 'sticker',
  names: { nameZh: string; nameEn: string; introZh: string },
  imageUrl: string
): AssetRecord {
  return {
    assetId,
    type,
    themeId: MOCK_THEME_ID,
    categoryIds: type === 'background' ? ['scene'] : ['decoration'],
    nameZh: names.nameZh,
    nameEn: names.nameEn,
    introZh: names.introZh,
    keywords: [names.nameZh, 'mock'],
    imageUrl,
    thumbnailUrl: imageUrl,
    audio: {},
    source: 'mock_only',
    license: 'test_only',
    contentVersion: 1,
    status: 'test_only'
  }
}

export const MOCK_BACKGROUND: AssetRecord = baseAsset(
  'mock_background_001',
  'background',
  {
    nameZh: '示例背景',
    nameEn: 'Mock Background',
    introZh: '用于页面联调的本地 mock 背景。'
  },
  'felt-resource://material/mock-background.png'
)

export const MOCK_STICKER: AssetRecord = baseAsset(
  'mock_sticker_001',
  'sticker',
  {
    nameZh: '示例贴纸',
    nameEn: 'Mock Sticker',
    introZh: '用于页面联调的本地 mock 贴纸。'
  },
  'felt-resource://material/mock-sticker.png'
)

export const MOCK_ASSETS: readonly AssetRecord[] = [MOCK_BACKGROUND, MOCK_STICKER]

export const MOCK_SNAPSHOT_CONTEXT: SceneSnapshotValidationContext = {
  snapshots: {
    [MOCK_SNAPSHOT_ID]: [
      { assetId: MOCK_BACKGROUND.assetId, type: 'background' },
      { assetId: MOCK_STICKER.assetId, type: 'sticker' }
    ]
  }
}

const assetById = new Map(MOCK_ASSETS.map((asset) => [asset.assetId, asset]))

export function getMockAsset(assetId: string): AssetRecord | undefined {
  return assetById.get(assetId)
}

export function createMockAssetResolver(): FabricEditorAssetResolver {
  return {
    async resolveAsset(assetId: string): Promise<AssetRecord> {
      const asset = assetById.get(assetId)
      if (!asset) {
        throw new Error(`Mock catalog missing asset: ${assetId}`)
      }
      return asset
    }
  }
}

export function createUnlockedAccess(assetId: string, now = new Date().toISOString()): AssetAccessState {
  return {
    userId: MOCK_USER_ID,
    assetId,
    unlocked: true,
    unlockSource: 'theme_complete',
    updatedAt: now
  }
}

export function createBlankScene(workName: string): SceneDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    sceneId: crypto.randomUUID(),
    userId: MOCK_USER_ID,
    workName,
    themeId: MOCK_THEME_ID,
    assetSnapshotId: MOCK_SNAPSHOT_ID,
    canvas: { ...DEFAULT_SCENE_CANVAS, backgroundColor: '#FFF8E7' },
    backgroundAssetId: null,
    subject: null,
    objects: [],
    createdAt: now,
    updatedAt: now
  }
}

export { NOW as MOCK_FIXTURE_TIME }
