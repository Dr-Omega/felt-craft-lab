import type { AssetRecord } from '@shared/contracts'
import type { LearningCompletion } from '@shared/learning'
import learningGuides from '@shared/learning-guides.json'
import type { FeltCraftDatabase } from '../persistence/db'
import { AssetAccessStore } from '../persistence/stores'

/** Completion and material permissions commit together; legacy UI flags are never evidence. */
export async function saveLearningCompletion(db: FeltCraftDatabase, receipt: LearningCompletion,
  expected: { userId: string; themeId: string; sessionId: string; assetSnapshotId: string }, assets: readonly AssetRecord[]): Promise<void> {
  if (!receipt || Object.entries(expected).some(([key, value]) => receipt[key as keyof LearningCompletion] !== value)
    || !Number.isFinite(Date.parse(receipt.completedAt)) || !Array.isArray(receipt.stickerIds)) throw new Error('学习完成凭据不匹配。')
  const eligible = assets.filter(asset => asset.themeId === expected.themeId && (asset.type === 'background' || asset.type === 'sticker'))
  const guide = learningGuides.springFestivalCoupletGate
  const authoredLesson = receipt.levelId === guide.levelId && expected.themeId === guide.themeId && expected.assetSnapshotId === guide.assetSnapshotId
  const required = authoredLesson ? guide.placements.map(item => item.stickerId).sort()
    : eligible.filter(asset => asset.type === 'sticker').map(asset => asset.assetId).sort()
  if (!required.length || new Set(receipt.stickerIds).size !== receipt.stickerIds.length
    || required.some(id => !eligible.some(asset => asset.type === 'sticker' && asset.assetId === id))
    || JSON.stringify(required) !== JSON.stringify([...receipt.stickerIds].sort())) throw new Error('学习完成的贴纸与主题素材不匹配。')
  await db.transaction('rw', db.learningProgress, db.assetAccess, async () => {
    const key: [string, string, string] = [expected.userId, expected.assetSnapshotId, expected.themeId]
    const existing = await db.learningProgress.get(key)
    const completedAt = existing?.completedAt ?? receipt.completedAt
    const store = new AssetAccessStore(db)
    for (const asset of eligible) await store.save({ userId: expected.userId, assetId: asset.assetId,
      unlocked: true, unlockSource: 'theme_complete', updatedAt: completedAt })
    if (!existing) await db.learningProgress.put(structuredClone(receipt))
  })
}

export async function completedThemes(db: FeltCraftDatabase, userId: string, snapshotId: string): Promise<string[]> {
  const rows = await db.learningProgress.where('userId').equals(userId).toArray()
  return rows.filter(row => row.assetSnapshotId === snapshotId).map(row => row.themeId)
}
