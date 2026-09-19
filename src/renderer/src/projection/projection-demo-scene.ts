import type { SceneDocument, SceneObject } from '@shared/contracts'
import { DEFAULT_SCENE_CANVAS } from '../catalog/scene-defaults'
import { YWN_SNAPSHOT_ID } from '../catalog/ywn-catalog'

const DEMO_THEME_ID = 'mid_autumn_festival'
const DEMO_BACKGROUND_ID = 'background_lake_moon_001'

const DEMO_STICKERS: Array<{ assetId: string; zIndex: number; left: number; top: number }> = [
  { assetId: 'sticker_crescent_moon_001', zIndex: 1, left: 120, top: 80 },
  { assetId: 'sticker_mooncake_001', zIndex: 2, left: 280, top: 160 },
  { assetId: 'sticker_rabbit_001', zIndex: 3, left: 440, top: 120 },
  { assetId: 'sticker_tangyuan_001', zIndex: 4, left: 560, top: 260 }
]

function makeObject(entry: (typeof DEMO_STICKERS)[number], index: number): SceneObject {
  return {
    objectId: `demo-projection-${index + 1}`,
    assetId: entry.assetId,
    assetType: 'sticker',
    left: entry.left,
    top: entry.top,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    zIndex: entry.zIndex,
    visible: true,
    locked: false
  }
}

/** Fixed multi-layer Scene for manual Projection / PDF QA (catalog snapshot assets). */
export function createProjectionDemoScene(): SceneDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    sceneId: `demo-projection-${now}`,
    userId: 'user_demo_projection',
    workName: '演示 · 中秋分层',
    themeId: DEMO_THEME_ID,
    assetSnapshotId: YWN_SNAPSHOT_ID,
    canvas: { ...DEFAULT_SCENE_CANVAS, backgroundColor: '#FFF8E7' },
    backgroundAssetId: DEMO_BACKGROUND_ID,
    objects: DEMO_STICKERS.map(makeObject),
    createdAt: now,
    updatedAt: now
  }
}

export const PROJECTION_DEMO_LAYER_LABELS = [
  '1. 月牙',
  '2. 月饼',
  '3. 玉兔',
  '4. 汤圆',
  '背景（可选）：湖面上的小船与圆月'
] as const
