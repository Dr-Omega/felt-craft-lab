import type {
  AssetAccessState,
  AssetRecord,
  AsrResult,
  DraftRecord,
  ProjectRecord,
  QaResult,
  SceneDocument,
  SceneObject,
  SceneSnapshotValidationContext,
  SharedError,
  TtsResult
} from '../../src/shared/contracts'

export const fixtureTime = '2026-07-30T05:20:00.000Z'

export const validAsset: AssetRecord = {
  assetId: 'sticker_lantern_001',
  type: 'sticker',
  themeId: 'theme_mid_autumn',
  categoryIds: ['festival_object', 'decoration'],
  nameZh: '灯笼',
  nameEn: 'Lantern',
  introZh: '灯笼既可以照明，也常被用作节日装饰。',
  keywords: ['灯笼', '节日', '装饰'],
  imageUrl: 'mock://assets/sticker_lantern_001.png',
  thumbnailUrl: 'mock://thumbnails/sticker_lantern_001.png',
  preSplitDataUrl: 'mock://pre-split/sticker_lantern_001.json',
  audio: {},
  source: 'mock_only',
  license: 'test_only',
  contentVersion: 1,
  status: 'test_only'
}

export const validAccess: AssetAccessState = {
  userId: 'user_demo_001',
  assetId: validAsset.assetId,
  unlocked: true,
  unlockSource: 'theme_complete',
  updatedAt: fixtureTime
}

export const validSceneObject: SceneObject = {
  objectId: '62d775d8-e6f8-439a-9d04-0934cb03f81f',
  assetId: validAsset.assetId,
  assetType: 'sticker',
  left: 420,
  top: 260,
  scaleX: 0.8,
  scaleY: 0.8,
  angle: 15,
  zIndex: 1,
  visible: true,
  locked: false
}

export const validScene: SceneDocument = {
  schemaVersion: 1,
  sceneId: '7a3435d2-2c2f-4df1-a38c-5b7e32ce91a8',
  userId: validAccess.userId,
  workName: '我的中秋月夜',
  themeId: validAsset.themeId,
  assetSnapshotId: 'snapshot_demo_20260730_001',
  canvas: { width: 1200, height: 800, backgroundColor: '#FFF8E7' },
  backgroundAssetId: 'background_moon_001',
  subject: { name: '小兔子', imageRef: 'mock://subjects/rabbit.png' },
  objects: [validSceneObject],
  createdAt: '2026-07-30T05:10:00.000Z',
  updatedAt: fixtureTime
}

/** Renderer runtime accepts only felt-resource:// references. */
export const validRendererScene: SceneDocument = {
  ...validScene,
  subject: { name: '小兔子', imageRef: 'felt-resource://material/subject-rabbit.png' }
}

export const validSnapshotContext: SceneSnapshotValidationContext = {
  snapshots: {
    snapshot_demo_20260730_001: [
      { assetId: 'background_moon_001', type: 'background' },
      { assetId: validAsset.assetId, type: 'sticker' }
    ]
  }
}

export const validDraft: DraftRecord = {
  draftId: 'cc2b2db3-0ef0-4db9-a89c-b2fb0eff1dc1',
  scene: validScene,
  updatedAt: validScene.updatedAt,
  status: 'draft'
}

export const validProject: ProjectRecord = {
  projectId: 'c3ac4f13-c4be-4ce0-8781-c60b78a21e83',
  projectName: validScene.workName,
  scene: validScene,
  previewUrl: 'mock://previews/c3ac4f13-c4be-4ce0-8781-c60b78a21e83.png',
  completionStatus: 'completed',
  syncStatus: 'local_only',
  createdAt: fixtureTime,
  updatedAt: fixtureTime
}

export const validAsrResult: AsrResult = {
  transcript: '灯笼为什么是红色的',
  provider: 'qwen_cloud_http',
  durationMs: 1260,
  audioDurationMs: 3100,
  confidence: 0.93,
  requestId: 'asr_req_demo_001'
}

export const validQaResult: QaResult = {
  answer: '红色在很多中国节日中代表喜庆和祝福。',
  requestId: 'qa_req_demo_001',
  safetyAction: 'allow'
}

export const validTtsResult: TtsResult = {
  audioUrl: 'mock://tts/qa_req_demo_001.mp3',
  cacheHit: false,
  requestId: 'tts_req_demo_001'
}

export const validSharedError: SharedError = {
  code: 'ASSET_NOT_FOUND',
  message: '素材暂时不可用。',
  retryable: false,
  details: { assetId: validAsset.assetId }
}

export function cloneFixture<T>(fixture: T): T {
  return JSON.parse(JSON.stringify(fixture)) as T
}

